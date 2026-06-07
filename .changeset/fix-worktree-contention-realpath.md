---
"@colony/core": patch
---

Fix worktree-contention detection on macOS and Windows. `isGitWorktree` compared
`git rev-parse --show-toplevel` (a fully realpath'd path) against a merely
`resolve()`'d scan path. `resolve()` does not collapse symlinks (macOS
`/var` -> `/private/var`), 8.3 short names, or case (Windows), so every managed
worktree was dropped and `worktree_count` came back 0 — failing
`readWorktreeContentionReport` on the macOS/Windows CI matrix. Both sides are now
canonicalised with `realpathSync.native` (falling back to `resolve` when the path
can't be stat'd). Added a regression test that reaches the repo through an
absolute symlink, reproducing the condition on any platform.
