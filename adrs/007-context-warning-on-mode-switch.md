# ADR-007: Context warning on mode switch

**Status:** Accepted
**Date:** 2026-06-27
**Deciders:** [@kkkiio](https://github.com/kkkiio), [@windingwind](https://github.com/windingwind)

## Context

Architecture mode replaces the system prompt via `before_agent_start`. This
invalidates the LLM provider's prefix cache (KV-cache). On the next user
message, the provider must recompute the entire context from scratch.

In short conversations this is negligible. But when the user has been discussing
for a long time in one mode (arch mode or normal mode) and then switches, the
context may contain 100K+ tokens. Cache invalidation at that scale produces a
noticeable increase in latency and cost.

The `/arch` and `/arch-off` commands only mutate internal state — no LLM
request is sent. The cache miss happens when the user sends their next message.
There is a time window between the command and the next message where a warning
could inform the user.

## Decision

**Show a non-blocking notification warning when switching modes with a large context.**

When `enterMode` or `exitMode` completes the switch, it checks
`ctx.getContextUsage()`. If the estimated context exceeds 100,000 tokens, a
`warning`-level notification is shown:

> ⚠️ Context: ~150K tokens. Mode switch invalidates prefix cache; next LLM call
> may be slower. Consider /new (fresh session) or /compact before switching.

### Design choices

**Threshold: 100,000 tokens.** Most modern LLMs have 200K–1M context windows.
Below 100K, cache invalidation is fast enough to be imperceptible. Above 100K,
the recomputation cost becomes noticeable.

**Notification, not confirmation dialog.** A modal dialog would interrupt the
flow and annoy power users who understand the trade-off. The notification is
visible but non-blocking — the user can act on it or ignore it.

**Timing: shown after the switch.** The warning is emitted after
`setActiveTools` and state change, before the user sends their next message.
The window is sufficient because no LLM request is in flight.

**Suggestions: `/new` and `/compact`.** Two mitigation options:

| Option | Effect |
|--------|--------|
| `/new` | Start a fresh session with the new mode. No history carried over — zero cache cost, but loses conversation context. |
| `/compact` | Compress the existing context before switching. Reduces the recomputation cost but preserves the conversation summary. |

**`/fork` is deliberately not suggested.** While `/fork` preserves the original
session's cache, the forked session still inherits the full conversation
history and will incur the same cache miss on its first LLM call. It solves
"don't break the existing cache" but not "the new session's first call is slow."

## Consequences

### Positive

- Users are informed of the performance implication before they commit to the
  next LLM call.
- Power users can dismiss the notification and proceed; newcomers learn about
  `/compact` and `/new`.
- No blocking behavior — the warning adds information without friction.

### Negative

- `getContextUsage()` may return `null` for tokens (e.g., right after
  compaction), in which case no warning is shown — a missed opportunity.
- The notification is a single transient message; a user who looks away might
  miss it. Mitigation: the information is also documented in README.md.

## Related

- [ADR-006](./006-unified-hook-interception.md): Unified hook interception
- [Prefix cache analysis](./prefix-cache-analysis.html): Detailed analysis of cache-breaking behaviors in Pi
