# Security Policy

## Reporting a vulnerability

Email **support@delx.ai** with subject `SECURITY: google-ads-mcp-unofficial`.

We aim to acknowledge within 72 hours and ship a fix or mitigation within 14 days for confirmed issues.

## Scope

In scope:
- The MCP server code in this repository (`src/`).
- The HTTP retry middleware, OAuth token storage, privacy redaction, and mutation gating.
- The local config file format and permissions.

Out of scope:
- The Google Ads REST API itself (report to Google).
- The user's MCP client (Claude Desktop, Cursor, Windsurf, Hermes, OpenClaw — report upstream).
- The user's OS-level credential storage.

## Hardening notes

- **OAuth tokens** are stored at `~/.google-ads-mcp/tokens.json` with `0600` permissions, never returned by tools, and never logged.
- **Developer token + client secret** live in `~/.google-ads-mcp/config.json` (`0600`) when written via setup; you may also pass them via env vars.
- **Error messages** are scrubbed by `redactErrorMessage` to remove `Bearer ...`, `access_token=...`, `refresh_token=...`, `client_secret=...`, `developer-token=...`, and email addresses before they leave the process.
- **Customer ids** are partial-redacted (`123-***-7890`) in default `structured` privacy mode. `raw` mode returns full ids — opt-in only.
- **Mutations are disabled by default** behind `GOOGLE_ADS_ALLOW_MUTATIONS=true`. Every mutation is logged to stderr with the resource name. Enable only after explicit user approval.
- **Stdio transport** logs to stderr exclusively to avoid corrupting JSON-RPC on stdout.

## Recommended user posture

- Use a dedicated Google Cloud OAuth client for this MCP, separate from production apps.
- Use a dedicated Google Ads developer token (not your team's shared production token).
- Review every mutation diff before re-enabling `GOOGLE_ADS_ALLOW_MUTATIONS` after a quiet period.
- Rotate the OAuth grant if you suspect leakage: revoke at https://myaccount.google.com/permissions then `google-ads-mcp-server auth`.
