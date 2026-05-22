# OpenClaw installation

Add the MCP server to your OpenClaw config (e.g. `~/.openclaw/mcp.servers.json`):

```json
{
  "google-ads": {
    "command": "npx",
    "args": ["-y", "google-ads-mcp-unofficial@0.1.0"]
  }
}
```

Then run setup to write the local credentials file:

```bash
npx -y google-ads-mcp-unofficial setup
```

## Verify

```bash
npx -y google-ads-mcp-unofficial doctor
```

## Mutations

Mutations are off by default and require:

1. `GOOGLE_ADS_ALLOW_MUTATIONS=true` (env or config)
2. `explicit_user_intent: true` in every mutation call

OpenClaw operators should ask the user explicitly before enabling either gate.
