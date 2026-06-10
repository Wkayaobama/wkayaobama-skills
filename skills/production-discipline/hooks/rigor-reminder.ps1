# rigor-reminder.ps1
# Wired in ~/.claude/settings.json under "hooks" -> "UserPromptSubmit".
# Fires when the user prompt looks like a recommendation / analysis / production-quality decision.
# Injects universal rigor discipline as system context appended to the prompt.
# Project-specific constants (tier, portal IDs, hard constraints) live in project memory, NOT here.

Write-Output "PRODUCTION-QUALITY DISCIPLINE GATE: this prompt requests a recommendation, analysis, comparison, or design decision."
Write-Output ""
Write-Output "Before forming any recommendation:"
Write-Output "  1. Invoke mcp__sequential-thinking__sequentialthinking explicitly. No exceptions for ''obvious'' questions."
Write-Output "  2. Read authoritative project docs first: CLAUDE.md, ARCHITECTURE.md, README.md, SALVAGE.md (whichever exist in the project)."
Write-Output "  3. Search prior discussions in claude-mem (mcp__plugin_claude-mem_mcp-search__search) and feedback memory files for the same question."
Write-Output "  4. State assumptions explicitly. Verify each against current code / live state / authoritative docs."
Write-Output "  5. Treat absence of evidence as inconclusive. Never infer from feature side-effects (e.g. ''X works therefore Y is enabled''). Fetch evidence."
Write-Output "  6. If the user says ''we already discussed this'' or hints at prior context, find that prior context before re-deriving."
Write-Output "  7. Reflect already-known feedback / memory back into the answer; do not re-derive what is already established."
Write-Output ""
Write-Output "Skip this discipline only for trivial single-fact lookups (typo fixes, single-line answers, direct file reads)."
Write-Output ""
Write-Output "Project-specific hard constraints live in the project''s feedback / reference memory files. Read those before recommending."
