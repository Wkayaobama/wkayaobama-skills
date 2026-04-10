---
name: pipeline-salvation
description: >
  Framework for recovering the working core of a messy, partially-understood, or
  mid-implementation CRM/ETL/data-pipeline codebase. Covers confidence thresholds,
  file classification (four buckets), runnable spine extraction, probe discipline,
  and guardrail assessment. Use this as the methodology reference when writing plans
  with ${CLAUDE__ROOT}/commands/write_plan.md.
---

# Pipeline Salvation — Methodology Reference

Recover the working core of a messy pipeline without pretending the answer is a rewrite.

---

## Core Stance

- Optimize for salvation, not perfection.
- Preserve proven business behavior before cleaning style.
- Confidence thresholds are first-class deliverables — define them before touching code.
- Keep the clean plan smaller than the legacy workspace.
- Refuse live writes until the runnable boundary AND the evidence threshold are both explicit.

---

## §1 — Success Threshold

Define what "saved" means before writing a single task.

**Format:** 3–6 bullet points, each a measurable behavior.

```
The pipeline is saved when:
1. [Orchestrator function/script] completes end-to-end without crash on a staging run
2. [Server/bridge] starts and answers [specific endpoint]
3. [Export step] produces valid output for all N entities
4. [Validation step] produces a report artifact at the expected path
5. [New feature] runs as a probe (read-only) and produces a report
```

Do not write: "all files migrated", "100% test coverage", "all stages green".
These are not behaviors — they are process metrics.

---

## §2 — Canonical Execution Boundary

Name every step in execution order. Do not blur adjacent steps.

For this repo, always describe **two boundaries**:

**Python layer (Excel UI control):**
```
PARAMS → FETCH → ENCODE → HUBSPOT → DELTA → [FK-VALIDATE probe] → EXPORT → CURATE
```

**Workflowps layer (ETL engine):**
```
00_preflight → 01_extract → 02_repair → 03_delta → 04_cascade →
05_validate_structural → 06_validate_format → 07_validate_fuzzy →
08_report → 09_approval → 10_finalize → 11_load
```

Mark each step: `proven` / `in-progress` / `planned` / `blocked`.

**Critical:** A step marked `proven` must have a verifiable artifact (`.done` sentinel,
passing test, existing output file). Do not mark a step `proven` by memory.

---

## §3 — Workflowps Stage Contracts

Each Workflowps stage has a contract. Before classifying any stage, verify:

| Stage | Input | Output | Done sentinel |
|-------|-------|--------|--------------|
| 00_preflight | `config.ps1` | schema coverage report | `preflight_{run_id}.done` |
| 01_extract | SQL Server connection | `Bronze_{entity}_{run_id}.csv` (raw) | `extract_{entity}_{run_id}.done` |
| 02_repair | raw CSV | `Bronze_{entity}_{run_id}_clean.csv` | `repair_{entity}_{run_id}.done` |
| 03_delta | clean CSV + previous snapshot | `delta_records.csv` + `delta_manifest.json` | `delta_{entity}_{run_id}.done` |
| 04_cascade | delta manifest + FK graph | re-extraction flags for child entities | `cascade_{run_id}.done` |
| 05_validate_structural | clean CSV + entity contract | `structural.json` | `validate_structural_{entity}_{run_id}.done` |
| 06_validate_format | clean CSV | `format.json` | `validate_format_{entity}_{run_id}.done` |
| 07_validate_fuzzy | clean CSV | `fuzzy.json` | `validate_fuzzy_{entity}_{run_id}.done` |
| 08_report | all validation JSONs | `review_package.xlsx` | `report_{entity}_{run_id}.done` |
| 09_approval | `review_package.xlsx` | `approved.json` (human writes) | — (human gate) |
| 10_finalize | approved records | `approved.parquet` + `done.flag` | `finalize_{entity}_{run_id}.done` |
| 11_load | `approved.parquet` | rows in `stg_*` PostgreSQL tables | `load_{entity}_{run_id}.done` |

Schema coverage threshold: **85%** (BRZ-05). Below 85%: abort extraction.

---

## §4 — Four Buckets

Classify every file. Every file in the main package goes somewhere.

### KEEP
Directly powers the runnable core. Do not touch unless the task requires it.
Build a table: File | Role.

### REWRITE-MINIMAL
Needed, but only for boundary cleanup. List *what specifically* changes — not "refactor".
Build a table: File | What changes.

### DEFER
Useful later, not required for the first confidence threshold. Do not touch.
Build a table: File | Why deferred.

### DROP
Noise, historical artifacts, one-off scripts with no surviving production role.
Build a table: File/Pattern | Reason.

**Common DROP patterns for this repo:**
- Root-level `test_*.py`, `verify_*.py`, `discover_*.py` — ad-hoc probes, no runner
- `check_params.py` — one-off diagnostic
- `csv_to_postgres_loader.py` — superseded by `export.py`
- `load_all_bronze_to_postgres.py` — bulk loader outside Step 0 boundary
- Exported `.xlsx` variants (`parameters2.xlsx`, etc.) — artifacts, not inputs
- `adhoc/` — as named
- `bronze_layer_delta/` — historical snapshots, not runtime state

