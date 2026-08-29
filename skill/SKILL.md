---
name: google-ads-mcp
description: >
  Unofficial Google Ads MCP. Dual MCP/CLI surface. Operator playbooks live in the separate google-ads skill suite — do not duplicate them here. Prefer MCP tools if connected; otherwise the package CLI.
  Use when the user wants Google Ads MCP data or actions through an agent.
---

# Google Ads MCP — skill or MCP

Same binary either way. Do not duplicate the API client.

## Choose a surface

**MCP** — tools appear natively after stdio/HTTP config:

```json
{ "mcpServers": { "google-ads-mcp": { "command": "npx", "args": ["-y", "google-ads-mcp-unofficial"] } } }
```

Do not put mutation flags in that snippet.

**Skill / CLI** — no MCP client required. Same tools:

```bash
npx -y google-ads-mcp-unofficial call google_ads_connection_status --json '{}'
```

If MCP tools named `google_*` are already available, use them. Do not also shell out.

Operator playbooks (intent map, negatives, drafts) live in the separate google-ads skill suite. This file is only the MCP-or-CLI surface for the unofficial Ads MCP.

## Loop

1. Call `google_ads_connection_status` (or `doctor --json` when that exists).
2. Use read tools as asked.
3. Stop on `USER_ACTION_REQUIRED`. Do not invent env flags. Do not enable mutations from this skill.

## Never

- Paste tokens into git, chat logs, or the prompt
- Copy a mutations-enabled assignment into config
