# pi-arch-mode

<p align="center">
  <img src="./logo.png" alt="pi-arch-mode logo" width="300" />
</p>

A Pi extension that puts the coding agent into **architecture mode** for supervised architecture sessions: understanding an agent-written codebase, exploring design alternatives, and recording decisions without immediately turning the conversation into implementation.

```text
You: /arch Why is this codebase hard to change?

Pi: Architecture mode enabled.
Status: 🏗️ arch mode

Pi -> Agent: You are in architecture mode.
             You cannot modify implementation code.
             You cannot run destructive commands.
             Focus on understanding the codebase and designing its architecture.

Agent: I'll first map the current module boundaries and data flow, then we can
       decide where the design pressure is coming from.
```

It serves two co-equal purposes:

1. **Help you understand your codebase.** In the Vibe Coding era, code is often written by agents, so you may not have a clear mental model of what exists. Architecture mode bridges that gap with common architecture vocabulary: MVC, layered systems, hexagonal architecture, event-driven flows, components, dependencies, data flow, and boundaries.

2. **Help you design its architecture.** Collaborate with the agent to explore alternatives, surface hidden assumptions and trade-offs, and make deliberate architectural decisions.

These two purposes form a natural loop: Understand → Design → (Agent builds) → Things drift → Understand again.

## Installation

```bash
pi install npm:@kkkiio/pi-arch-mode
```

Or install from git:

```bash
pi install git:github.com/kkkiio/pi-arch-mode
```

Or install locally for development:

```bash
# cd /path/to/pi-arch-mode
pi install .
```

## Usage

Enter architecture mode:

```
/arch
```

Or enter with a topic:

```
/arch I need to figure out how to handle multi-tenant data isolation
```

Exit architecture mode:

```
/arch-off
```

The status bar shows `🏗️ arch mode` while active.

## Features

### Mode Message

Architecture mode lazily injects a short context message when the agent needs to learn that the mode changed (entering or exiting). The message is minimal by design (ADR-006) — it states that architecture mode is active, its two hard rules, and a one-line intent (focus on understanding and design):

- No modifying implementation code
- No commands known to be destructive

Detailed behavioral guidance (read broadly, architecture vocabulary, documentation workflow) is intentionally left out of the injected message — ask for it in your prompts when you want it.

Both mode-transition messages are delivered with `display: true`, so they appear in the transcript and you see exactly what the agent was told about the mode.

The message is added to the transcript, not the system prompt. Architecture mode does not replace the system prompt or change the active tool set, so switching modes avoids prefix-cache churn and does not interfere with other extensions' tools.

### Tool Blocking

Architecture mode blocks direct `edit` and `write` calls on non-documentation files. It also blocks bash commands that match known destructive patterns. Exploratory and diagnostic commands can still run when they do not match those patterns, which keeps commands like `gh pr view`, `curl`, and build/status checks usable during supervised sessions.

This is a collaboration guardrail, not a security sandbox. If you need to run an untrusted or adversarial agent, use a real sandbox.

```text
Agent: [tries to edit src/auth.ts]

Pi: Architecture mode: you can only edit documentation files
    (.md, .mdx, .txt, .html, .yaml, .yml, .json).
    "src/auth.ts" looks like implementation code.

Agent: I'll stop before changing code. I can write the proposed design decision
       to an ADR, or you can exit architecture mode if you want implementation.
```

### Stand-Down Feedback

When the agent is blocked, architecture mode keeps reminding it for the rest of the turn. Successful follow-up tool results are prepended with a stand-down message so the agent does not treat the block as a puzzle to route around.

```text
Agent: [tries to edit src/auth.ts]
Pi: Architecture mode blocked this tool call.

Agent: [then tries another tool]
Pi -> Agent (tool result): 🛑 Architecture mode: you were blocked from editing
                           implementation files earlier this turn. Stand down.
                           Do NOT try workarounds with python, sed, bash, or
                           any other tool.

Agent: I should pause here. Do you want me to document the proposed change, or
       should we leave architecture mode?
```

## Relationship to automated development loops

Architecture mode is designed to be the **upstream input** for automated agent workflows ("Loop"): align on goals, constraints, and key decisions here, then let automated loops decompose tasks, write code, review, and iterate based on those decisions.
