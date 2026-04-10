---
name: bronze-extraction-pipeline
description: >
  Methodology for designing and implementing a reproducible, idempotent Bronze
  extraction pipeline from a relational source system to a staging layer.
  Covers the full pattern from entity contract definition through ordered stage
  execution with structural and semantic quality gates.

  USE THIS SKILL whenever the user is: building a data extraction pipeline from
  a legacy or CRM database; designing a Bronze/medallion layer; implementing
  delta detection between runs; adding data quality gates to an extraction
  workflow; setting up entity-based pipeline orchestration with checkpoints;
  or asking how to make a pipeline reproducible and resumable. Trigger even if
  the user does not use the word "Bronze" — phrases like "extract from SQL
  Server", "sync CRM data", "build a staging pipeline", "detect what changed
  between runs", or "add validation before loading" all indicate this skill
  applies. The implementation language (PowerShell, Python, dbt, etc.) does
  not matter — this skill is framework-agnostic.
---

# Bronze Extraction Pipeline — Design Methodology

A Bronze pipeline extracts records from a source system, applies quality gates,
detects changes against a prior snapshot, and writes clean, approved rows to a
staging layer. Every decision below is made to ensure the pipeline is
**idempotent** (re-running produces the same result), **resumable** (a failure
at stage N restarts from N, not from 0), and **auditable** (every run leaves a
complete artifact trail).

The reference implementation is PowerShell + PSDuckDB + ImportExcel targeting
SQL Server → PostgreSQL staging. The patterns apply to any language or engine.

---

## 1. Entity Contract

The entity contract is the single source of truth that governs every other
pipeline decision. Define it before writing any query or stage script.

Each entity requires:

| Field | Purpose | Example |
|---|---|---|
| `name` | Identifier used in filenames, manifests, logs | `Opportunity` |
| `primary_key` | Column that uniquely identifies a record | `Oppo_OpportunityId` |
| `updated_column` | Column that signals a row changed | `Oppo_UpdatedDate` |
| `source_table` | Base table in the source system | `Opportunity` |
| `extraction_order` | Integer defining parallel-safe sequence | `4` |
| `staging_table` | Target table in the staging layer | `stg_opportunity` |
| `required_properties` | Fields that must be non-null in output | `[id, description]` |
| `expected_output_columns` | Canonical alias list the downstream layer expects | see §2 |

**FK graph** — declare parent→child relationships explicitly as a directed
graph. This drives cascade re-extraction: when a parent record changes, all
child records that reference it are flagged for re-validation even if their
own fields did not change.

```
Address  → Company, Person
Company  → Person, Opportunity, Communication
Person   → Opportunity, Communication
```

A missing FK graph means delta changes silently break downstream joins.
Define it even if you do not implement cascade in the first version — it
documents assumptions that Silver-layer CTEs will depend on.

---

## 2. Query Contract

The query contract defines exactly what the source system returns and what
the pipeline expects to receive. Write it as a declarative spec alongside
the SQL, not after.

Each query contract covers:

- **Source query text** — the full SQL, including all JOINs. The dataclass
  or output schema is derived from the query result, not the base table.
  If the query has JOINs, the output includes denormalized fields.
- **Output aliases** — every column gets an explicit `AS alias` that becomes
  the canonical name in Bronze CSVs, state files, and Silver SQL. Aliases
  must not change between runs without a schema-drift alert.
- **Join assumptions** — document which JOINs are LEFT (nullable FK) vs
  INNER (required relationship). A LEFT JOIN that unexpectedly returns NULL
  is a data quality signal, not a pipeline failure.
- **Ordering** — always ORDER BY the primary key. This makes fingerprints
  deterministic and makes visual diff of CSVs possible.
- **Source-side computed fields** — compute derived values (e.g.
  `Forecast * Certainty AS Weighted_Forecast`) in SQL, not in application
  code. This keeps the Bronze layer self-contained and reproducible without
  requiring the pipeline runtime to implement business logic.

