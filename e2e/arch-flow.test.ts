/**
 * E2E tests for arch-mode extension using pi RPC mode.
 *
 * Three test suites:
 *   commands         — fast state-transition tests (no LLM needed)
 *   block-guardrails — tool_call/tool_result via faux provider (no API key)
 *   conversation     — full enter → explore → exit flow (needs API key)
 *
 * Usage:
 *   just test              # runs all suites (conversation skips without API key)
 *   DEEPSEEK_API_KEY=... just test
 */

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

// ── Load .env ──

function loadEnv(): void {
	try {
		const content = readFileSync(join(process.cwd(), ".env"), "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eq = trimmed.indexOf("=");
			if (eq === -1) continue;
			const key = trimmed.slice(0, eq).trim();
			if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim();
		}
	} catch {
		/* .env not found */
	}
}
loadEnv();

// ── Helpers ──

interface RpcClient {
	proc: ChildProcess;
	buffer: string;
	notifications: Array<{ message: string }>;
	events: unknown[];
	pending: Map<string, (data: unknown) => void>;
	done: boolean;
}

function spawnPi(cwd: string, extensionPath: string, extraArgs: string[] = []): RpcClient {
	const proc = spawn(
		"pi",
		["--mode", "rpc", "--no-session", "--offline", "--no-extensions", "-e", extensionPath, ...extraArgs],
		{
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env },
		},
	);

	const client: RpcClient = {
		proc,
		buffer: "",
		notifications: [],
		events: [],
		pending: new Map(),
		done: false,
	};

	proc.stdout?.on("data", (chunk: Buffer) => {
		client.buffer += chunk.toString();
		const lines = client.buffer.split("\n");
		client.buffer = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const msg = JSON.parse(line);
				client.events.push(msg);

				if (msg.type === "extension_ui_request" && msg.method === "notify") {
					client.notifications.push({ message: msg.message ?? "" });
				}
				if (msg.type === "response" && msg.id && client.pending.has(msg.id)) {
					client.pending.get(msg.id)?.(msg);
					client.pending.delete(msg.id);
				}
				if (msg.type === "agent_end") {
					client.done = true;
				}
			} catch {
				/* ignore parse errors */
			}
		}
	});

	proc.stderr?.on("data", () => {});
	proc.on("error", (err) => console.error("pi error:", err));

	return client;
}

function send(client: RpcClient, cmd: Record<string, unknown>): Promise<unknown> {
	const id = `t-${client.pending.size}`;
	const line = `${JSON.stringify({ id, ...cmd })}\n`;
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => {
			client.pending.delete(id);
			reject(new Error(`timeout: ${JSON.stringify(cmd)}`));
		}, 30000);
		client.pending.set(id, (d) => {
			clearTimeout(t);
			(resolve as (d: unknown) => void)(d);
		});
		client.proc.stdin?.write(line);
	});
}

async function prompt(client: RpcClient, message: string) {
	return send(client, { type: "prompt", message });
}

async function notifyMatch(client: RpcClient, pred: (m: string) => boolean, timeoutMs = 5000): Promise<string | null> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const i = client.notifications.findIndex((n) => pred(n.message));
		if (i !== -1) {
			const m = client.notifications[i].message;
			client.notifications.splice(i, 1);
			return m;
		}
		await sleep(50);
	}
	return null;
}

async function waitForAgentEnd(client: RpcClient, timeoutMs = 30000): Promise<unknown[]> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (client.done) return client.events;
		await sleep(200);
	}
	throw new Error("agent_end not received within timeout");
}

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

async function kill(client: RpcClient) {
	client.proc.kill();
	await sleep(200);
}

// ── Event extractors ──

interface ToolResultView {
	toolName: string;
	isError: boolean;
	text: string;
}

