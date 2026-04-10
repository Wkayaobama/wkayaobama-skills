---
name: hierarchical-incremental-extraction
description: >
  A methodology for building incremental, auditable extraction pipelines over
  entity graphs — without CDC, without a scheduler, without a streaming platform.
  Applicable to any domain where entities have relationships (CRM, financial
  instruments, supply chain, healthcare, research data) and the source system
  cannot provide a reliable change feed.

  USE THIS SKILL whenever someone is: extracting data from a legacy relational
  system incrementally; designing a Bronze or staging layer over joined tables;
  detecting what changed between two snapshots without timestamps or triggers;
  propagating changes through a hierarchy of related records; applying layered
  quality gates before a staging load; making a pipeline resumable after failure;
  or asking how to load FK-joined query results instead of raw tables. Trigger
  even if the domain is not CRM — financial positions, instrument hierarchies,
  patient records, product catalogues, org structures all follow the same
  patterns. The language and tooling are irrelevant to this skill.
---

# Hierarchical Incremental Extraction — Core Methodology

The central problem this methodology solves: **how do you load data incrementally
from a source that does not tell you what changed?**

Most systems assume CDC (change data capture), event streams, or reliable
`updated_at` timestamps. Legacy and commercial systems rarely provide any of
these. What they do provide is the ability to run a SQL query and get the
current state of the data. This methodology builds a complete incremental
pipeline from that primitive alone.

Six principles, each resolving a non-obvious problem.

---

## Principle 1 — The Entity is the Query, Not the Table

**The problem**: Source tables are normalized for write efficiency, not for
analytical consumption. Loading raw tables produces a fragmented view that
requires repeated joins downstream and embeds join logic in every consumer.

**The insight**: Define each entity as the result of a SQL query, including
all denormalizing JOINs. The query is the schema. What the query returns
becomes the canonical representation of that entity across the entire pipeline.

A "Position" in a financial system is not the Position table. It is Position
joined to Instrument (for name, ISIN, asset class), joined to Portfolio (for
fund code, manager), joined to Counterparty (for legal entity). That joined
result — with explicit column aliases — is the entity contract. Everything
downstream, including fingerprinting, validation rules, and staging table
columns, derives from this contract.

**Why this matters**: It makes the pipeline self-contained. A consumer of
the Bronze CSV never needs to know the source schema or re-execute joins.
The entity is complete at extraction time. Schema changes in source tables
that do not affect the query contract do not break the pipeline.

**The discipline it requires**: Every JOIN is a declared assumption. LEFT JOIN
means "this relationship is nullable — a NULL result is data, not an error."
INNER JOIN means "this relationship is required — a missing join partner is
a structural violation." Document this per entity. Source-side computed columns
(e.g. `quantity * last_price AS mtm_value`) belong in the query, not in
application code, so the Bronze layer is reproducible without the application
runtime.

---

## Principle 2 — Content Hash as CDC Without CDC

**The problem**: You cannot ask the source system "what changed since my last
run?" You can only ask "what is the current state?"

**The insight**: Hash the content of each row (excluding metadata columns) and
compare hashes between the current snapshot and the previous snapshot. A
FULL OUTER JOIN between current hashes and previous hashes classifies every
record in a single SQL pass:

```
previous row IS NULL  →  NEW
current  row IS NULL  →  DELETED
hashes differ         →  MODIFIED
hashes match          →  UNCHANGED  (excluded from delta output)
```

This requires only two files (current CSV, previous CSV) and a SQL engine
capable of joins. No database hooks, no event log, no streaming infrastructure.

**The discipline it requires**: Hash stability is critical. Any non-determinism
in the hash produces false Modified deltas on unchanged rows. Three common traps:

1. **Datetime serialisation** — native datetime types serialise differently
   across runtimes and locales. Always normalise to ISO string before hashing.
2. **Metadata columns** — `extracted_at`, `source`, pipeline-internal columns
   must be explicitly excluded from the hash. They change every run by design.
3. **Column ordering** — hash over columns in a fixed sort order. A query that
   returns columns in different order on different runs breaks hash stability.

First run has no previous snapshot — classify all rows as NEW. This is
correct by design. The state ledger (Principle 5) records nothing for an
entity until its first approved load completes.

---

## Principle 3 — FK Graph as Change Propagation

**The problem**: Incremental loading detects changed rows but misses affected
rows. A company name change does not modify the Opportunity table — but every
Opportunity that denormalizes the company name now contains stale data. Loading
only changed companies while leaving opportunities untouched produces
silent inconsistency.

