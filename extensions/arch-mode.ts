/**
 * Architecture Mode Extension
 *
 * Puts the agent into architecture mode — a guardrail for exploration,
 * understanding, and decision-making. The agent can read and write
 * documentation but cannot touch implementation code. Switching modes
 * has zero performance impact: no system prompt or tool set manipulation.
 *
 * Features:
 * - /arch [topic] command to enter architecture mode
 * - /arch-off command to leave architecture mode
 * - Bash restricted to safe read-only commands
 * - Edit/write allowed only on documentation files
 * - Stand-down mechanism prevents workarounds after rejection
 * - State persists across sessions and forks
 * - Zero prefix cache impact
 * - pi.events for extension-to-extension RPC
 */

import type { ExtensionAPI, ExtensionContext, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { WRITEABLE_EXTENSIONS, isSafeCommand, isWriteablePath } from "./guardrail";

// ── Constants ──

const STATUS_KEY = "arch-mode";
const STATE_ENTRY_TYPE = "arch-mode-state";

// ── Types ──

interface ArchState {
	enabled: boolean;
	agentThinksInArch: boolean;
}

// ── Architecture mode message (injected into transcript, not system prompt) ──

const ARCH_MODE_MESSAGE = `You have entered architecture mode — a mode for exploration, understanding, and design.

Architecture mode serves two co-equal purposes:

1. Help the user understand the codebase. Since code is often written by agents,
   users may lack a clear mental model. Your job is to bridge that gap — use
   common architectural patterns (MVC, layered, hexagonal, event-driven, etc.)
   and UML-level concepts (components, dependencies, data flow, boundaries) as
   a shared vocabulary to explain the codebase in terms the user already knows.

2. Help the user design its architecture. Collaborate to explore alternatives,
   surface hidden assumptions, trade-offs, and make deliberate architectural
   decisions.

Read broadly first — understand before suggesting.

When relevant, you can write documentation files (.md, .mdx, .txt, .html, .yaml,
.yml, .json). For architecture diagrams, write an HTML file embedding Mermaid.js
— import from https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs
and use <pre class="mermaid"> blocks.

Do NOT write or modify implementation code (.ts, .js, .rs, .py, .go, etc.).
Do NOT proactively write plan documents or handoff documents — only when the
user explicitly asks.

If a tool or command is blocked, pause and explain why. Ask the user how to
proceed. Do NOT try workarounds.`;

const ARCH_EXIT_MESSAGE = "Architecture mode deactivated. Full tool access restored.";

// ── Extension ──

export default function archMode(pi: ExtensionAPI): void {
	const state: ArchState = { enabled: false, agentThinksInArch: false };
	let standDownThisTurn = false;
	let savedCtx: ExtensionContext | undefined;

	// ── Helpers ──

	function updateStatus(ctx: ExtensionContext): void {
		if (state.enabled) {
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", "🏗️ arch mode"));
		} else {
			ctx.ui.setStatus(STATUS_KEY, undefined);
		}
	}

	function persistState(): void {
		pi.appendEntry(STATE_ENTRY_TYPE, {
			enabled: state.enabled,
			agentThinksInArch: state.agentThinksInArch,
		});
	}

	function broadcastState(): void {
		pi.events.emit("arch:state-changed", { enabled: state.enabled });
	}

	function appendStandDown(original: ToolResultEvent["content"], message: string): ToolResultEvent["content"] {
		return [{ type: "text", text: message }, ...original];
	}

	function enterMode(ctx: ExtensionContext): void {
		if (state.enabled) {
			ctx.ui.notify("Already in architecture mode.", "info");
			return;
		}

		state.enabled = true;
		persistState();
		updateStatus(ctx);
		broadcastState();

		ctx.ui.notify("Architecture mode enabled.", "info");
	}

	function exitMode(ctx: ExtensionContext): void {
		if (!state.enabled) {
			ctx.ui.notify("Not in architecture mode.", "info");
			return;
		}

		state.enabled = false;
		persistState();
		updateStatus(ctx);
		broadcastState();

		ctx.ui.notify("Architecture mode disabled. Full tool access restored.", "info");
	}

	// ── Command Registration ──

	pi.registerCommand("arch", {
		description: "Enter architecture mode for deep exploration and decision-making. Optionally provide a topic.",
		handler: async (args, ctx) => {
			const topic = args.trim();

			if (state.enabled) {
				if (topic) {
					pi.sendUserMessage(topic);
				} else {
					ctx.ui.notify("Already in architecture mode. Use /arch-off to exit.", "info");
				}
				return;
			}

			enterMode(ctx);

			if (topic) {
				pi.sendUserMessage(topic);
			}
		},
	});

	pi.registerCommand("arch-off", {
		description: "Exit architecture mode and restore full tool access.",
		handler: async (_args, ctx) => {
			exitMode(ctx);
		},
	});

	// ── Event-based RPC (extension-to-extension) ──

	pi.events.on("cmd:arch:enter", () => {
		if (!savedCtx) return;
		enterMode(savedCtx);
	});

	pi.events.on("cmd:arch:exit", () => {
		if (!savedCtx || !state.enabled) return;
		exitMode(savedCtx);
	});

	// ── Lifecycle Events ──

	pi.on("session_start", async (_event, ctx) => {
		savedCtx = ctx;
		pi.events.emit("arch:ready", undefined);

		const entries = ctx.sessionManager.getEntries();
		const archEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === STATE_ENTRY_TYPE)
			.pop() as { data?: Partial<ArchState> } | undefined;

		if (archEntry?.data) {
			state.enabled = archEntry.data.enabled ?? false;
			state.agentThinksInArch = archEntry.data.agentThinksInArch ?? false;
			if (state.enabled) {
				ctx.ui.notify("Architecture mode restored from previous session.", "info");
			}
		}

		updateStatus(ctx);

		if (state.enabled) {
			broadcastState();
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});

	// Lazy message delivery: inject mode/exit messages only when the agent's
	// knowledge is stale relative to the current mode state. enterMode() and
	// exitMode() do NOT touch state.agentThinksInArch — before_agent_start is the
	// only place that modifies it.
	pi.on("before_agent_start", async () => {
		if (state.enabled && !state.agentThinksInArch) {
			state.agentThinksInArch = true;
			persistState();
			return {
				message: {
					customType: "arch-mode",
					content: ARCH_MODE_MESSAGE,
					display: false,
				},
			};
		}

		if (!state.enabled && state.agentThinksInArch) {
			state.agentThinksInArch = false;
			persistState();
			return {
				message: {
					customType: "arch-mode",
					content: ARCH_EXIT_MESSAGE,
					display: false,
				},
			};
		}
	});

	pi.on("tool_call", async (event) => {
		if (!state.enabled) return;

		// Guard edit/write to documentation-only files
		if (event.toolName === "edit" || event.toolName === "write") {
			const path = event.input?.path as string | undefined;
			if (path && !isWriteablePath(path)) {
				standDownThisTurn = true;
				return {
					block: true,
					reason: `Architecture mode: you can only edit documentation files (${WRITEABLE_EXTENSIONS.join(", ")}). "${path}" looks like implementation code. Write your analysis as a Markdown document instead, or ask the user if they want to exit architecture mode.`,
				};
			}
		}

		// Guard bash to safe commands only
		if (event.toolName === "bash") {
			const command = event.input.command as string;
			if (!isSafeCommand(command)) {
				standDownThisTurn = true;
				return {
					block: true,
					reason: `Architecture mode: this command is blocked because it may modify files or system state. Explain what you were trying to do and ask how to proceed.\n\nCommand: ${command}`,
				};
			}
		}
	});

	// Append stand-down message when agent was blocked earlier this turn
	pi.on("tool_result", async (event, _ctx) => {
		if (!state.enabled) return;
		if (event.isError) return;

		if (standDownThisTurn) {
			const message =
				"🛑 Architecture mode: you were blocked from editing implementation files " +
				"earlier this turn. Stand down — stop and align with the user. Do NOT try " +
				"workarounds with python, sed, bash, or any other tool. Ask the user how " +
				"they want to proceed, or suggest exiting architecture mode with /arch-off.";
			return { content: appendStandDown(event.content, message) };
		}
	});

	pi.on("turn_start", () => {
		standDownThisTurn = false;
	});
}
