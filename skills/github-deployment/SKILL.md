---
name: github-deployment
description: >
  Plan and execute the deployment of the local skills tree to a personal GitHub repository.
  Organizes commands/ and skills/ as a navigable, portable knowledge repo.
  Trigger on: "deploy to github", "push skills to github", "publish the skills", "set up the repo".
---

# GitHub Deployment — Skills Repo

Deploy the local skills tree (`commands/` + `skills/`) to a personal GitHub repository
so it can be referenced across machines and shared as a portable skill set.

---

## Target Repo Structure

```
wkayaobama-skills/                     ← GitHub repo root = ${CLAUDE__ROOT}
  README.md                            ← repo purpose and CLAUDE__ROOT setup instructions
  commands/
    write_plan.md                      ← write-plan command (references ${CLAUDE__ROOT})
    execute_plan.md                    ← execute-plan command (references ${CLAUDE__ROOT})
  skills/
    pipeline-salvation/
      SKILL.md                         ← Pipeline Salvation methodology
    workflowps/
      SKILL.md                         ← symlink or copy of Workflowps/SKILL.md
      metaskill.md                     ← hierarchical incremental extraction methodology
    writing-plans/
      SKILL.md                         ← general plan writing methodology
    executing-plans/
      SKILL.md                         ← general plan execution methodology
```

---

## Step 1 — Create the GitHub Repo

```bash
# Create a new public or private repo (private recommended for proprietary pipeline details)
gh repo create wkayaobama-skills --private --description "Personal skills and commands for Claude Code"

# Clone to a dedicated location (not inside icalps-dashboard)
cd ~/Documents
git clone git@github.com:Wkayaobama/wkayaobama-skills.git
cd wkayaobama-skills
```

---

## Step 2 — Set ${CLAUDE__ROOT}

Add to your shell profile (`~/.bashrc` or PowerShell `$PROFILE`):

**Bash:**
```bash
export CLAUDE__ROOT="$HOME/Documents/wkayaobama-skills"
```

**PowerShell:**
```powershell
$env:CLAUDE__ROOT = "$HOME\Documents\wkayaobama-skills"
```

This variable is used in all skill files as the absolute root for path references.

---

## Step 3 — Copy Files from icalps-dashboard

```bash
SKILLS_REPO="$HOME/Documents/wkayaobama-skills"
ICALPS="C:/Users/ayaobama/Documents/AnthonySalesOps/Codebase/icalps-dashboard"

# Commands
mkdir -p "$SKILLS_REPO/commands"
cp "$ICALPS/commands/write_plan.md"   "$SKILLS_REPO/commands/"
cp "$ICALPS/commands/execute_plan.md" "$SKILLS_REPO/commands/"

# Pipeline Salvation skill
mkdir -p "$SKILLS_REPO/skills/pipeline-salvation"
cp "$ICALPS/skills/pipeline-salvation/SKILL.md" "$SKILLS_REPO/skills/pipeline-salvation/"

# Workflowps skills
mkdir -p "$SKILLS_REPO/skills/workflowps"
cp "$ICALPS/Workflowps/SKILL.md"      "$SKILLS_REPO/skills/workflowps/"
cp "$ICALPS/Workflowps/metaskill.md"  "$SKILLS_REPO/skills/workflowps/"
cp "$ICALPS/Workflowps/INTEGRATIONS.md" "$SKILLS_REPO/skills/workflowps/"
```

---

## Step 4 — Write the README

The README must include how to set `${CLAUDE__ROOT}` and the directory map.
Save to `$SKILLS_REPO/README.md`.

Key sections:
- What this repo is
- How to set `${CLAUDE__ROOT}` (bash + PowerShell)
- Directory map (commands/ + skills/)
- How to use commands from Claude Code: `! cat ${CLAUDE__ROOT}/commands/write_plan.md`

---

## Step 5 — Initial Commit and Push

```bash
cd "$SKILLS_REPO"
git add .
git commit -m "init: bootstrap skills repo — commands + pipeline-salvation + workflowps"
git push origin main
```

---

## Step 6 — Connect to icalps-dashboard

In `icalps-dashboard`, add a `.claude/settings.json` entry or CLAUDE.md note:

```markdown
## Skills Root
Local skills are at: C:/Users/ayaobama/Documents/wkayaobama-skills
Set: export CLAUDE__ROOT="C:/Users/ayaobama/Documents/wkayaobama-skills"
Repo: https://github.com/Wkayaobama/wkayaobama-skills
```

---

## Step 7 — Streamline Through Local Skills (not remote)

When Claude Code needs a skill, reference it locally:

```bash
# In any session
Read ${CLAUDE__ROOT}/commands/write_plan.md
Read ${CLAUDE__ROOT}/skills/pipeline-salvation/SKILL.md
Read ${CLAUDE__ROOT}/skills/workflowps/SKILL.md
```

Do NOT reference:
- The obra/superpowers plugin
- Any remote marketplace skill
- Any cached plugin path under `~/.claude/plugins/cache/`

If a remote plugin conflicts with a local skill, the local skill takes precedence.

---

## Maintenance Rules

- When a skill changes in `icalps-dashboard`, copy the update to `wkayaobama-skills` and commit.
- When a new skill is created in `icalps-dashboard/skills/`, add it to the repo and update the README tree.
- Keep `${CLAUDE__ROOT}` paths consistent — never use relative paths in skill files.
- Do not commit: connection strings, API keys, `.env` files, Bronze CSVs.
