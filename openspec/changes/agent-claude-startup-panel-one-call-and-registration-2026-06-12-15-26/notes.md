# startup_panel one-call startup + registration cost telemetry (T1)

Why: AGENTS.md mandated a 4-call startup sweep; startup_panel already existed but lacked the lane map, attention summary, and profile hint needed to stand alone. The lean-profile work (#588) also left registration cost unmeasured at runtime.

What:
- startup_panel payload gains compact_hivemind {lane_count, lanes[{agent,branch,activity,task}]}, attention_summary {unread, blocking, pending_handoffs}, tool_profile.
- AGENTS.md Colony loop: ONE startup_panel call, escalation rules for attention_inbox / task_ready_for_agent / search, legacy sweep deprecated (agents-contract test updated mentions kept in required order).
- buildServer instruments registrations (gateToolRegistration onRegister) into ToolRegistrationStats; savings_report emits registration_cost {profile, tool_count, name_description_tokens} (schema-inclusive budgets stay in tool-budget.test.ts).

Verification: pnpm typecheck/lint/test/build green; startup-panel + server suites extended.
