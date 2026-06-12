---
'@colony/mcp-server': minor
---

One-call startup + registration-cost telemetry. `startup_panel` now carries `compact_hivemind` (lane map), `attention_summary` ({unread, blocking, pending_handoffs}), and `tool_profile` (lean/full, so agents know whether to restart with COLONY_TOOL_PROFILE=full for plan/spec/memoir tools) — AGENTS.md blesses it as THE startup call, with the legacy 4-call sweep deprecated but working. `savings_report` gains `registration_cost` ({profile, tool_count, name_description_tokens}) so the per-session schema-injection cost is observable.
