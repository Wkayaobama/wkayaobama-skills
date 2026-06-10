---
name: production-discipline
description: >
  Enforces a production-quality rigor gate on Claude Code via a UserPromptSubmit
  hook. When the user's prompt looks like a recommendation, analysis, comparison,
  or design decision, the hook injects an explicit checklist into the assistant's
  context: invoke sequential thinking, read authoritative project docs, search
  prior discussions in memory, state assumptions, treat absence of evidence as
  inconclusive. Project-specific hard constraints stay in per-project memory
  files; this hook is the universal harness-level backstop.
  Companion documentation at ${CLAUDE__ROOT}/skills/production-discipline/hooks/RIGOR_HOOK_OPTION_2.md
  describes a stricter PreToolUse blocking variant to escalate to if Option 1
  proves insufficient.
---

# Production Discipline — Universal Rigor Gate

A machine-enforced backstop for the failure mode where the assistant skips deliberation on production-quality decisions because "the answer feels obvious." The hook fires on every user prompt that looks like a recommendation / analysis / comparison / design decision and injects a discipline checklist into the assistant's context.

---

## Why this exists

The pattern this guards against: a feedback memory or `CLAUDE.md` instructs sequential thinking before recommendations on production work, but the assistant bypasses its own established discipline and gives a fast-and-shallow analysis. The user pushes back, the assistant acknowledges the rule, the cycle repeats next session.

Memory-only enforcement is insufficient — the rule existed in the project's `feedback_research_rigor.md` and the assistant still skipped it. The harness must enforce it mechanically.

---

## §1 — What the hook injects

Every prompt matching the regex receives this text as additional system context BEFORE the assistant responds:

1. Invoke sequential thinking via `mcp__sequential-thinking__sequentialthinking` — no exceptions for "obvious" questions.
2. Read authoritative project docs first (`CLAUDE.md`, `ARCHITECTURE.md`, `README.md`, `SALVAGE.md` — whichever exist).
3. Search prior discussions in claude-mem and feedback memory files for the same question.
4. State assumptions explicitly. Verify each against current code / live state / authoritative docs.
5. Treat absence of evidence as inconclusive. Never infer from feature side-effects ("X works therefore Y is enabled"). Fetch evidence.
6. If the user says "we already discussed this," find that prior context before re-deriving.
7. Reflect already-known feedback / memory back into the answer; do not re-derive what is already established.

Skip the discipline only for trivial single-fact lookups (typo fixes, single-line answers, direct file reads).

Project-specific hard constraints live in the project's feedback / reference memory files. Read those before recommending.

---

## §2 — What matches the regex

The matcher fires on prompts containing any of:

- `recommend`, `should i`, `should we`, `which (one|path|option|approach)`, `vs`, `versus`, `compare`, `assess`, `evaluate`
- `production`, `how would`, `why does`, `why is`
- `tier`, `workflow`, `architecture`, `approach`, `trade-off` / `tradeoff`, `design`

Case-insensitive. Tight enough to not fire on every prompt (skips file reads, typo fixes, simple lookups); broad enough to catch the actual decision-quality questions.

Match a prompt that should NOT trigger but does → either narrow the regex in `hooks/rigor-reminder.ps1`'s settings entry, or accept that the reminder is cheap context noise that the assistant can ignore when irrelevant.

---

## §3 — Install (Option 1 — UserPromptSubmit reminder, recommended default)

Files in this skill:

```
${CLAUDE__ROOT}/skills/production-discipline/
├── SKILL.md                          ← this file
├── hooks/
│   ├── rigor-reminder.ps1            ← the hook script (PowerShell, Windows-friendly)
│   └── RIGOR_HOOK_OPTION_2.md        ← Option 2 setup reference (stricter, deferred)
└── references/
    └── settings-snippet.json         ← the hook config block to merge into ~/.claude/settings.json
```

### Step 1 — Copy the hook script to your Claude install directory

```bash
# Bash / Git Bash
cp "${CLAUDE__ROOT}/skills/production-discipline/hooks/rigor-reminder.ps1" \
   "$HOME/.claude/hooks/rigor-reminder.ps1"
```