**The insight**: Model the relationships between entities as a directed FK graph.
When records change in entity A, traverse the graph via BFS to identify all
descendant records in entities B, C, D that reference the changed A records.
These descendants are "cascade-affected" even if their own content hash is
unchanged.

```
CRM:      Address → Company → Person → Opportunity → Communication
Finance:  Issuer  → Bond    → Position → Trade
Supply:   Supplier → Product → Order  → Shipment
```

Cascade-affected records are flagged in the review workbook. The downstream
decision (re-extract? re-validate? accept stale?) is a human or policy choice,
not a pipeline hardcode.

**The discipline it requires**: The FK graph must be declared explicitly as
a data structure — not inferred from the source schema at runtime. The graph
encodes business meaning (which relationships matter for propagation) not just
technical foreign keys (which columns reference which tables). Some FK
relationships in the source schema are irrelevant to your entity hierarchy;
some relevant relationships are not enforced as FK constraints.

Empty-string FK values are a separate, common failure mode. Many legacy
systems store missing references as `""` rather than NULL. A null-check passes;
the BFS silently skips the record; the join downstream drops the row. Treat
empty-string in any FK field as a structural violation distinct from NULL.

---

## Principle 4 — Layered Gate Hierarchy

**The problem**: Not all data quality failures have the same consequence.
Treating everything as fatal over-blocks; treating everything as advisory
under-protects.

**The insight**: Quality gates form a hierarchy with distinct failure semantics.
Each layer answers a different question:

| Layer | Question | Failure semantic |
|---|---|---|
| **Schema coverage** | Does the query return the expected columns? | Pre-extraction abort. Fix the query or source schema before fetching rows. |
| **Structural** | Is the record identifiable and internally consistent? | Post-extraction abort. The record cannot be loaded. |
| **Format** | Are field values well-formed? | Scored flag. The record can load but should be reviewed. |
| **Semantic/fuzzy** | Do field values make sense in context? | Advisory. Inform the operator; do not block. |
| **Human approval** | Does a domain expert accept this delta? | Gate. The pipeline pauses until explicitly approved. |

The threshold between structural and format is: would this violation cause
a downstream system to misidentify, duplicate, or silently drop the record?
If yes, it is structural. If it would merely display incorrectly or require
a data quality fix, it is format.

**Domain examples**:

CRM structural: missing PK, duplicate contact ID, empty-string company FK
CRM format: phone not E.164, email malformed, LinkedIn URL invalid
CRM semantic: email address does not resemble firstname.lastname

Finance structural: missing ISIN, invalid currency code, negative notional on a bond
Finance format: price with wrong decimal precision, date outside trading calendar
Finance semantic: daily price movement > 3 standard deviations

The gate hierarchy does not change between domains. The specific rules per gate
layer change. Encode domain rules in a configuration file (enum lists, required
fields, format patterns) that can be updated without touching pipeline logic.

---

## Principle 5 — Run State Machine

**The problem**: A pipeline run is not atomic. It can fail at any stage.
A naive retry re-runs everything from the start — expensive and incorrect
if some stages have side effects (e.g. a partial load to the staging table).

**The insight**: Model the pipeline as a state machine. Each stage writes a
sentinel artifact (a small file or database entry) on successful completion.
On restart, the orchestrator checks for sentinels and skips completed stages.
The `run_id` — a single identifier generated once at pipeline start, threaded
to every stage as a parameter — namespaces all artifacts of a single run.

Two state concerns must be separated:

**External run registry** — records the last successfully approved and loaded
`run_id` per entity. This is the baseline for the next delta comparison.
Written only after the finalize stage commits the approved artifact.
Never derived from filesystem scanning — a failed partial run leaves files
with later timestamps than the last successful run, which breaks baseline
selection.

**Engine-local load state** — records engine-internal metadata (row count,
column schema, data fingerprint). Specific to the pipeline implementation.
If two pipeline implementations (e.g. a legacy system and a new system)
write to the same staging tables, each maintains its own load state with a
distinguishing suffix. Neither corrupts the other's state. Both can upsert
to the same staging table via PK conflict resolution — last writer wins per
row, which is correct for delta patterns.