**Schema coverage threshold** — before each run, probe the live source schema
and verify that the query returns at least 85% of the columns declared in the
entity contract's `expected_output_columns`. Below 85%: abort. This catches
source-side renames and drops before they corrupt the staging layer (BRZ-05).

---

## 3. Run Context — Directory Layout and Naming Rules

Every file the pipeline produces is namespaced by `{entity}` and `{run_id}`.
The `run_id` is declared once by the orchestrator at startup (e.g. a timestamp
`yyyyMMdd_HHmmss`) and threaded as a parameter to every stage. It is never
derived inside a stage script.

```
pipeline-root/
  bronze_layer/
    Bronze_{entity}_{run_id}.csv          raw extract with provenance metadata
    Bronze_{entity}_{run_id}_clean.csv    encoding-repaired, ready for delta
  delta/{entity}/{run_id}/
    delta_records.csv                     new + modified + deleted rows only
  state/
    run_registry.json                     { entity: last_successful_run_id }
    {entity}_{run_id}_delta_manifest.json counts + deleted PK list
    {entity}_{run_id}_load_state.json     engine-local state (fingerprint, schema)
    {stage_name}_{run_id}.done            sentinel per completed stage
  validation/{entity}/{run_id}/
    structural.json  /  format.json  /  fuzzy.json
  review/{entity}/{run_id}/
    review_package.{xlsx|html|pdf}        human-readable delta + flags
    approval/approved.json                written by reviewer to resume pipeline
  approved/{entity}/{run_id}/
    approved.parquet  (or .csv)           immutable, read-only after write
    done.flag
```

**Sentinel files** — each stage writes a `{stage_name}_{run_id}.done` file
on successful completion. On startup, the orchestrator checks for the
sentinel before executing a stage. This gives resume-from-failure for free
without any external state store. A `-Force` flag bypasses sentinels for
full re-runs.

**Lexicographic = chronological** — ISO timestamp run_ids sort correctly
as strings, so `ls bronze_layer/ | sort` gives extraction history in order.
Do not use random UUIDs as run_ids.

---

## 4. Snapshot Capture Process

The snapshot is the pipeline's unit of work: one clean, provenance-stamped
CSV per entity per run.

**Step 1 — Source execution**: Run the query contract SQL against the source
system. No filtering, no sampling. Full table unless incremental extraction
is explicitly designed.

**Step 2 — Raw export**: Write results to
`bronze_layer/Bronze_{entity}_{run_id}.csv`. This file is never modified
after writing. It is the immutable raw record of what the source returned.

**Step 3 — Injected provenance metadata**: Add two columns to every row
before writing:
- `bronze_extracted_at` — ISO timestamp of extraction
- `bronze_source` — source system identifier (e.g. `"SQL_Server"`)

These columns are excluded from fingerprinting and delta comparison. They
are metadata about the extract, not about the record.

**Step 4 — Encoding repair**: Apply a deterministic fix map (e.g. 28-entry
CP1252 → UTF-8 mojibake corrections) to text columns only. Write to
`Bronze_{entity}_{run_id}_clean.csv`. The raw file is preserved unchanged.
Encoding repair must happen **before** fingerprinting — corrupted bytes in
the fingerprint produce false Modified deltas on the next run.

**Step 5 — Canonical output**: The clean CSV is the canonical Bronze output.
All downstream stages (delta, validation, load) consume the clean file, not
the raw file.

---

## 5. State Ledger (Edge Case — State Machine Pattern)

Two state concerns must be kept separate:

**Run registry** (`run_registry.json`) — records the last successfully
approved and loaded run_id per entity. Written only after the finalize stage
completes. This is the source of truth for "what was the previous baseline
for delta comparison?". Never derived from filesystem scanning — a partial
failed run leaves stale files with later timestamps than the last good run.

