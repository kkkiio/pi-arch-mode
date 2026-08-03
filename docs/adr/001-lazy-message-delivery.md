# ADR-001: Lazy message delivery for mode transitions

**Date:** 2026-07-05

## Context

When the user enters or exits architecture mode, the agent needs to be told.
The naive approach is to queue messages at the point of transition:

```ts
// In enterMode():
pi.sendMessage(ARCH_MODE_MESSAGE, { deliverAs: "nextTurn" });

// In exitMode():
pi.sendMessage(ARCH_EXIT_MESSAGE, { deliverAs: "nextTurn" });
```

`nextTurn` queues messages that are injected alongside the next user prompt,
before `before_agent_start`. The problem: queued messages cannot be canceled.

If the user runs `/arch` → `/arch-off` before the next turn, both messages are
queued. The agent sees a stale "entered arch mode" followed by "exited arch
mode" — confusing and wasteful.

## Decision

**Do not pre-queue messages. Instead, defer the decision to `before_agent_start`,
which inspects the current mode state and the agent's last-known state, and
injects a message only when they differ.**

### Mechanism

A boolean `agentThinksInArch` tracks what the agent was last told (via an
injected `custom_message` in the transcript).

| `state.enabled` | `agentThinksInArch` | Action |
|---|---|---|
| `true` | `false` | Inject `ARCH_MODE_MESSAGE`, set to `true` |
| `true` | `true` | Nothing |
| `false` | `true` | Inject `ARCH_EXIT_MESSAGE`, set to `false` |
| `false` | `false` | Nothing |

### Single point of modification

`enterMode()` and `exitMode()` only mutate `state.enabled`. They do not queue
or send messages, and they do not touch `agentThinksInArch`.

`before_agent_start` is the only place that modifies `agentThinksInArch`, and
only when it actually injects a message. After injection, `persistState()` is
called to keep the persisted entry consistent with the transcript.

### Persistence

`agentThinksInArch` is persisted alongside `enabled` in the same
`appendEntry` call. This ensures correct behavior across session resume and
fork:

- **Resume**: both values restored → `before_agent_start` correctly skips or
  injects based on the last state the agent was told.
- **Fork**: entries are copied → same behavior as resume.
- **Fork then `/arch-off` before next turn**: `exitMode()` writes
  `{enabled: false, agentThinksInArch: true}` — a valid "pending exit" pair.
  On the next turn, `before_agent_start` sees the mismatch and injects
  `ARCH_EXIT_MESSAGE`.

### Rapid enter/exit

`/arch` → `/arch-off` before the next turn:

1. `enterMode()`: `enabled = true`, persist `{true, false}`
2. `exitMode()`: `enabled = false`, persist `{false, false}`
3. Next turn: `enabled=false, thinks=false` → nothing injected. Correct.

`/arch` → one turn → `/arch-off`:

1. `enterMode()`: `enabled = true`, persist `{true, false}`
2. Next turn, `before_agent_start`: `enabled=true, thinks=false` → inject enter message, set `thinks=true`, persist `{true, true}`
3. Agent works in arch mode.
4. `exitMode()`: `enabled = false`, persist `{false, true}`
5. Next turn, `before_agent_start`: `enabled=false, thinks=true` → inject exit message, set `thinks=false`, persist `{false, false}`

## Consequences

### Positive

- **No stale messages.** Pre-queuing is eliminated; rapid enter/exit cycles
  produce no spurious transcript entries.
- **Single source of truth.** Only `before_agent_start` decides what to inject,
  making behavior easy to reason about.
- **Survives fork/resume.** Persisted `agentThinksInArch` prevents redundant
  messages on session restore and ensures exit messages are not lost.
- **Zero cache impact.** Like all `before_agent_start → { message }`
  injections, these go into the transcript after the system prompt.

### Negative

- **Two variables to track.** `state.enabled` and `agentThinksInArch` must
  be kept consistent, but the design rule ("only `before_agent_start` modifies
  `agentThinksInArch`") makes this straightforward.
- **`{enabled: false, agentThinksInArch: true}` is a valid persisted state.**
  This looks inconsistent at a glance but is correct: it means the agent was
  told it was in arch mode, the mode has since been turned off, and the next
  turn will inject an exit message.