**The run_id disciplines everything downstream**: file paths, sentinel names,
manifest files, validation outputs, review packages. A run with `run_id =
20260327_120000` produces `Bronze_Position_20260327_120000.csv` and
`state/03_delta_20260327_120000.done`. No ambiguity, no collision with prior
or concurrent runs.

---

## Principle 6 — Filesystem as Execution Graph

**The problem**: Orchestration tools (schedulers, DAG engines, workflow
platforms) introduce dependency and operational overhead. For a pipeline of
10–20 stages running on one machine, the overhead is not justified.

**The insight**: Encode execution order in stage filenames via a numeric prefix.
The orchestrator is a generic loop: sort filenames, execute in order, stop on
non-zero exit. Each stage is self-contained — it reads shared config, checks
its own sentinel, does its work, writes its sentinel, exits.

```
00_preflight     serial   — gates before any data moves
01_extract       parallel — one thread per entity
02_repair        parallel — deterministic transforms (encoding, normalisation)
03_delta         parallel — content-hash comparison
04_cascade       serial   — converging join point; waits for all entity deltas
05_structural    parallel — hard gates
06_format        parallel — scored gates
07_semantic      parallel — advisory gates
08_report        parallel — human-readable output per entity
09_approval      serial   — human checkpoint
10_finalize      serial   — immutable artifact write + registry update
11_load          serial   — staging layer upsert
```

**Serial vs. parallel** encodes the dependency structure. Stages that operate
independently per entity run in parallel. The cascade stage (04) is the natural
convergence point — it requires all entity deltas to be complete before BFS
traversal can begin. Approval (09), finalize (10), and load (11) are serial
because they have ordering dependencies or shared state writes.

**The numeric prefix is documentation, not just mechanics.** A new team member
reads the stage directory and immediately understands execution order, serial
vs. parallel structure, and where the human checkpoint lives — without reading
an orchestration config file, a DAG diagram, or a README.

Adding a stage is inserting a file with the right prefix. Removing a stage is
deleting a file. Reordering is renaming. No orchestration config to update.

---

## Applying This to a New Domain

Start with Principle 1 and work forward.

**Step 1** — Draw the entity hierarchy. Which entities exist? What are their
PK columns? What denormalized context belongs in each entity's canonical
representation? What are the FK relationships that matter for change
propagation (not just all FK constraints in the source schema)?

**Step 2** — Write the query contracts. For each entity: the full SQL with
JOINs, explicit column aliases, ordering by PK, source-side computed fields.
Run it. Verify the output matches the expected canonical representation.

**Step 3** — Define the gate rules per layer for this domain. What fields
are structurally required? What enums are valid? What format patterns apply?
What semantic cross-checks are meaningful? Store as config, not code.

**Step 4** — Choose a `run_id` scheme and a directory layout. ISO timestamps
are a reliable default. Verify that the layout supports the state machine:
sentinel files, run registry, engine-local load state.

**Step 5** — Number the stages and write the orchestrator. Start with the
minimal set: extract, delta, validate, report, approve, finalize, load.
Add stages (encoding repair, cascade, fuzzy validation) when the domain
requires them.

**Step 6** — Run a first pass (all rows NEW). Inspect the review output.
Calibrate gate thresholds (structural vs. format boundary, schema coverage
percentage, fuzzy distance threshold) based on what you observe in real data.
The thresholds are domain-specific; the gate structure is not.

---

## Where This Does Not Apply

This methodology is optimised for:
- Source systems that cannot provide a change feed
- Entity counts in the thousands to low millions (content hashing at larger
  scale requires partitioning strategies not covered here)
- Batch cadence (hourly to daily) rather than near-real-time
- Domains where a human approval step before staging is acceptable

For true streaming requirements, high-volume CDC, or sub-minute latency,
a different architecture is warranted. The layered gate and entity contract
patterns remain useful as design principles even in streaming contexts,
but the snapshot/hash mechanics do not apply directly.

---

## Reference Implementation

The IC'ALPS CRM Bronze pipeline (`Workflowps/`) instantiates this methodology
in PowerShell + PSDuckDB + ImportExcel for SQL Server → PostgreSQL. See
`SKILL.md` (the companion reference card) for the concrete mapping of each
principle to specific files and functions.

A financial pipeline instantiation would map:
- Positions/Trades/Instruments to the entity hierarchy
- MTM value, unrealized P&L to source-side computed fields
- ISIN presence, currency validity to structural gates
- Price movement thresholds to semantic gates
- No changes to Principles 2, 5, or 6 — they are domain-agnostic
