# ADR-006: Minimal visible mode message

**Date:** 2026-08-03

## Context

ADR-001 decided **how** the mode message is delivered: lazily via
`before_agent_start`, nothing pre-queued, with `agentThinksInArch` tracking
what the agent was last told. It did not decide **what** the message says or
whether the user sees it.

The original message was a long system-prompt-style briefing:

- two co-equal purposes (help the user understand the codebase / help design its architecture)
- "read broadly first"
- architecture vocabulary and UML-level concepts
- Mermaid/HTML diagram instructions (CDN import, `/tmp/` location, init config)
- "do not proactively write plan or handoff documents"

It was delivered with `display: false` — sent to the LLM but hidden from the
user in the TUI.

Two problems:

1. **Redundancy with guardrails.** The hard rules (no implementation code, no
   destructive bash) are already enforced and explained by the `tool_call`
   hook, with a stand-down reminder from the `tool_result` hook (ADR-004). A
   long message repeating them added noise, not enforcement.
2. **Opacity.** `display: false` hides from the user what the agent was told.
   For a mode whose purpose is supervised collaboration, hidden context is a
   transparency failure.

## Decision

**Trim the message to the minimum the agent must know, and make it visible.**

The enter message becomes exactly:

```
You are in architecture mode.
You cannot modify implementation code.
You cannot run destructive commands.
Focus on understanding the codebase and designing its architecture.
```

Detailed behavioral guidance (reading broadly, architecture vocabulary,
documentation workflow, diagrams) is removed from the injected message. One
line of intent is kept — "focus on understanding and design" — so the message
still points at the mode's purpose without prescribing how to work. Everything
deeper is left to the user's prompts.

The exit message stays minimal ("Architecture mode deactivated. Full tool
access restored."). Both messages are delivered with `display: true`, so they
appear in the transcript/TUI — the user sees exactly what the agent was told
about the mode.

The delivery mechanism from ADR-001 (lazy injection, `agentThinksInArch`,
persistence) is unchanged.

## Consequences

### Positive

- **Transparent.** Both mode-transition messages are visible in the transcript.
- **Reduced duplication.** Guardrails do the enforcing; the message states the
  fact of the mode, its two hard rules, and a one-line intent — it no longer
  repeats enforcement details.
- **Less to maintain.** Opinionated guidance (Mermaid/CDN specifics, plan-doc
  policy) no longer lives in the message, where it can go stale.
- **Simpler to read.** One short message instead of a long briefing.

### Negative

- **Agent behavior is less steered.** The one-line intent hints at the goal,
  but "read broadly first" and architecture-vocabulary guidance are gone. The
  agent behaves closer to a default coding agent under restriction, so users
  who want a full architecture-style session must say so in their prompts.
- **Message wording is user-visible.** `display: true` means future edits to
  the message text appear in transcripts — wording changes should be reviewed
  like UI copy.
