# ADR-006: Zero-cache-impact architecture mode

**Status:** Accepted
**Date:** 2026-07-04
**Deciders:** [@kkkiio](https://github.com/kkkiio), [@windingwind](https://github.com/windingwind)

**Supersedes:** [ADR-006 (v1)](./006-unified-hook-interception.md) (intermediate design), [ADR-007](./007-context-warning-on-mode-switch.md) (now obsolete)

## Context

Architecture mode originally used three mechanisms to enforce its restrictions:

| Mechanism | What it did | Side effect |
|-----------|-------------|-------------|
| `setActiveTools(ARCH_TOOLS)` | Replaced the agent's tool list | Broke prefix cache; destroyed other extensions' tools |
| `before_agent_start → { systemPrompt }` | Replaced the entire system prompt | Broke prefix cache |
| `tool_call` hook | Blocked unsafe bash, non-document edits | No cache impact |

The first two mechanisms both change the system prompt bytes sent to the LLM
provider. This invalidates the provider's prompt prefix cache (KV-cache) on the
next LLM call, causing the entire context to be recomputed — a noticeable
latency and cost increase in long conversations.

The `ask_user_question` tool was auto-activated by Pi's `registerTool` API and
required manual cleanup in `session_start` to keep it out of normal mode. This
created a lifecycle inversion: the tool was born in normal mode and killed
there, rather than born in architecture mode.

## Decision

**Architecture mode must not change the system prompt or the active tool set.
It is a pure `tool_call` hook guardrail with a contextual message injected into
the transcript.**

### What's removed

| Removed | Reason |
|---------|--------|
| `setActiveTools()` calls (enter/exit/restore) | Changes system prompt → breaks prefix cache |
| `before_agent_start → { systemPrompt }` | Changes system prompt → breaks prefix cache |
| `ask_user_question` tool | Architecture mode is about understanding/learning, not interviewing |
| Context warning notification | No cache risk → no warning needed |
| `ARCH_TOOLS`, `NORMAL_TOOLS`, `previousTools` | No tool set manipulation |

### What remains

| Component | Mechanism | Cache impact |
|-----------|-----------|:---:|
| `tool_call` hook: unsafe bash | `{ block: true, reason: "..." }` | None |
| `tool_call` hook: non-document edits | `{ block: true, reason: "..." }` | None |
| Stand-down (`tool_result`) | Prepends message to tool results after block | None |
| Arch mode context | `before_agent_start → { message }` injected into transcript | None |
| Exit notification | `pi.sendMessage({...}, { deliverAs: "nextTurn" })` | None |
| State persistence | `pi.appendEntry()` on every state change | N/A |

### How `before_agent_start → { message }` differs from `→ { systemPrompt }`

Both are returned by the same hook, but:

| Return field | Where it goes | Cache impact |
|---|---|---|
| `systemPrompt` | Replaces `agent.state.systemPrompt` → first bytes of API request change | **Cache miss** |
| `message` | Injected as a `custom` role message into the transcript (after user message) | **None** — system prompt bytes unchanged |

The `message` field is the same mechanism oh-my-pi's plan mode uses for its
`plan-mode-context` messages. The prefix cache only depends on the leading
bytes (system prompt); transcript additions after the user message do not
affect it.

### Exit notification via `nextTurn`

When the user runs `/arch-off`, the extension sends a one-shot message queued
for the next turn:

```ts
pi.sendMessage({
    customType: "arch-mode",
    content: "Architecture mode deactivated. Full tool access restored.",
    display: false,
}, { deliverAs: "nextTurn" });
```

This message is injected alongside the next user prompt (before
`before_agent_start`). The agent sees the exit notification without the user
needing to explicitly mention it.

### Why `ask_user_question` was removed

Architecture mode's purpose is helping users **understand and design** — reading
code, explaining patterns, surfacing trade-offs. It is not about conducting
structured interviews or producing formal plans. The tool was a mismatch with
the mode's intent and its lifecycle (auto-activation by Pi, manual cleanup)
created unnecessary complexity.

## Consequences

### Positive

- **Zero prefix cache impact.** Switching modes has no performance penalty. Users can enter and exit architecture mode freely without worrying about cache invalidation.
- **No tool set manipulation.** Other extensions' tools are always available — architecture mode never touches the active tool list.
- **Simpler code.** The extension has no hardcoded tool lists, no save/restore logic, no lazy registration, no context warning. Enter/exit are pure state transitions plus a message injection.
- **Clean lifecycle.** No tools are born in the wrong mode. The extension's only dynamic behavior is injecting a message into the transcript and enforcing guardrails via hooks.

### Negative

- **Agent may not "feel" different in arch mode.** Without a system prompt change, the only behavioral difference is the injected message + hook enforcement. The agent's base personality and tool knowledge come entirely from Pi's default system prompt.
- **No custom tool.** The `ask_user_question` structured Q&A is gone. Users who want structured interviews need a different extension or a subagent pattern.

## Related

- [ADR-001](./001-allow-edit-write-in-arch-mode.md): Allow edit/write in architecture mode
- [ADR-002](./002-safe-bash-filtering.md): Safe-command filtering for bash
- [ADR-004](./004-stand-down.md): Stand-down mechanism
- [Prefix cache analysis](./prefix-cache-analysis.html): Detailed analysis of cache-breaking behaviors in Pi
