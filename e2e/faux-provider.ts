import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";

type FauxMessage = {
	role: "assistant";
	content: Array<
		{ type: "text"; text: string } | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
	>;
	api: string;
	provider: string;
	model: string;
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		totalTokens: number;
		cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	};
	stopReason: "stop" | "toolUse";
	timestamp: number;
};

const API = "arch-faux-api";
const PROVIDER = "arch-faux";
const MODEL_DEFAULT = "standdown";

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

class StaticAssistantStream implements AsyncIterable<unknown> {
	constructor(private readonly message: FauxMessage) {}

	async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
		yield {
			type: "start",
			partial: { ...this.message, content: [] },
		};
		yield {
			type: "done",
			reason: this.message.stopReason,
			message: this.message,
		};
	}

	result(): Promise<FauxMessage> {
		return Promise.resolve(this.message);
	}
}

function assistant(content: FauxMessage["content"], stopReason: FauxMessage["stopReason"]): FauxMessage {
	return {
		role: "assistant",
		content,
		api: API,
		provider: PROVIDER,
		model: MODEL_DEFAULT,
		usage: ZERO_USAGE,
		stopReason,
		timestamp: Date.now(),
	};
}

// Scenarios keyed by model name — each entry is an array of turn plans.
// A turn plan is an array of tool calls to emit, or null for a plain text response.
type TurnPlan = Array<{ type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }> | null;

const SCENARIOS: Record<string, TurnPlan[]> = {
	standdown: [
		[
			{
				type: "toolCall",
				id: "blocked-write",
				name: "write",
				arguments: { path: "extensions/arch-mode.ts", content: "should not be written" },
			},
			{
				type: "toolCall",
				id: "followup-read",
				name: "read",
				arguments: { path: "README.md", limit: 1 },
			},
		],
		null, // turn 2: plain text
	],
	"edit-block": [
		[
			{
				type: "toolCall",
				id: "blocked-edit",
				name: "edit",
				arguments: { path: "extensions/arch-mode.ts", oldText: "const x = 1;", newText: "const x = 2;" },
			},
			{
				type: "toolCall",
				id: "followup-read",
				name: "read",
				arguments: { path: "README.md", limit: 1 },
			},
		],
		null,
	],
	"bash-block": [
		[
			{
				type: "toolCall",
				id: "blocked-bash",
				name: "bash",
				arguments: { command: "rm -rf /tmp/test" },
			},
			{
				type: "toolCall",
				id: "followup-read",
				name: "read",
				arguments: { path: "README.md", limit: 1 },
			},
		],
		null,
	],
	"standdown-reset": [
		[
			{
				type: "toolCall",
				id: "blocked-write",
				name: "write",
				arguments: { path: "extensions/arch-mode.ts", content: "should not be written" },
			},
			{
				type: "toolCall",
				id: "followup-read",
				name: "read",
				arguments: { path: "README.md", limit: 1 },
			},
		],
		null, // Turn 1 continuation: text after tool results
		[
			{
				type: "toolCall",
				id: "next-turn-read",
				name: "read",
				arguments: { path: "README.md", limit: 1 },
			},
		],
		null, // Turn 2 continuation: text after tool result
	],
};

export default function fauxProvider(pi: ExtensionAPI): void {
	let callCount = 0;
	// Scenario determined by env var (Pi's --model doesn't reach streamSimple options).
	const scenario = process.env.ARCH_FAUX_SCENARIO ?? MODEL_DEFAULT;

	const streamSimple = (() => {
		callCount++;
		const plan = SCENARIOS[scenario];

		if (plan && callCount <= plan.length) {
			const turn = plan[callCount - 1];
			if (turn) {
				return new StaticAssistantStream(assistant(turn, "toolUse"));
			}
		}

		return new StaticAssistantStream(assistant([{ type: "text", text: "Done." }], "stop"));
	}) as unknown as NonNullable<ProviderConfig["streamSimple"]>;

	const modelIds = [
		{ id: "standdown", name: "Stand-down" },
		{ id: "edit-block", name: "Edit Block" },
		{ id: "bash-block", name: "Bash Block" },
		{ id: "exit-test", name: "Exit Test" },
		{ id: "standdown-reset", name: "Stand-down Reset" },
	];

	pi.registerProvider(PROVIDER, {
		name: "Architecture Faux Provider",
		baseUrl: "http://localhost:0",
		apiKey: "faux-key",
		api: API,
		models: modelIds.map((m) => ({
			id: m.id,
			name: m.name,
			reasoning: false,
			input: ["text"] as const,
			cost: ZERO_COST,
			contextWindow: 128000,
			maxTokens: 1024,
		})),
		streamSimple,
	});
}
