# ADR-003: Hook-based tool interception

**Date:** 2026-07-04

## Context

Architecture mode needs to block two categories of agent actions:
destructive bash commands and edits to implementation files.

The obvious approach is to remove tools from the agent's active set via
`setActiveTools()`. But this has a destructive side effect: modifying the
active tool list changes the system prompt bytes sent to the LLM provider,
invalidating the prefix cache (KV-cache) and forcing a full context recompute.

## Decision

**Keep the full tool set active. Intercept disallowed operations via the
`tool_call` hook, returning `{ block: true, reason: "..." }`.**

### What's intercepted

| Tool | Condition | Mechanism |
|------|-----------|-----------|
| `bash` | Command not in `SAFE_PATTERNS` or matches `DESTRUCTIVE_PATTERNS` | `tool_call` → `{ block: true, reason: "..." }` |
| `edit` / `write` | Path extension not in `WRITEABLE_EXTENSIONS` | `tool_call` → `{ block: true, reason: "..." }` |

### Stand-down mechanism

When an agent is blocked, it tends to try alternative tools to achieve the
same goal (e.g., `python3 -c`, `sed -i`). Rather than playing whack-a-mole
with block patterns, a `standDownThisTurn` flag is set on the first block in
a turn. The `tool_result` hook then prepends a stand-down message to every
subsequent successful tool result for the remainder of the turn, commanding
the agent to stop and align with the user. The flag resets on `turn_start`.

See [ADR-004](./004-stand-down.md) for the full stand-down design.

### Why not `setActiveTools()`

- Modifying the active tool set changes the system prompt → breaks prefix cache.
- Other extensions' tools are destroyed on enter, and may not be restored
  correctly on exit.
- Hook interception leaves tools intact; only the disallowed operations are
  blocked.

## Consequences

### Positive

- **Zero cache impact.** No system prompt or tool set changes.
- **Other extensions unaffected.** Their tools remain available — architecture
  mode never touches the active tool list.
- **Specific feedback.** Each blocked operation gets a targeted reason message,
  not a generic "tool unavailable" error.
- **Stand-down prevents bypass loops.** The persistent feedback in subsequent
  tool results breaks the "try another tool" cycle.

### Negative

- **Bash filtering is allowlist + blocklist.** Unknown commands are treated as
  unsafe by default, which can produce false positives on harmless but uncommon
  commands. Mitigation: the block reason guides the agent to explain what it
  was trying to do.

## Related

- [ADR-002](./002-safe-bash-filtering.md): Safe-command filtering for bash
- [ADR-004](./004-stand-down.md): Stand-down mechanism
