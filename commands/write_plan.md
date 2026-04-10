---
name: write-plan
description: >
  Write a structured Pipeline Salvation plan for this codebase before touching any code.
  Trigger on: "write a plan", "write plan", "where do we stand", "rescue this pipeline",
  "what do we keep", "plan the next step", or whenever a feature branch is mid-flight
  without a clear integration path.
  CRITICAL: This repo has TWO execution systems. Any plan that omits either system is invalid.
    1. dashboard/ — Python/xlwings Excel control layer + FastAPI bridge
    2. Workflowps/ — 12-stage PowerShell Bronze ETL engine (the actual pipeline)
---

# Write Plan

Write a complete implementation plan before touching any code.
Methodology: Read and follow `${CLAUDE__ROOT}/skills/pipeline-salvation/SKILL.md`

**Announce at start:** "Writing plan — reading both systems first."

**Save plan to:** `~/.claude/plans/YYYY-MM-DD-<feature-name>.md`

---

## Step 0 — Read Before Writing

Read these files in order. Do not skip any.

```bash
# Both orchestrators
Read ${CLAUDE__ROOT}/dashboard/xlwings_main.py
Read ${CLAUDE__ROOT}/Workflowps/Run-Pipeline.ps1

# Workflowps methodology and entity contracts
Read ${CLAUDE__ROOT}/Workflowps/SKILL.md
Read ${CLAUDE__ROOT}/Workflowps/config.ps1

# Pipeline Salvation framework
Read ${CLAUDE__ROOT}/skills/pipeline-salvation/SKILL.md

# Active branch state
git status
git log --oneline -10
ls ${CLAUDE__ROOT}/Workflowps/stages/
```

Only write the plan after you can answer:
- What does the Python layer do vs. what does Workflowps do?
- Which of the 12 Workflowps stages are proven (`.done` sentinels exist)?
- What is broken or in-progress on the active branch?
- What is the entity contract for each of the 4 entities?

---

## Architecture Baseline (required in every plan)

Every plan must open with this architecture diagram, filled in with actual status:

```
Excel UI (parameters.xlsx)
    ↓ xlwings-lite / pyfetch
${CLAUDE__ROOT}/dashboard/xlwings_main.py          [Python UI layer]
    ↓ HTTP
${CLAUDE__ROOT}/dashboard/server/main.py            [FastAPI bridge]
    ↓ triggers
${CLAUDE__ROOT}/Workflowps/Run-Pipeline.ps1         [ETL orchestrator]
    ↓ 12 ordered stages
00_preflight.ps1   → schema coverage probe (>85% BRZ-05 threshold)
01_extract.ps1     → SQL Server → raw Bronze CSVs
02_repair.ps1      → CP1252→UTF-8 mojibake fix → clean CSVs
03_delta.ps1       → fingerprint delta → new/modified/deleted manifest
04_cascade.ps1     → FK graph re-extraction of affected child records
05_validate_structural.ps1 → NOT NULL, FK existence, cardinality
06_validate_format.ps1     → date ISO, numeric, enum, pattern
07_validate_fuzzy.ps1      → Levenshtein email/name consistency
08_report.ps1      → review package (xlsx/html) for human approval
09_approval.ps1    → GATE: waits for ${CLAUDE__ROOT}/Workflowps/state/approved.json
10_finalize.ps1    → write approved.parquet + done.flag
11_load.ps1        → PostgreSQL stg_* staging tables
    ↓
Silver layer (PostgreSQL CTEs — separate execution)
```

Mark each stage: `proven` / `in-progress` / `planned` / `blocked`.

---

## Plan Sections

Follow the structure in `${CLAUDE__ROOT}/skills/pipeline-salvation/SKILL.md` exactly:

1. **Success Threshold** — 3–6 measurable behaviors (not file counts)
2. **Canonical Execution Boundary** — two sub-boundaries (Python layer + Workflowps layer)
3. **Four Buckets** — Keep / Rewrite-minimal / Defer / Drop (separate tables per system)
4. **Runnable Spine** — one-sentence gap statement + max 3 edits per system
5. **Probe Discipline** — 5-level ladder (see below)
6. **Guardrail Assessment** — one paragraph per active guardrail, warn-only until Level 4
7. **Recovery Checkpoints** — 3–5 commit messages as named stable boundaries
8. **First Action** — one sentence: exact file to read or command to run next

---

## Probe Discipline (5-level ladder)

| Level | Workflowps | Python layer |
|-------|-----------|-------------|
| 1 — Local contract | `config.ps1` loads; entity contracts have all required fields | Entity configs instantiate; `build_query()` returns valid SQL |
| 2 — Dry run | `.\Run-Pipeline.ps1 -WhatIf` exits 0 | `uvicorn dashboard.server.main:app` starts; `GET /` → 200 |
| 3 — Read-only live | `01_extract.ps1` on staging DB, no write stages | `GET /query` with `SELECT TOP 10` → correct columns |
| 4 — Staging full run | All 12 stages complete; stg_* row counts match source | `run_step0_curation()` completes; all report sheets written |
| 5 — Live approved | **Requires explicit human approval before execution** | **Requires explicit human approval before execution** |

Never skip levels. Never run Level 5 without explicit user confirmation.

---

## No Placeholders

Every step must contain what an engineer needs to execute it. Never write:
- "TBD", "TODO", "implement later"
- "Add appropriate error handling"
- Steps that describe what to do without showing how (code or command required)
- "Similar to Task N" — repeat the actual content

---

## Execution Handoff

After saving the plan, offer:

**"Plan saved to `~/.claude/plans/<filename>.md`. Two options:**
1. **Inline** — execute tasks in this session: follow `${CLAUDE__ROOT}/commands/execute_plan.md`
2. **Subagent** — dispatch a fresh agent per task (if subagent support available)

Which approach?"
