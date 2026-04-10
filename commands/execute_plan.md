---
name: execute-plan
description: >
  Execute a written implementation plan task-by-task with review checkpoints.
  Use when a plan document exists at ~/.claude/plans/ and the next step is implementation.
  Trigger on: "execute the plan", "run the plan", "implement the plan", "execute-plan",
  or when the user points to a plan file and says to start.
  Note: quality is significantly higher when run stage-by-stage with human review at
  each checkpoint. Do not batch all tasks into one run.
---

# Execute Plan

Load the plan, review it critically, execute stage by stage, stop at every checkpoint.

**Announce at start:** "Executing plan — loading and reviewing before starting."

**Skills this execution depends on:**
- `${CLAUDE__ROOT}/Workflowps/SKILL.md` — entity contracts and stage rules (Workflowps tasks)
- `${CLAUDE__ROOT}/skills/pipeline-salvation/SKILL.md` — probe discipline and guardrail rules
- `${CLAUDE__ROOT}/commands/write_plan.md` — created the plan this skill executes

---

## Step 1 — Load and Review

1. Read the plan file in full.
2. Identify which system each task targets — Python layer or Workflowps layer.
3. For Workflowps tasks: cross-reference stage contracts in `${CLAUDE__ROOT}/Workflowps/SKILL.md`.
4. Flag any concern before starting:
   - Missing dependency (module, PS module, env var, DB connection)
   - Task references a function or file not defined in the plan
   - A stage is marked `proven` but its `.done` sentinel does not exist
   - A guardrail is wired as hard-block but has not yet passed Level 4 probe
5. If concerns exist: raise them before executing. Do not guess.
6. If no concerns: create tasks in order and proceed.

---

## Step 2 — Execute Tasks

For each task:

1. Mark as `in_progress`.
2. If it is a Workflowps task:
   - Check for the sentinel: `ls ${CLAUDE__ROOT}/Workflowps/state/{stage}_{run_id}.done`
   - If sentinel exists and `-Force` was not passed: skip (already completed).
   - Execute: `.\{stage}.ps1 -RunId $run_id -Server $env:ICALPS_SERVER`
   - Verify output artifact matches contract (CSV path, row count, manifest keys).
3. If it is a Python task:
   - Follow each step exactly as written in the plan.
   - Run any specified verification command and confirm expected output.
4. Mark as `completed` only after verification passes.
5. Do not proceed to the next task until the current one is verified.

---

## Step 3 — Checkpoint Review

After every group of tasks that the plan designates as a checkpoint:

1. Report status: tasks completed, artifacts produced, any anomalies.
2. Ask: "Continue to next checkpoint?"
3. Do not proceed without confirmation.

Checkpoints are defined in the plan. If the plan does not define them, treat each
task as its own checkpoint.

---

## Step 4 — Complete

After all tasks complete and are verified:

1. Run the full probe ladder (Level 1 → Level 4) as defined in the plan.
2. Report results against the Success Threshold from the plan.
3. Present the completion options:
   - Commit recovery checkpoint
   - Open a PR
   - Continue to next feature branch task
4. Do not declare success until the Success Threshold is met.

---

## When to Stop and Ask

**STOP immediately when:**
- A stage fails and the error is not explained by the plan.
- A verification step produces unexpected output.
- A sentinel exists for a stage that should not have run yet.
- A guardrail blocks execution and it was supposed to be warn-only.
- Any Workflowps stage exits non-zero without a documented expected failure.

**Ask for clarification. Do not guess. Do not skip verifications.**

---

## Rules

- Never start implementation on `main`/`master` without explicit user consent.
- Never run Level 5 (live production write) without explicit human approval.
- Never bypass a `.done` sentinel without `-Force` and user confirmation.
- Never wire a guardrail as hard-block without Level 4 evidence.
- If a stage produces a review package (`08_report.ps1`), wait for human approval (`09_approval.ps1`) before continuing.
- Review plan critically before executing — not after the first task fails.
