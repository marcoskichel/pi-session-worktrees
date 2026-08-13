/**
 * Maps the git worktrees this session actually works in: the session cwd plus every
 * path the agent or the user acts on (tool arguments, `!` bash commands), resolved to
 * its worktree root.
 *
 * Tool output is a weaker signal — one `git worktree list` mentions every worktree in
 * the repo — so a path seen only in output counts only when that directory was created
 * during this session, which is how a worktree the run just made gets picked up.
 *
 * A path that names a worktree the run is about to create does not exist yet when it is
 * first seen, so unresolved paths are kept and retried after later tool calls.
 *
 * Only linked worktrees count. The main checkout is not interesting: external tools
 * already know it.
 *
 * The map is mirrored to ~/.pi/session-worktrees/<session-id>.json so tmux pickers,
 * shell scripts, and other outside tooling can read it.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import {
	candidates,
	format,
	type Registry,
	registry,
	sorted,
	type Worktree,
	type Worktrees,
} from "./core.ts";

const GIT_TIMEOUT_MS = 10_000;
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PENDING = 50;
const REGISTRY_DIR = join(homedir(), CONFIG_DIR_NAME, "session-worktrees");

function absolute(candidate: string, cwd: string): string {
	const expanded = candidate.startsWith("~")
		? join(homedir(), candidate.slice(1))
		: candidate;
	return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

function registryFile(ctx: ExtensionContext): string | undefined {
	const file = ctx.sessionManager.getSessionFile();
	if (!file) return undefined;
	return join(REGISTRY_DIR, `${basename(file).replace(/\.jsonl$/, "")}.json`);
}

/** Sessions die without a shutdown hook often enough that old registries must age out. */
function pruneStale(): void {
	if (!existsSync(REGISTRY_DIR)) return;
	for (const name of readdirSync(REGISTRY_DIR)) {
		const file = join(REGISTRY_DIR, name);
		if (Date.now() - statSync(file).mtimeMs > STALE_MS) unlinkSync(file);
	}
}

function restore(file: string | undefined, worktrees: Worktrees): void {
	if (!file || !existsSync(file)) return;
	try {
		const saved = JSON.parse(readFileSync(file, "utf8")) as Registry;
		for (const wt of saved.worktrees ?? []) {
			if (existsSync(wt.path)) worktrees.set(wt.path, wt);
		}
	} catch {
		// A truncated or hand-edited registry must not stop the session from starting.
	}
}

export default function (pi: ExtensionAPI) {
	const worktrees: Worktrees = new Map();
	const seenDirs = new Set<string>();
	const pending = new Set<string>();
	let sessionStart = Date.now();

	/**
	 * ponytail: birthtime only. Filesystems without it report ctime instead, so there a
	 * recently modified old worktree can slip in through tool output. Harmless enough.
	 */
	const createdThisSession = (dir: string) => {
		try {
			return statSync(dir).birthtimeMs >= sessionStart;
		} catch {
			return false;
		}
	};

	const persist = (ctx: ExtensionContext) => {
		const file = registryFile(ctx);
		if (!file) return;
		for (const path of worktrees.keys()) {
			if (!existsSync(path)) worktrees.delete(path);
		}
		mkdirSync(REGISTRY_DIR, { recursive: true });
		const payload = registry(
			basename(file, ".json"),
			ctx.cwd,
			sorted(worktrees),
			new Date().toISOString(),
		);
		writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
	};

	const render = (ctx: ExtensionContext) => {
		ctx.ui.setStatus(
			"worktrees",
			format(worktrees, (t) => ctx.ui.theme.fg("accent", t)),
		);
	};

	/** Never throws: a git hiccup must not take the pi process down. */
	const inspect = async (dir: string) => {
		try {
			const res = await pi.exec(
				"git",
				[
					"-C",
					dir,
					"rev-parse",
					"--path-format=absolute",
					"--show-toplevel",
					"--git-common-dir",
					"--git-dir",
					"--abbrev-ref",
					"HEAD",
				],
				{ timeout: GIT_TIMEOUT_MS },
			);
			if (res.code !== 0) return undefined;
			const [toplevel, common, gitDir, branch] = res.stdout.trim().split("\n");
			if (!toplevel || gitDir === common) return undefined;
			return {
				branch,
				path: toplevel,
				repo_root: dirname(common),
				opened_at: new Date().toISOString(),
			} as Worktree;
		} catch {
			return undefined;
		}
	};

	/** `used` marks paths the session acted on, as opposed to ones it merely printed. */
	const track = async (
		ctx: ExtensionContext,
		paths: string[],
		used: boolean,
	) => {
		let changed = false;
		for (const candidate of paths) {
			const abs = absolute(candidate, ctx.cwd);
			if (!existsSync(abs)) {
				if (used && pending.size < MAX_PENDING) pending.add(candidate);
				continue;
			}
			pending.delete(candidate);
			const dir = statSync(abs).isDirectory() ? abs : dirname(abs);
			if (seenDirs.has(dir) || worktrees.has(dir)) continue;
			// Not cached: the same dir may still arrive later as a path the session uses.
			if (!used && !createdThisSession(dir)) continue;
			seenDirs.add(dir);
			const wt = await inspect(dir);
			if (!wt || worktrees.has(wt.path)) continue;
			worktrees.set(wt.path, wt);
			changed = true;
		}
		return changed;
	};

	const update = async (
		ctx: ExtensionContext,
		paths: string[],
		used: boolean,
	) => {
		if (!(await track(ctx, paths, used))) return;
		render(ctx);
		persist(ctx);
	};

	pi.on("session_start", async (_event, ctx) => {
		worktrees.clear();
		seenDirs.clear();
		pending.clear();
		sessionStart = Date.now();
		pruneStale();
		restore(registryFile(ctx), worktrees);
		await track(ctx, [ctx.cwd], true);
		render(ctx);
		persist(ctx);
	});

	pi.on("tool_execution_start", async (event, ctx) => {
		await update(ctx, candidates(JSON.stringify(event.args ?? "")), true);
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		await update(ctx, [...pending], true);
		await update(ctx, candidates(JSON.stringify(event.result ?? "")), false);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		await update(ctx, [...pending], true);
	});

	pi.on("user_bash", async (event, ctx) => {
		await update(ctx, candidates(event.command), true);
	});

	pi.registerCommand("worktrees", {
		description: "Open a worktree from this session in a new tmux window",
		handler: async (_args, ctx) => {
			const all = sorted(worktrees);
			if (all.length === 0)
				return ctx.ui.notify("No worktrees in this session", "info");
			const labels = all.map((wt) => `${wt.branch}  ${wt.path}`);
			const picked = await ctx.ui.select("Open worktree", labels);
			const wt = picked ? all[labels.indexOf(picked)] : undefined;
			if (!wt) return;
			const res = await pi
				.exec("tmux", ["new-window", "-c", wt.path], {
					timeout: GIT_TIMEOUT_MS,
				})
				.catch(() => undefined);
			if (res?.code !== 0) ctx.ui.notify(wt.path, "info");
		},
	});
}
