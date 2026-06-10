# wkayaobama-skills

Personal skills and commands for Claude Code.

## Setup — ${CLAUDE__ROOT}

All skill files use `${CLAUDE__ROOT}` as the absolute root. Set once per machine.

**Bash / Git Bash (add to ~/.bashrc):**
```bash
export CLAUDE__ROOT="$HOME/Documents/wkayaobama-skills"
```

**PowerShell (add to $PROFILE):**
```powershell
$env:CLAUDE__ROOT = "$HOME\Documents\wkayaobama-skills"
```

## Directory Map

```
wkayaobama-skills/                          ← ${CLAUDE__ROOT}
  commands/
    write_plan.md                           ← write a pipeline salvation plan
    execute_plan.md                         ← execute a plan task-by-task
  skills/
    pipeline-salvation/
      SKILL.md                              ← methodology: buckets, probes, guardrails
    workflowps/
      SKILL.md                              ← Bronze ETL: 12-stage PowerShell pipeline
      metaskill.md                          ← hierarchical incremental extraction
      INTEGRATIONS.md                       ← integration reference
    github-deployment/
      SKILL.md                              ← how to deploy and maintain this repo
    salvage-pdf-to-word/
      SKILL.md                              ← rebuild messy PDFs into structured DOCX
      scripts/                              ← parse.js / build.js / preview.js / render+slice
      references/                           ← methodology / config / docx-emission gotchas
      examples/nahoua-formmed5/             ← worked example: French medical form
    production-discipline/
      SKILL.md                              ← universal rigor gate via UserPromptSubmit hook
      hooks/                                ← rigor-reminder.ps1 + Option 2 PreToolUse reference
      references/                           ← settings-snippet.json for ~/.claude/settings.json
```

## When to Use Each Skill

Skills are context-specific. Invoke only when the task calls for it.

| Skill | When to invoke |
|-------|---------------|
| `commands/write_plan.md` | Before touching code on a multi-step task |
| `commands/execute_plan.md` | When a plan exists and implementation starts |
| `skills/pipeline-salvation/SKILL.md` | When writing a plan for a messy/partial pipeline |
| `skills/workflowps/SKILL.md` | When working on the Bronze ETL PowerShell stages |
| `skills/github-deployment/SKILL.md` | When deploying or updating this skills repo |
| `skills/salvage-pdf-to-word/SKILL.md` | When converting an unstructured PDF to DOCX and one-shot converters mangle the structure |
| `skills/production-discipline/SKILL.md` | When installing the universal rigor gate (UserPromptSubmit hook that injects sequential-thinking + doc-read + evidence checklist on production-quality prompts) |

**Do not load all skills into every session.** Each skill is referenced from within a command when needed.

## Using a Command

Ask Claude to read the relevant command:

> "Read and follow `${CLAUDE__ROOT}/commands/write_plan.md`"

The command will reference the skills it needs internally via `${CLAUDE__ROOT}` paths.

## Maintenance

When a skill changes in the source project, copy here and commit:

```bash
cp /path/to/source/commands/write_plan.md commands/
git add . && git commit -m "update: write_plan — <what changed>"
git push
```
