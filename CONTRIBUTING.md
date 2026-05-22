# Contributing

Thanks for the interest. This MCP is part of the Delx connector ecosystem — same template as `whoop-mcp`, `garmin-mcp`, `oura-mcp`, etc.

## Setup

```bash
git clone https://github.com/davidmosiah/google-ads-mcp-unofficial
cd google-ads-mcp-unofficial
npm install
npm test
```

`npm test` runs typecheck → build → metadata-check → smoke (boots the server, asserts tool count) → http-retry unit suite. All four must pass before publishing.

## Local dev loop

```bash
npm run dev        # tsx for fast iteration
npm run build      # compile to dist/
npm run smoke      # boot the compiled server with empty env, assert 22 tools
```

## Adding a tool

1. Add a Zod input schema to `src/schemas/common.ts`.
2. Add the tool registration to `src/tools/google-ads-tools.ts` — use `registerSearchTool` for GAQL-backed reads.
3. Add the tool name to:
   - `STANDARD_TOOLS` or `MUTATION_TOOLS` in `src/services/agent-manifest.ts`
   - `expectedTools` in `scripts/smoke-tools.mjs`
   - `src/services/capabilities.ts` under the appropriate `supported_data` category
4. If it's a mutation, gate it via `requireMutationsEnabled()` + `requireExplicitIntent()` and call `logMutation()`.
5. Update `CHANGELOG.md` and bump `version` in `package.json` + `server.json` + `src/constants.ts`.

## Privacy contract

Any new field that surfaces user data must:

- Pass through `applyPrivacy(payload, mode)` so structured mode redacts customer ids.
- Not be returned in `summary` mode unless it's identifier metadata (id/name/status).
- Not appear in error messages without being scrubbed by `redactErrorMessage`.

## Pull request checklist

- [ ] `npm test` passes locally
- [ ] CHANGELOG updated with a Tools/SOTA/Out of scope entry
- [ ] `server.json` `version` matches `package.json` `version` matches `SERVER_VERSION`
- [ ] If a new env var: documented in `server.json` `environmentVariables` and README env table
- [ ] If a new mutation: explicit_user_intent gate + stderr audit log + README mutation table updated

## Code style

- Strict TypeScript, NodeNext modules
- Avoid new npm deps — Node built-ins + the 3 in package.json (`@modelcontextprotocol/sdk`, `better-sqlite3`, `zod`)
- Tools return `makeResponse(data, format, markdown)` or `makeError(message)` — never throw past the registration handler

## License

MIT.
