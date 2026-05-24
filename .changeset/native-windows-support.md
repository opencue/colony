---
'colonyq': patch
---

Native Windows support for the `colony` CLI. The bin entry was a POSIX shell
script (`bin/colony.sh`) that npm could not execute on Windows without WSL,
breaking every Windows install of the package. The shim is now a Node ES
module (`bin/colony.mjs`) using only `node:*` builtins, so npm's generated
`.cmd` / `.ps1` wrappers run it natively under cmd, PowerShell, and Git Bash.

The daemon fast-path for `colony bridge lifecycle --json` is preserved — the
HTTP POST to `127.0.0.1:$COLONY_WORKER_PORT/api/bridge/lifecycle` now goes
through `node:http`, with a `node:net` connect probe (1s) before the request
(2s) so the fallback latency stays close to the curl-based version when the
daemon isn't running. Stdin is buffered and replayed on fallback, preserving
rule #10 (a dead daemon must never lose or block a write).

CI now runs the build matrix on `ubuntu-latest`, `macos-latest`, and
`windows-latest` across Node 20 and 22 so this regression cannot recur.