```powershell
# PowerShell
Copy-Item "$env:CLAUDE__ROOT/skills/production-discipline/hooks/rigor-reminder.ps1" `
          "$HOME/.claude/hooks/rigor-reminder.ps1"
```

### Step 2 — Merge the UserPromptSubmit hook block into `~/.claude/settings.json`

Open `${CLAUDE__ROOT}/skills/production-discipline/references/settings-snippet.json` and paste the `UserPromptSubmit` array entry into your `~/.claude/settings.json`'s `hooks` object. If you don't already have a `hooks` object, copy the entire `hooks` field from the snippet.

If you already have a `hooks.UserPromptSubmit` array, append the new matcher entry to it (multiple matchers can coexist).

### Step 3 — Restart Claude Code

Hooks are loaded at startup. Restart any open Claude Code session to pick up the new wiring. Verify it fires by submitting a prompt containing one of the trigger words (e.g. "recommend" or "compare"). The status line should briefly show "Injecting rigor discipline reminder..." and the next assistant turn should see the injected text.

---

## §4 — Escalation: Option 2 (PreToolUse block)

If Option 1 turns out to be insufficient (the assistant continues to skip sequential thinking despite the injected reminder), escalate to Option 2 — a PreToolUse hook that **blocks** tool calls until sequential thinking has been invoked in the current turn.

Full setup reference, including the marker-file lifecycle, the blocking script template, and the rollback path, lives in `${CLAUDE__ROOT}/skills/production-discipline/hooks/RIGOR_HOOK_OPTION_2.md`.

Trade-offs vs Option 1 (summary; full table in the Option 2 reference):

| Aspect | Option 1 (this skill default) | Option 2 (escalation) |
|---|---|---|
| Enforcement | Soft (injected reminder) | Hard (tool call blocked) |
| False positive cost | Low | High |
| Latency per tool call | None | ~50-200 ms on rigor-gated turns |
| Complexity | One PS1 + one settings entry | Three PS1 + three settings entries + marker file lifecycle |
| Risk of deadlock | None | If allowlist check fails, sequential thinking itself gets blocked |

---

## §5 — Companion memory contract (project-side)

This hook is the universal harness-level enforcement. Project-specific hard constraints belong in the project's feedback / reference memory files, e.g.:

```
~/.claude/projects/<project-slug>/memory/
├── feedback_research_rigor.md         ← project-specific discipline (e.g. "no Ops Hub on portal X")
├── project_<name>_milestone.md        ← current state, build cursor
└── reference_<topic>.md               ← stable references (deploy gates, install gates)
```

The hook reminds the assistant to **read those memory files** before recommending. The reading itself happens at the assistant's discretion based on relevance.

A project that adopts this skill typically also adds a project-side `feedback_research_rigor.md` entry documenting the project's specific failure modes. See `${CLAUDE__ROOT}/skills/pipeline-salvation/SKILL.md` for the salvation-loop methodology that benefits from this discipline.

---

## §6 — What this skill does NOT do

- It does not enforce the discipline in real time on the assistant's response generation. The reminder is injected; the assistant still chooses what to do with it. Option 2 (PreToolUse block) is the hard-enforcement variant.
- It does not auto-detect every production-quality question. The regex catches most trigger words; novel phrasings can slip through. Tune the matcher locally if you have recurring blind spots.
- It does not validate that the recommendation that follows is correct. It enforces the **process** (sequential thinking, doc reading, evidence-based reasoning), not the **outcome**.
- It does not work without `mcp__sequential-thinking__sequentialthinking` available. If the MCP server isn't installed, the assistant substitutes structured manual reasoning — the discipline still applies. Install via:
  ```bash
  claude mcp add --scope user sequential-thinking -- npx -y @modelcontextprotocol/server-sequential-thinking
  ```

---

## §7 — Origin

Built during a HubSpot UI extension project where a recurring failure mode (assistant inferring tier availability from feature side-effects, recommending paths that required unavailable HubSpot Hubs) cost a full review cycle. The project's existing memory rule (`use sequential thinking before recommending`) was bypassed by the assistant despite being in scope. The harness-level reminder closes that loophole.

Last updated: 2026-06-10.
