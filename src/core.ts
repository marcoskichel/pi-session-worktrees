/** Pure helpers, kept free of pi imports so test.ts can run under node --test. */

const PATH_TOKEN = /(?:~|\.{0,2}\/)[A-Za-z0-9._\-/@+]+/g;
const MAX_CANDIDATES = 40;
const MAX_SHOWN = 3;

export interface Worktree {
	branch: string;
	path: string;
	repo_root: string;
	opened_at: string;
}

/** worktree path -> worktree */
export type Worktrees = Map<string, Worktree>;

export interface Registry {
	session_id: string;
	cwd: string;
	updated_at: string;
	worktrees: Worktree[];
}

export function candidates(text: string): string[] {
	return [...new Set(text.match(PATH_TOKEN) ?? [])]
		.filter((p) => p.includes("/"))
		.slice(0, MAX_CANDIDATES);
}

/** Most recently opened first: that is the order a picker should offer them in. */
export function sorted(worktrees: Worktrees): Worktree[] {
	return [...worktrees.values()].sort((a, b) =>
		b.opened_at.localeCompare(a.opened_at),
	);
}

export function registry(
	sessionId: string,
	cwd: string,
	worktrees: Worktree[],
	now: string,
): Registry {
	return { session_id: sessionId, cwd, updated_at: now, worktrees };
}

export function format(
	worktrees: Worktrees,
	paint: (text: string) => string = (t) => t,
): string | undefined {
	if (worktrees.size === 0) return undefined;
	const all = sorted(worktrees);
	const shown = all.slice(0, MAX_SHOWN);
	const rest = all.length - shown.length;
	const names = shown.map((wt) => paint(wt.branch)).join(" ");
	return `⑂ ${names}${rest > 0 ? ` +${rest}` : ""}`;
}
