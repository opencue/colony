## ADDED Requirements

### Requirement: MCP tool surface is profile-gated
The MCP stdio server SHALL resolve a tool profile at startup with precedence `COLONY_TOOL_PROFILE` env var (`lean` | `full`), then `settings.mcp.toolProfile`, then the default `lean`, and SHALL register only the `LEAN_TOOLS` set under the lean profile.

#### Scenario: Lean default surface
- **WHEN** the server is built without a profile override
- **THEN** `listTools` returns exactly the 20 `LEAN_TOOLS` entries
- **AND** the registered lean tools remain callable (regression: `apps/mcp-server/test/server.test.ts` "tool profiles" suite).

#### Scenario: Full profile restores the whole surface
- **WHEN** `COLONY_TOOL_PROFILE=full` or `settings.mcp.toolProfile` is `full` or `buildServer` receives `{ toolProfile: 'full' }`
- **THEN** every registered module tool is listed, matching the pre-change surface.

#### Scenario: Invalid env value falls back
- **WHEN** `COLONY_TOOL_PROFILE` holds a value other than `lean` or `full`
- **THEN** the profile resolves from settings (default `lean`).