```json
{ "Company": "20260325_091500", "Person": "20260325_091732" }
```

**Engine-local load state** (`{entity}_{run_id}_load_state.json`) — records
engine-internal metadata: row count, column schema, data fingerprint hash,
extraction timestamp. This state is engine-specific (a Python pipeline and
a PowerShell pipeline write to different files with different suffixes) and
must not be shared between engines running against the same staging tables.

```json
{
  "entity_name": "Company",
  "last_load_timestamp": "2026-03-27T12:00:00",
  "last_csv_path": "bronze_layer/Bronze_Company_20260327_120000_clean.csv",
  "last_row_count": 4821,
  "column_schema": ["Comp_CompanyId", "Comp_Name", ...],
  "primary_key": "Comp_CompanyId",
  "metadata": { "pipeline": "powershell" }
}
```

The separation matters: multiple pipelines (e.g. a legacy Python pipeline
and a new PowerShell pipeline) can write to the same PostgreSQL staging
tables using upsert-by-PK semantics. Each maintains its own state files.
Neither corrupts the other's state because they use different file suffixes.

---

## 6. Structural Gates

Structural gates are hard failures. A structural violation means the data
is definitionally wrong and must not proceed to the staging layer.

| Gate | Check | Action on failure |
|---|---|---|
| Schema coverage | Query returns ≥ 85% of expected columns | Abort run — fix query or contract |
| Required properties | All `required_properties` fields non-null | Abort entity — log violating rows |
| PK presence | Primary key column exists and is populated | Abort entity |
| PK uniqueness | No duplicate primary key values in output | Abort entity |
| Enum validity | Status/Stage/Type columns contain only declared values | Abort entity |
| FK empty-string | FK fields contain `""` (not NULL) — silent join drops | Abort entity — flag as BRZ-02 |
| Hard arithmetic | Computed fields match formula (e.g. `net = forecast - cost`) | Abort entity |

**Empty-string FK** is the most common silent failure. Source systems often
store missing FKs as `""` rather than NULL. A null-check passes; the JOIN
silently drops the row. Treat `""` in any FK field as a structural violation
with an explicit risk label.

**Schema coverage** is a pre-extraction gate, not a post-extraction one.
Run it as stage 0 via a `SELECT TOP 0` probe that returns column metadata
without fetching rows. Fail fast before transferring any data.

---

## 7. Semantic and Formatting Gates

Semantic gates are scored, not fatal. They produce a review workbook that
a human reviewer inspects before approving the delta for load. Failing a
semantic gate does not abort the pipeline — it flags rows for human decision.

**Format checks** (scored, non-blocking):
- UTF-8 validity — detect non-UTF-8 bytes; apply deterministic fix map;
  flag residual artifacts after repair
- Email — regex `^[^@\s]+@[^@\s]+\.[^@\s]{2,}$`; treat invalid as Score=2
- Phone — normalise (strip separators), validate E.164 `^\+?[1-9]\d{6,14}$`
- LinkedIn URL — `^https?://(www\.)?linkedin\.com/(in|company)/[\w\-]+/?$`
- Date normalisation — ISO `yyyy-MM-ddTHH:mm:ss` enforced at extraction;
  un-parseable values flagged as Score=1 advisory

**Fuzzy similarity checks** (advisory, Levenshtein DP):
- Email vs. name — check if email local part is within distance 1 of
  `firstname.lastname` variants. Suspicious divergence = advisory flag.
- Encoding residuals — scan text columns for known mojibake character
  patterns after the fix map has run.

**Cross-field arithmetic** — verify computed columns match their source
formula. Flag discrepancies as advisory rather than aborting, since source
data may legitimately deviate (e.g. manually overridden forecasts).

**Stage/status normalisation** — map source system stage names to canonical
Silver-layer equivalents (e.g. `"Perdue"` → `"Closed Lost"`). Flag unmapped
values as advisory so the mapping table can be extended.