---

## §5 — Runnable Spine

State the gap in one sentence per system:

> "The Python layer spine is present. The gap is [step X] not yet wired into `run_step0_curation()`."

> "Workflowps stages 00–07 are proven. Stages 08–11 are in-progress on branch [name]."

Then list minimal edits (max 3 files per system) to close the gap.

**Wire-in rule:** New gates are always **warn-only** on first integration.
Promote to hard-block only after Level 4 staging run confirms sound logic.

---

## §6 — Gomplate and Repomix

### Gomplate (SQL templates only)

Use for:
- `stg_*` entity upserts: `INSERT INTO staging.stg_{entity} ... ON CONFLICT ({pk}) DO UPDATE SET ...`
- Association bridge SQL
- Staging table truncate-and-reload

Do NOT use for:
- Python orchestration or normalization logic
- PowerShell stage scripts or model logic
- Business-rule inference
- Constraint definitions

### Repomix bundle

Include:
- `${CLAUDE__ROOT}/dashboard/xlwings_main.py`
- `${CLAUDE__ROOT}/dashboard/server/main.py`
- `${CLAUDE__ROOT}/dashboard/modules/entity_config.py`
- `${CLAUDE__ROOT}/dashboard/modules/constraint_rules.py`
- `${CLAUDE__ROOT}/dashboard/modules/validation.py`
- `${CLAUDE__ROOT}/dashboard/modules/export.py`
- `${CLAUDE__ROOT}/Workflowps/config.ps1`
- `${CLAUDE__ROOT}/Workflowps/Run-Pipeline.ps1`
- `${CLAUDE__ROOT}/Workflowps/SKILL.md`
- `${CLAUDE__ROOT}/dashboard/requirements.txt`

Exclude: root-level scripts, `adhoc/`, `bronze_layer_delta/`, xlsx artifacts.

---

## §7 — Probe Discipline

Progress in ascending risk order. Never skip levels.

| Level | Type | Pass condition |
|-------|------|----------------|
| 1 | Local contract tests | Configs instantiate; SQL strings contain expected table names; entity contracts have all required fields |
| 2 | Dry run / server start | `.\Run-Pipeline.ps1 -WhatIf` exits 0; `GET /` → 200 |
| 3 | Read-only live probe | `01_extract.ps1` on staging DB, SELECT only; `GET /query SELECT TOP 10` returns correct columns |
| 4 | Full staging run | All 12 stages complete; stg_* row counts match source; all Python report sheets written |
| 5 | Approved live | Requires explicit human approval. No exceptions. |

At each level ask:
- Does the output match the contract?
- Is the result portable to a second machine?
- Is confidence increasing, or are we hiding uncertainty behind structure?

---

## §8 — Guardrail Assessment

For each active guardrail on the current branch:

**Status options:** premature / probe-safe / production-ready

**Decision options:** wire as warn-only / wire as hard-block / defer entirely

**Promotion condition:** what Level-4 evidence justifies promotion?

Example:
> FK Cascade Validation — Status: probe-safe.
> Decision: wire as warn-only on first run.
> Promotion condition: Level 4 staging run confirms <5% false-positive rate on real entity data.

Also flag structural risks not related to the current task (CORS wildcards, hardcoded
connection strings, NULL guards in aggregation SQL). Flag only — do not fix unless
directly blocking the confidence threshold.

---

## §9 — Non-Negotiable Rules

- Keep business fields separate from sync/resolution infrastructure (PKs, delta hashes).
- Encoding cleanup (UTF-8/mojibake) is cross-entity — one module, applied in a loop. Never duplicate per-entity.
- FK graph (Address→Company→Person→Opportunity→Communication) travels as one declaration. Never split across modules.
- Require explicit approval before any live production write.
- Prefer probe-only guardrails over premature production guardrails.
- If a guardrail blocks too much of the core path, downgrade to probe-only — do not force it through.
- The `09_approval.ps1` stage is a human gate — never automate it.

---

## §10 — Recovery Checkpoints

Commit after each stable boundary. List 3–5 commit messages:

```
chore: wire [new step] as warn-only probe into [orchestrator]
chore: drop root-level noise scripts (DROP bucket)
chore: add Level 1 contract tests for Workflowps entity configs
feat: promote [gate] to hard block after Level 4 validation
```

---

## §11 — First Action

The last section of every plan is one sentence naming exactly what to read or run before writing any code. This prevents the next session from starting blind.

Good:
> Read `${CLAUDE__ROOT}/Workflowps/stages/04_cascade.ps1` in full to confirm the FK graph is declared before adding cascade re-extraction logic to `delta_loader.py`.

Bad:
> Start implementing the FK cascade feature.
