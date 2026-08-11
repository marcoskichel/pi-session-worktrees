import assert from "node:assert/strict";
import test from "node:test";

import { candidates, format, sorted, type Worktrees } from "./core.ts";

function make(entries: [string, string][]): Worktrees {
	const worktrees: Worktrees = new Map();
	for (const [branch, opened_at] of entries) {
		const path = `/repo/_worktrees/${branch}`;
		worktrees.set(path, { branch, path, repo_root: "/repo", opened_at });
	}
	return worktrees;
}

test("candidates finds absolute, home and dot paths, deduped", () => {
	assert.deepEqual(
		candidates("read ~/dev/a/file.ts then /repo/_worktrees/x and ./src/b.ts"),
		["~/dev/a/file.ts", "/repo/_worktrees/x", "./src/b.ts"],
	);
	assert.deepEqual(candidates("cd /tmp/x && ls /tmp/x"), ["/tmp/x"]);
});

test("candidates ignores bare words with no separator", () => {
	assert.deepEqual(candidates("npm run check and or maybe"), []);
});

test("format returns undefined when nothing was touched", () => {
	assert.equal(format(new Map()), undefined);
});

test("format shows the newest branches first and counts the overflow", () => {
	const worktrees = make([
		["feat/a", "2026-01-01T00:00:00Z"],
		["fix/b", "2026-01-03T00:00:00Z"],
		["chore/c", "2026-01-02T00:00:00Z"],
		["ci/d", "2026-01-04T00:00:00Z"],
	]);
	assert.equal(format(worktrees), "⑂ ci/d fix/b chore/c +1");
});

test("sorted is newest first", () => {
	const worktrees = make([
		["feat/a", "2026-01-01T00:00:00Z"],
		["fix/b", "2026-01-03T00:00:00Z"],
	]);
	assert.deepEqual(
		sorted(worktrees).map((wt) => wt.branch),
		["fix/b", "feat/a"],
	);
});