function extractToolResults(events: unknown[]): ToolResultView[] {
	const results: ToolResultView[] = [];
	for (const ev of events) {
		const e = ev as Record<string, unknown>;
		if (e.type !== "message_end") continue;
		const msg = e.message as Record<string, unknown> | undefined;
		if (msg?.role !== "toolResult" || !Array.isArray(msg.content)) continue;
		results.push({
			toolName: msg.toolName as string,
			isError: Boolean(msg.isError),
			text: (msg.content as Array<Record<string, unknown>>)
				.filter((block) => block.type === "text" && block.text)
				.map((block) => block.text as string)
				.join("\n"),
		});
	}
	return results;
}

function extractAssistantText(events: unknown[]): string {
	const parts: string[] = [];
	for (const ev of events) {
		const e = ev as Record<string, unknown>;
		if (e.type === "message_update" || e.type === "message_end") {
			const msg = e.message as Record<string, unknown> | undefined;
			if (msg?.role === "assistant" && Array.isArray(msg.content)) {
				for (const block of msg.content as Array<Record<string, unknown>>) {
					if (block.type === "text" && block.text) parts.push(block.text as string);
				}
			}
		}
	}
	return parts.join("");
}

/** Extract arch-mode injected messages (ARCH_MODE_MESSAGE / ARCH_EXIT_MESSAGE). */
function extractArchMessages(events: unknown[]): string[] {
	const msgs: string[] = [];
	for (const ev of events) {
		const e = ev as Record<string, unknown>;
		if (
			(e.type === "message_start" || e.type === "message_update" || e.type === "message_end") &&
			(e.message as Record<string, unknown>)?.customType === "arch-mode"
		) {
			const content = (e.message as Record<string, unknown>).content;
			if (typeof content === "string") {
				msgs.push(content);
			} else if (Array.isArray(content)) {
				for (const block of content as Array<Record<string, unknown>>) {
					if (block.type === "text" && block.text) msgs.push(block.text as string);
				}
			}
		}
	}
	return msgs;
}

// ── Temp dirs ──

const TMP_DIR = join(process.cwd(), "tmp");

function tmpDir(name: string): string {
	const dir = join(TMP_DIR, name);
	mkdirSync(dir, { recursive: true });
	return dir;
}

// ═══════════════════════════════════════════════
//  Commands suite (no LLM, fast)
// ═══════════════════════════════════════════════

describe("commands", () => {
	let cwd: string;
	let extPath: string;

	before(() => {
		cwd = tmpDir("pi-commands");
		extPath = join(process.cwd(), "extensions", "arch-mode.ts");
	});

	after(() => rmSync(TMP_DIR, { recursive: true, force: true }));

	it("enters via /arch", async () => {
		const c = spawnPi(cwd, extPath);
		try {
			await prompt(c, "/arch");
			const m = await notifyMatch(c, (s) => s.includes("Architecture mode enabled"));
			assert.ok(m);
		} finally {
			await kill(c);
		}
	});

	it("exits via /arch-off", async () => {
		const c = spawnPi(cwd, extPath);
		try {
			await prompt(c, "/arch");
			await notifyMatch(c, (s) => s.includes("enabled"));
			await prompt(c, "/arch-off");
			const m = await notifyMatch(c, (s) => s.includes("disabled"));
			assert.ok(m);
		} finally {
			await kill(c);
		}
	});

	it("rejects re-enter when already in mode", async () => {
		const c = spawnPi(cwd, extPath);
		try {
			await prompt(c, "/arch");
			await notifyMatch(c, (s) => s.includes("enabled"));
			await prompt(c, "/arch");
			const m = await notifyMatch(c, (s) => s.includes("Already"));
			assert.ok(m);
		} finally {
			await kill(c);
		}
	});
});

// ═══════════════════════════════════════════════
//  Block guardrails suite (faux LLM, no API key)
// ═══════════════════════════════════════════════

