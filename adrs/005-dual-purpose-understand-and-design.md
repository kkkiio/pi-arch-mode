# ADR-005: Architecture Mode as Dual-Purpose — Understanding + Design

**Status:** Accepted  
**Date:** 2026-06-12  
**Deciders:** [@kkkiio](https://github.com/kkkiio)

## Context

Architecture mode was originally conceived as a collaborative design space: the
agent helps the user explore alternatives, align on decisions, and record them
for future implementation. The system prompt reflected this single purpose:

> "Your primary goal is to understand the problem and align with the user."

This framing assumes the user already understands their codebase. But in the
Vibe Coding era, code is predominantly written by Coding Agents, not by the
user themselves. Users frequently enter a state of not understanding their own
codebase — they have a rough intent but no clear mental model of what exists.

Architecture mode needs a second, co-equal purpose: **helping the user
understand the codebase.**

Furthermore, these two purposes form a loop:

```
Understand ──→ Design ──→ (Agent builds) ──→ Drift ──→ Understand again
    ↑                                                      │
    └──────────────────────────────────────────────────────┘
```

Even after the user achieves understanding and makes design decisions, the
agent-written code that follows may drift from the constraints. The user
gradually returns to a state of not understanding. Architecture mode must be
ready for both purposes at all times.

## Decision

### 1. System prompt restructured around dual purposes

The system prompt now opens with two co-equal purposes:

1. **Help the user understand the codebase** — bridge the gap between what
   exists (agent-written) and what the user knows. Use shared architectural
   vocabulary to build a mental model quickly.
2. **Help the user design the codebase's architecture** — the original purpose
   of collaborative exploration and decision-making.

### 2. Architectural patterns as shared vocabulary

The agent is instructed to use common architectural patterns and UML-level
concepts when explaining the codebase:

- **Patterns**: MVC, layered architecture, hexagonal/ports-and-adapters,
  event-driven, CQRS, pipeline, plugin, etc.
- **UML-level concepts**: components, dependencies, data flow, boundaries,
  layers, interfaces, ports, adapters

UML is one of the few conceptual vocabularies shared by nearly all programmers.
Even without rendering actual diagrams in a TUI, speaking at this level —
describing components and their relationships — gives users a fast on-ramp to
understanding.

### 3. Plan/handoff documents are passive, not proactive

The agent must NOT write plan documents, implementation plans, or handoff
documents unless the user explicitly asks. This is enforced as a hard "do not"
in the system prompt, alongside the prohibition on implementation code.

ADR-writing remains the exception: the agent may proactively record key
decisions as ADRs to prevent them from being lost in conversation.

### 4. Mermaid.js via HTML for lightweight diagrams

The system prompt now mentions HTML files with embedded Mermaid.js as an
available output format for architectural diagrams (component diagrams, sequence
diagrams, etc.). No new tooling is needed:

- `.html` is already in `WRITEABLE_EXTENSIONS`
- Mermaid renders in any browser from a CDN `<script>` tag
- The agent can produce these as-needed; it's a pattern suggestion, not a
  mandatory output

## Options Considered

### Option A: Keep single-purpose prompt (status quo)

**Pros:** Simpler. No changes needed.

**Cons:** Misses the core use case of Vibe Coding users who don't understand
their own codebase. Leaves architecture mode as a design-only tool when it
could also serve as an understanding tool.

### Option B: Full diagram generation tooling

Add a dedicated Mermaid rendering tool to architecture mode, or integrate
with a diagram server.

**Pros:** Richer visual output. Less friction to produce diagrams.

**Cons:** Significant complexity. Requires either a headless browser or an
external rendering service. Over-investment for a feature that HTML + Mermaid
CDN already solves adequately.

### Option C: Dual-purpose with lightweight diagrams (chosen)

Restructure the system prompt for dual purposes, add guidance about
architectural patterns as shared vocabulary, and suggest Mermaid via HTML
as a lightweight diagram option.

**Pros:**
- Addresses the root insight without adding tooling complexity
- Architectural patterns as vocabulary is high-leverage — it's the conceptual
  layer, not the visualization, that carries the understanding
- HTML + Mermaid is already available; no code changes needed

**Cons:**
- Relies entirely on the LLM to follow system prompt guidance (no hard
  enforcement of pattern usage)
- Mermaid diagrams require the user to open an HTML file in a browser (moderate
  friction compared to inline rendering)

## Consequences

### Positive

- Architecture mode now explicitly addresses the Vibe Coding understanding gap
- Architectural patterns as shared vocabulary makes explanations higher-signal
  and faster to absorb
- Mermaid/HTML provides a lightweight path to visual diagrams when text isn't
  enough, with zero new infrastructure


## Related

- `extensions/arch-mode.ts` — `ARCH_SYSTEM_PROMPT`
- [ADR-001: Allow edit/write in architecture mode](./001-allow-edit-write-in-arch-mode.md)
- [ADR-004: Stand Down](./004-stand-down.md)
