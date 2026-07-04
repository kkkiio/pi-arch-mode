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
const MODEL = "standdown";
const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

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
		model: MODEL,
		usage: ZERO_USAGE,
		stopReason,
		timestamp: Date.now(),
	};
}

export default function fauxStanddownProvider(pi: ExtensionAPI): void {
	let callCount = 0;

	const streamSimple = (() => {
		callCount++;
		if (callCount === 1) {
			return new StaticAssistantStream(
				assistant(
					[
						{
							type: "toolCall",
							id: "blocked-write",
							name: "write",
							arguments: {
								path: "extensions/arch-mode.ts",
								content: "should not be written",
							},
						},
						{
							type: "toolCall",
							id: "followup-read",
							name: "read",
							arguments: { path: "README.md", limit: 1 },
						},
					],
					"toolUse",
				),
			);
		}

		return new StaticAssistantStream(assistant([{ type: "text", text: "Stand-down observed." }], "stop"));
	}) as unknown as NonNullable<ProviderConfig["streamSimple"]>;

	pi.registerProvider(PROVIDER, {
		name: "Architecture Faux Provider",
		baseUrl: "http://localhost:0",
		apiKey: "faux-key",
		api: API,
		models: [
			{
				id: MODEL,
				name: "Stand-down Faux Model",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 1024,
			},
		],
		streamSimple,
	});
}