describe("block-guardrails", () => {
	const extPath = join(process.cwd(), "extensions", "arch-mode.ts");
	const fauxProviderPath = join(process.cwd(), "e2e", "faux-provider.ts");
	const fauxArgs = ["-e", fauxProviderPath, "--provider", "arch-faux"];

	function spawnFaux(scenario: string): RpcClient {
		process.env.ARCH_FAUX_SCENARIO = scenario;
		return spawnPi(process.cwd(), extPath, [...fauxArgs, "--model", scenario]);
	}

	// ── write block + stand-down ──

	it("blocks write to non-doc file and prepends stand-down to follow-up results", async () => {
		const c = spawnFaux("standdown");
		try {
			await prompt(c, "/arch");
			const enterNotify = await notifyMatch(c, (s) => s.includes("enabled"));
			assert.ok(enterNotify, "should notify mode enabled");

			await prompt(c, "Trigger the stand-down fixture.");
			await waitForAgentEnd(c);

			const results = extractToolResults(c.events);
			const blockedWrite = results.find((r) => r.toolName === "write");
			const followupRead = results.find((r) => r.toolName === "read");

			assert.ok(blockedWrite, "should capture blocked write result");
			assert.equal(blockedWrite.isError, true);
			assert.match(blockedWrite.text, /only edit documentation files/);
			assert.doesNotMatch(blockedWrite.text, /Stand down/);

			assert.ok(followupRead, "should capture follow-up read result");
			assert.equal(followupRead.isError, false);
			assert.match(followupRead.text, /Architecture mode: you were blocked/);
			assert.match(followupRead.text, /Stand down/);
		} finally {
			await kill(c);
		}
	});

	// ── edit block ──

	it("blocks edit to non-doc file and prepends stand-down to follow-up results", async () => {
		const c = spawnFaux("edit-block");
		try {
			await prompt(c, "/arch");
			await notifyMatch(c, (s) => s.includes("enabled"));

			await prompt(c, "Trigger the edit-block fixture.");
			await waitForAgentEnd(c);

			const results = extractToolResults(c.events);
			const blockedEdit = results.find((r) => r.toolName === "edit");
			const followupRead = results.find((r) => r.toolName === "read");

			assert.ok(blockedEdit, "should capture blocked edit result");
			assert.equal(blockedEdit.isError, true);
			assert.match(blockedEdit.text, /only edit documentation files/);

			assert.ok(followupRead, "should capture follow-up read result");
			assert.equal(followupRead.isError, false);
			assert.match(followupRead.text, /Stand down/);
		} finally {
			await kill(c);
		}
	});

	// ── bash block + stand-down ──

	it("blocks destructive bash and prepends stand-down to follow-up results", async () => {
		const c = spawnFaux("bash-block");
		try {
			await prompt(c, "/arch");
			await notifyMatch(c, (s) => s.includes("enabled"));

			await prompt(c, "Trigger the bash-block fixture.");
			await waitForAgentEnd(c);

			const results = extractToolResults(c.events);
			const blockedBash = results.find((r) => r.toolName === "bash");
			const followupRead = results.find((r) => r.toolName === "read");

			assert.ok(blockedBash, "should capture blocked bash result");
			assert.equal(blockedBash.isError, true);
			assert.match(blockedBash.text, /this command is blocked/);

			assert.ok(followupRead, "should capture follow-up read result");
			assert.equal(followupRead.isError, false);
			assert.match(followupRead.text, /Stand down/);
			assert.match(followupRead.text, /modifying files or system state/);
			assert.doesNotMatch(followupRead.text, /editing implementation files/);
		} finally {
			await kill(c);
		}
	});

	// ── standDownThisTurn clears on next turn ──

	it("clears stand-down on next turn after a block", async () => {
		const c = spawnFaux("standdown-reset");
		try {
			await prompt(c, "/arch");
			await notifyMatch(c, (s) => s.includes("enabled"));

			// Turn 1: blocked write + follow-up read → stand-down should appear
			await prompt(c, "Trigger the stand-down fixture.");
			await waitForAgentEnd(c);

			const results1 = extractToolResults(c.events);
			const followupRead1 = results1.find((r) => r.toolName === "read");
			assert.ok(followupRead1, "turn 1: should have follow-up read");
			assert.match(followupRead1.text, /Stand down/);

			const eventCountAfterTurn1 = c.events.length;
			c.done = false;

			// Turn 2: plain read → standDownThisTurn was reset, no stand-down
			await prompt(c, "Trigger next turn.");
			await waitForAgentEnd(c);

			const newEvents = c.events.slice(eventCountAfterTurn1);
			const results2 = extractToolResults(newEvents);
			const nextRead = results2.find((r) => r.toolName === "read" && r.isError === false);
			assert.ok(nextRead, "turn 2: should have read result");
			assert.doesNotMatch(nextRead.text, /Stand down/);
		} finally {
			await kill(c);
		}
	});

	// ── ARCH_EXIT_MESSAGE injection ──

	it("injects ARCH_EXIT_MESSAGE after exit when agent has been in mode", async () => {
		const c = spawnFaux("exit-test");
		try {
			// 1. Enter mode
			await prompt(c, "/arch");
			await notifyMatch(c, (s) => s.includes("enabled"));

			// 2. Trigger agent → before_agent_start injects ARCH_MODE_MESSAGE, sets agentThinksInArch=true
			await prompt(c, "hello");
			await waitForAgentEnd(c);
			const enterMsgs = extractArchMessages(c.events);
			const enterMsg = enterMsgs.find((m) => m.includes("You are in architecture mode"));
			assert.ok(
				enterMsg,
				`should inject ARCH_MODE_MESSAGE on first agent turn. found ${enterMsgs.length} arch messages: ${JSON.stringify(enterMsgs.map((m) => m.slice(0, 60)))}`,
			);

			c.done = false;

			// 3. Exit mode
			await prompt(c, "/arch-off");
			await notifyMatch(c, (s) => s.includes("disabled"));

			// 4. Trigger agent → before_agent_start injects ARCH_EXIT_MESSAGE
			await prompt(c, "goodbye");
			await waitForAgentEnd(c);

			const archMsgs = extractArchMessages(c.events);
			const exitMsg = archMsgs.find((m) => m.includes("deactivated"));
			assert.ok(
				exitMsg,
				`should inject ARCH_EXIT_MESSAGE on first agent turn after exit. arch messages: ${JSON.stringify(archMsgs)}`,
			);
		} finally {
			await kill(c);
		}
	});
});

