# pi-session-worktrees

A [pi](https://github.com/badlogic/pi-mono) extension that maps the git worktrees the current session is working in, shows them in the footer as `⑂ feat/a fix/b`, and publishes them as JSON so outside tools (tmux pickers, shell scripts) can offer the same list.

Worktrees are detected automatically: the session cwd, every path in a tool call, and every path in a `!` bash command are resolved to their worktree root. Only linked worktrees are mapped — the main checkout is left out because external tools already know it.

## Install

```bash
pi install npm:pi-session-worktrees
```

Or add a local checkout to `~/.pi/agent/settings.json`:

```json
{
  "extensions": ["/path/to/pi-session-worktrees/src/index.ts"]
}
```

## Usage

- The footer shows `⑂ ci/d fix/b chore/c +1`, newest first, up to 3 entries plus a `+n` overflow count.
- `/worktrees` — pick a worktree from this session and open it in a new tmux window (falls back to showing the path).

## External integration

Each session writes `~/.pi/session-worktrees/<session-id>.json`:

```json
{
  "session_id": "3f1c...",
  "cwd": "/Users/me/dev/repo",
  "updated_at": "2026-02-01T12:00:00.000Z",
  "worktrees": [
    {
      "branch": "feat/a",
      "path": "/Users/me/dev/repo/_worktrees/feat/a",
      "repo_root": "/Users/me/dev/repo",
      "opened_at": "2026-02-01T11:59:00.000Z"
    }
  ]
}
```

Entries pointing at deleted directories are dropped on every write, and registry files untouched for 7 days are pruned at session start.

A tmux picker for the session that most recently touched the current repo:

```bash
git worktree list --porcelain | awk '/^worktree /{sub("^worktree ","");print}' \
  | jq -Rs 'split("\n") | map(select(length > 0))' > /tmp/paths.json

jq -rs --slurpfile paths /tmp/paths.json '
  map(select(.worktrees | any(.path as $p | $paths[0] | index($p))))
  | sort_by(.updated_at) | last
  | .worktrees[] | "\(.branch)\t\(.path)"
' ~/.pi/session-worktrees/*.json | fzf --with-nth=1 --delimiter='\t'
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).
