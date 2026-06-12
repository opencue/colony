---
'@colony/spec': patch
---

Windows CI green: `publishPlan` returns forward-slash `spec_change_path` / `plan_workspace_path` (separator-stable for MCP callers on every OS), and `archiveChange` fails deterministically when the archive target already exists (POSIX rename threw; Windows MoveFileEx silently clobbered).