// ═══════════════════════════════════════════════
//  Conversation suite (needs LLM)
// ═══════════════════════════════════════════════

const hasApiKey = Boolean(process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY);

const LLM_ARGS = hasApiKey ? ["--provider", "deepseek", "--model", "deepseek-v4-flash"] : [];

describe("conversation", { skip: !hasApiKey ? "No API key set" : false }, () => {
	const extPath = join(process.cwd(), "extensions", "arch-mode.ts");

	it("enter → explore → exit (full flow)", { timeout: 60000 }, async () => {
		const c = spawnPi(process.cwd(), extPath, LLM_ARGS);

		try {
			// 1. Enter architecture mode
			await prompt(c, "/arch");
			const enterNotify = await notifyMatch(c, (s) => s.includes("enabled"));
			assert.ok(enterNotify, "should notify mode enabled");

			// 2. Ask agent to analyze a real project file
			await prompt(c, "Read the justfile and the README.md, then tell me what this project does. Be brief.");
			await waitForAgentEnd(c);

			const response = extractAssistantText(c.events);
			assert.ok(
				response.toLowerCase().includes("architecture"),
				`Expected response to mention 'architecture', got: ${response.slice(0, 300)}`,
			);

			// 3. Exit
			await prompt(c, "/arch-off");
			const exitNotify = await notifyMatch(c, (s) => s.includes("disabled"));
			assert.ok(exitNotify, "should notify mode disabled");
		} finally {
			await kill(c);
		}
	});
});