**PRD review flags** — a small set of fields marked in the Product
Requirements Document as requiring manual review before HubSpot import.
These are surfaced as named flags in the review workbook regardless of
whether structural checks pass.

**Branding/classification heuristics** — classify records by brand or
segment using record ID patterns or field values (e.g. regex on Record ID
prefix → `IcAlps` / `SealSQ` / `Shared`). Used for partitioned reporting,
not for pipeline routing.

---

## 8. Ordered Execution with Numeric Stage IDs

The execution order is the pipeline's contract with the operator. Encode it
in stage filenames so the filesystem is the execution manifest.

```
00_preflight           serial   — schema probe, abort if coverage < 85%
01_extract             parallel — snapshot per entity
02_repair              parallel — encoding repair; must precede delta
03_delta               parallel — fingerprint + FULL OUTER JOIN classification
04_cascade             serial   — BFS FK graph; waits for all entity deltas
05_validate_structural parallel — hard gate; non-zero exit aborts pipeline
06_validate_format     parallel — scored; exits 0 always
07_validate_fuzzy      parallel — advisory; exits 0 always
08_report              parallel — assemble review workbook
09_approval            serial   — human gate; blocks until approval file written
10_finalize            serial   — write immutable artifact; update run registry
11_load                serial   — upsert approved rows to staging layer
```

**Orchestrator pattern** — a generic runner discovers stage files by numeric
prefix, sorts them, and executes in order. Each stage is self-contained:
it dot-sources shared config, checks its sentinel, does its work, writes
its sentinel. The orchestrator passes `run_id`, `entities`, `force`, and
`whatif` as uniform parameters to every stage.

**Resume from failure** — on error, the orchestrator prints the exact
command to resume from the failed stage (`-FromStage N`). Sentinel files
ensure completed stages are skipped. No stage needs to know about any other.

**Parallel vs. serial** — stages that operate independently per entity run
in parallel (throttle limit 4 is a safe default for SQL Server workloads).
Stages that require all entity outputs to be ready (cascade BFS, finalize,
load) run serially. The cascade stage is the natural join point where all
parallel entity branches converge before validation proceeds.

**Delta fingerprinting** — use a SQL-engine hash (e.g. DuckDB `md5()`) over
all non-metadata columns concatenated with a stable delimiter. Datetime
columns must be normalised to ISO strings before hashing — native datetime
types serialise inconsistently across runs and produce false Modified deltas.
The first run (no prior snapshot) classifies all rows as New. This is correct
by design — the state ledger records nothing for the entity until the first
approved load completes.

---

## Reference Implementation

The IC'ALPS Bronze pipeline (`Workflowps/`) implements this methodology in
PowerShell + PSDuckDB + ImportExcel for SQL Server → PostgreSQL staging.

| Concept | Reference file |
|---|---|
| Entity contract | `config.ps1` — `$EntityMeta`, `$FKGraph`, `$EntityRequiredFields` |
| Query contract | `queries.ps1` — all 6 entity SQL here-strings |
| Run context | `Run-Pipeline.ps1` — directory creation, sentinel discovery |
| Snapshot capture | `functions/Export-BronzeCSV.ps1`, `functions/Repair-BronzeEncoding.ps1` |
| State ledger | `functions/Get-PreviousRunId.ps1`, `functions/Update-RunRegistry.ps1` |
| Structural gates | `functions/Invoke-ValidateStructural.ps1`, `stages/05_validate_structural.ps1` |
| Semantic gates | `functions/Invoke-ValidateFormat.ps1`, `functions/Invoke-ValidateFuzzy.ps1` |
| Stage execution | `stages/00_preflight.ps1` … `stages/11_load.ps1` |
| Full diagram + commands | `README.md` |
| Integration setup | `INTEGRATIONS.md` |
| Design rationale | `pshellplan.md`, `pshellplan-part2.md` |
