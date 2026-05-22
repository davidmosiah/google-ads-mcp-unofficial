# Privacy Audit

Live machine-readable audit: `google_ads_privacy_audit`. This doc explains what gets stored, what gets redacted, and where.

## What's stored locally

| Path | Contents | Permissions |
|---|---|---|
| `~/.google-ads-mcp/config.json` | developer_token, client_id, client_secret, login_customer_id, privacy_mode, allow_mutations | `0600` |
| `~/.google-ads-mcp/tokens.json` | access_token, refresh_token, expires_at, scope | `0600` |
| `~/.google-ads-mcp/cache.sqlite` (optional) | Cached GAQL responses, keyed by URL+body | `0600` |
| `~/.delx-wellness/profile.json` (shared) | Preferred name, language, timezone, etc. **NEVER** secrets. | `0600` |

## What's redacted in responses

In `structured` (default) and `summary` modes:

- Customer ids become `123-***-7890`
- Field values matching credential shapes (Bearer tokens, JWTs, `access_token=...`, `refresh_token=...`, `client_secret=...`, `developer-token=...`) are stripped from error messages
- Email addresses are stripped from error messages
- Any key matching `/^(access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|developer[_-]?token|authorization|password|api[_-]?key)$/i` becomes `[REDACTED]`

In `raw` mode:

- Customer ids are returned in full
- Everything else still scrubbed (we never leak secrets even in raw)

## What's logged to stderr

- HTTP retries: `[google-ads-mcp] retry N/3 after Xms (status=Y or error=Z)`
- Every mutation: `[google-ads-mcp] MUTATION <action> {"resource_name":"customers/.../adGroupCriteria/...","..."}`

Stdio transport uses stderr exclusively to avoid corrupting JSON-RPC on stdout.

## Mutation gate state

- `mutations_allowed: false` (default) — write tools throw a clear `GOOGLE_ADS_ALLOW_MUTATIONS` error
- `mutations_allowed: true` — write tools accept calls, still require `explicit_user_intent: true` per call, still log to stderr

## Audit checklist (copy into your runbook)

- [ ] `~/.google-ads-mcp/` directory is `0700`
- [ ] `config.json` and `tokens.json` are `0600`
- [ ] No `GOOGLE_ADS_*` env vars logged by your MCP client
- [ ] `GOOGLE_ADS_ALLOW_MUTATIONS` is `false` unless you're actively reviewing automated changes
- [ ] Periodic check: revoke OAuth grant at https://myaccount.google.com/permissions and re-authorize if you suspect token leakage
- [ ] `npm view google-ads-mcp-unofficial version` matches `npx -y google-ads-mcp-unofficial version` — drift means stale local cache
