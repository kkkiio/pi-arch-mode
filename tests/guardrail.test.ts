import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSafeCommand, isWriteablePath } from "../extensions/guardrail.ts";

describe("bash guardrail", () => {
	it("allows exploratory commands that are useful in supervised architecture mode", () => {
		assert.equal(isSafeCommand("gh pr view 12 --json title,body"), true);
		assert.equal(isSafeCommand("curl -L https://example.com"), true);
		assert.equal(isSafeCommand("npm run check"), true);
		assert.equal(isSafeCommand("sed -n '1,80p' README.md"), true);
	});

	it("blocks common implementation-change and workaround commands", () => {
		assert.equal(isSafeCommand("sed -i 's/foo/bar/' src/auth.ts"), false);
		assert.equal(isSafeCommand('python3 -c \'open("src/auth.ts", "w").write("x")\''), false);
		assert.equal(isSafeCommand("perl -pi -e 's/foo/bar/' src/auth.ts"), false);
		assert.equal(isSafeCommand('node -e \'require("fs").writeFileSync("src/auth.ts", "x")\''), false);
		assert.equal(isSafeCommand("git restore src/auth.ts"), false);
		assert.equal(isSafeCommand("git switch main"), false);
		assert.equal(isSafeCommand("git clean -fd"), false);
		assert.equal(isSafeCommand("git apply patch.diff"), false);
	});
});

describe("writeable path guardrail", () => {
	it("allows documentation artifacts and blocks implementation files", () => {
		assert.equal(isWriteablePath("docs/adr/005-auth-boundary.md"), true);
		assert.equal(isWriteablePath("docs/arch-mode-flow.html"), true);
		assert.equal(isWriteablePath("src/auth.ts"), false);
		assert.equal(isWriteablePath("scripts/migrate.py"), false);
	});
});
