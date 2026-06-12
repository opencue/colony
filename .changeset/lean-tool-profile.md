---
'@colony/mcp-server': minor
'@colony/config': minor
---

MCP tool profiles: the stdio server now defaults to a lean ~20-tool surface (memory + coordination primitives), cutting per-session schema-injection context cost by more than half. Set `COLONY_TOOL_PROFILE=full` or `settings.mcp.toolProfile: 'full'` to restore the entire tool surface (plan, spec, foraging, memoir, proposal, savings, queen lanes). New `mcp.toolProfile` setting in `@colony/config`.
