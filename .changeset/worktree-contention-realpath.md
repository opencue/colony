---
"@colony/core": patch
---

Fix the worktree-contention report silently dropping worktrees whose path
crosses a symlink (e.g. macOS's `/var` -> `/private/var` tmpdir). `git
rev-parse --show-toplevel` returns a symlink-resolved path, but the detector
compared it with `resolve()`, which only normalizes — so the paths never
matched and the worktree was skipped. It now compares `realpathSync`
-canonicalized paths on both sides.
