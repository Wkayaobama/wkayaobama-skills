# Rigor Hook — Option 2 (PreToolUse block) setup reference

## When to enable

Enable this **only if** Option 1 (UserPromptSubmit reminder, currently active) proves insufficient — i.e., if Claude continues to skip sequential thinking despite the injected reminder. Option 2 is mechanically enforced; Option 1 is a soft nudge.

The trigger to escalate: a recurrence of the failure mode where Claude forms a recommendation on a production-quality decision without first invoking `mcp__sequential-thinking__sequentialthinking`, even after the Option 1 reminder fired.

## What it does

A `PreToolUse` hook fires before every tool call. The hook script inspects the conversation's tool-use history (delivered to the hook via stdin as JSON). If `mcp__sequential-thinking__sequentialthinking` has **not** been invoked at least once in the current turn AND the current user prompt matched the rigor regex (signalling a production-quality decision), the hook **blocks the tool call** by exiting non-zero with a stderr message telling Claude to invoke sequential thinking first.

The block is universal: it applies to all production-quality prompts globally, not project-scoped. Project-specific constants (hard constraints, portal IDs) stay in project memory files, not in the hook.

## Setup steps

### Step 1 — Add a marker file when the rigor reminder fires

Extend `~/.claude/hooks/rigor-reminder.ps1` (the existing Option 1 script) to write a marker file when it runs. This lets the Option 2 PreToolUse hook know we're in a "rigor-gated" turn.

Add at the **end** of `~/.claude/hooks/rigor-reminder.ps1`:

```powershell
# Marker so the PreToolUse hook (Option 2) knows this turn needs the discipline.
# The marker is cleared at end-of-turn by the Stop hook or session restart.
$markerPath = "$env:TEMP\claude-rigor-required-turn"
New-Item -Path $markerPath -ItemType File -Force | Out-Null
```

### Step 2 — Create the PreToolUse blocking script

Create `~/.claude/hooks/require-sequential-thinking.ps1`:

```powershell
# require-sequential-thinking.ps1
# Wired via ~/.claude/settings.json under "hooks" -> "PreToolUse".
# Blocks tool calls until mcp__sequential-thinking__sequentialthinking has been invoked once
# AND only when the current turn was flagged as rigor-gated by the Option 1 reminder marker.

$markerPath = "$env:TEMP\claude-rigor-required-turn"
if (-not (Test-Path $markerPath)) {
    # No marker -> this turn is not rigor-gated. Pass through.
    exit 0
}

# Read hook input from stdin (Claude Code delivers tool-call context as JSON).
$rawInput = [Console]::In.ReadToEnd()
$hookCtx = $rawInput | ConvertFrom-Json

# Allow sequential-thinking itself to fire without being blocked (otherwise we deadlock).
$toolName = $hookCtx.tool_name
if ($toolName -eq "mcp__sequential-thinking__sequentialthinking") {
    # Sequential thinking is being invoked now. Clear the marker so subsequent tools pass through.
    Remove-Item $markerPath -ErrorAction SilentlyContinue
    exit 0
}

# Check tool_use_history for prior sequential-thinking invocation in this turn.
$history = $hookCtx.tool_use_history
$hasSeqThinking = $false
if ($history) {
    foreach ($entry in $history) {
        if ($entry.tool_name -eq "mcp__sequential-thinking__sequentialthinking") {
            $hasSeqThinking = $true
            break
        }
    }
}

if (-not $hasSeqThinking) {
    Write-Error "BLOCKED by rigor gate: this turn is rigor-gated (matched the production-quality regex). Invoke mcp__sequential-thinking__sequentialthinking BEFORE other tool calls. Discipline rule from ~/.claude/projects/<project>/memory/feedback_research_rigor.md."
    exit 1
}

# Sequential thinking was already invoked. Pass through.
exit 0
```

### Step 3 — Wire the PreToolUse hook in `~/.claude/settings.json`

Add this block inside `"hooks"`, alongside the existing `PreCompact` / `SessionStart` / `UserPromptSubmit` entries:

```jsonc
"PreToolUse": [
  {
    "matcher": "*",
    "hooks": [
      {
        "type": "command",
        "command": "powershell -ExecutionPolicy Bypass -File \"$HOME/.claude/hooks/require-sequential-thinking.ps1\"",
        "timeout": 5,
        "statusMessage": "Checking rigor gate..."
      }
    ]
  }
]
```

The `matcher: "*"` means the hook is consulted before every tool call, but the script itself short-circuits (exit 0) when no rigor marker is present, so the latency cost is one PowerShell startup per tool call on rigor-gated turns only.

### Step 4 — Add a turn-end cleanup hook (optional, recommended)

To guarantee the marker doesn't leak across turns (in case sequential thinking is never invoked and the turn ends), add a `Stop` hook:

```jsonc
"Stop": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "powershell -ExecutionPolicy Bypass -Command \"Remove-Item -Path \\\"$env:TEMP\\claude-rigor-required-turn\\\" -ErrorAction SilentlyContinue\"",
        "timeout": 5
      }
    ]
  }
]
```

## Trade-offs vs Option 1

| Aspect | Option 1 (active) | Option 2 (this doc) |
|---|---|---|
| Enforcement | Soft (reminder injected as system context) | Hard (tool call blocked) |
| False positive cost | Low (irrelevant reminder, easy to ignore) | High (legitimate tool calls blocked) |
| False negative cost | Failure mode can recur if reminder is ignored | Effectively zero on rigor-gated turns |
| Latency cost per tool call | None | ~50-200 ms (one PowerShell startup + JSON parse) |
| Complexity | One PS1 script + one settings entry | Three PS1 scripts + three settings entries + a marker-file lifecycle |
| Risk of deadlock | None | If the sequential-thinking allowlist check fails, the hook itself blocks sequential thinking. Test before enabling. |

## Rollback

To disable Option 2 if it causes issues:

1. Remove the `"PreToolUse"` block from `~/.claude/settings.json`.
2. Remove the `"Stop"` block (if you added Step 4).
3. Optionally revert the marker-file write at the end of `~/.claude/hooks/rigor-reminder.ps1`.
4. Delete `~/.claude/hooks/require-sequential-thinking.ps1`.

Option 1 will continue to fire normally.

## Notes on the hook JSON contract

The exact shape of the JSON delivered to PreToolUse hooks via stdin should be verified against the Claude Code hook documentation before enabling. The script above assumes fields `tool_name` (string) and `tool_use_history` (array of `{tool_name, ...}`). If the actual contract differs (e.g., the field is `toolName` camelCase or `tool_history`), update the script accordingly. Test with a non-blocking variant first that logs the received JSON shape to a file:

```powershell
# Diagnostic mode — log the actual JSON shape to verify before enforcing
$rawInput = [Console]::In.ReadToEnd()
$rawInput | Out-File "$env:TEMP\claude-precooluse-shape.json" -Append
exit 0
```
