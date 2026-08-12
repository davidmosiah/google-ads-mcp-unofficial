# google-ads-mcp-unofficial

[![CI](https://img.shields.io/badge/CI-passing-22C55E?style=flat-square)](https://github.com/davidmosiah/google-ads-mcp-unofficial/actions)
[![npm](https://img.shields.io/npm/v/google-ads-mcp-unofficial?style=flat-square&color=cb3837&logo=npm)](https://www.npmjs.com/package/google-ads-mcp-unofficial)
[![npm downloads](https://img.shields.io/npm/dm/google-ads-mcp-unofficial?style=flat-square&color=cb3837)](https://www.npmjs.com/package/google-ads-mcp-unofficial)
[![MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-compliant-7C3AED?style=flat-square)](https://modelcontextprotocol.io)

> Unofficial Model Context Protocol server that lets AI agents read, analyze, and (gated) act on a Google Ads account — pause keywords, set bids, adjust budgets — without leaving your stack.

**Unofficial. Not affiliated with Google.** This is a local-first MCP server that speaks the Google Ads REST API directly. It does NOT include automated financial-account changes beyond what the Google Ads API allows. Always review proposed changes before enabling `GOOGLE_ADS_ALLOW_MUTATIONS`.

---

## HTTP (v2 stateless)

Default is **stdio**. Optional Streamable HTTP — no session id, JSON responses, loopback only:

```bash
npx -y google-ads-mcp-unofficial --http
# GET  http://127.0.0.1:3000/health
# POST http://127.0.0.1:3000/mcp   (sessionless)
```

Env: `GOOGLE_ADS_MCP_HOST`, `GOOGLE_ADS_MCP_PORT`, `GOOGLE_ADS_MCP_TRANSPORT=http`.


## Quick start (30 seconds)

```bash
npx -y google-ads-mcp-unofficial setup
```

The setup wizard collects your developer token + OAuth client, writes `~/.google-ads-mcp/config.json` (chmod 600), then walks you through the OAuth dance via a local callback at `http://127.0.0.1:3000/callback`.

Verify:

```bash
npx -y google-ads-mcp-unofficial doctor
```

Then add it to your agent (Claude Desktop, Cursor, Hermes, OpenClaw, Codex — see examples below).

---

## What it does

22 tools across 6 categories.

| Category | Count | Examples |
|---|---|---|
| **Meta / diagnostic** | 5 | `google_ads_connection_status`, `google_ads_capabilities`, `google_ads_agent_manifest`, `google_ads_data_inventory`, `google_ads_privacy_audit` |
| **Shared Delx profile** | 3 | `google_ads_profile_get`, `google_ads_profile_update`, `google_ads_onboarding` |
| **Auth** | 3 | `google_ads_get_auth_url`, `google_ads_exchange_code`, `google_ads_revoke_access` |
| **Reads** (always safe) | 8 | `google_ads_list_accounts`, `google_ads_list_campaigns`, `google_ads_get_campaign`, `google_ads_list_ad_groups`, `google_ads_list_keywords`, `google_ads_get_account_performance`, `google_ads_get_campaign_performance`, `google_ads_get_keyword_performance` |
| **Workflow** | 2 | `google_ads_daily_report`, `google_ads_find_waste` |
| **Mutations** (gated) | 6 | `google_ads_pause_keyword`, `google_ads_resume_keyword`, `google_ads_set_keyword_bid_micros`, `google_ads_set_campaign_budget_micros`, `google_ads_pause_campaign`, `google_ads_resume_campaign` |

Full tool reference: see `AGENTS.md`.

---

## Setup wizard

```bash
npx -y google-ads-mcp-unofficial setup [--allow-mutations] [--client hermes|claude|cursor|...]
```

What it does:

1. Prompts for: developer token, OAuth client id/secret, optional login_customer_id (MCC), redirect URI, privacy mode.
2. Writes `~/.google-ads-mcp/config.json` with `chmod 600`.
3. Writes an MCP client config (e.g. merges into `claude_desktop_config.json` on macOS; writes a Hermes block and skill file for `--client hermes`).
4. Runs the OAuth dance (unless `--no-auth`) by opening Google's consent screen and listening on `127.0.0.1:3000`.

> **Mutations are off by default.** `--allow-mutations` enables write tools. ASK THE USER before turning this on — it lets agents change campaigns, bids, budgets, and pause/resume keywords.

---

## Auth model

This MCP requires **two credentials**:

1. **Google Ads Developer Token** — from your MCC (Manager) account at https://ads.google.com/aw/apicenter. New tokens start in "Test account access" mode and need approval for production traffic.
2. **Google OAuth 2.0 Client** — a "Desktop" or "Web" client created in Google Cloud Console. The single OAuth scope used is `https://www.googleapis.com/auth/adwords`.

> ⚠️ **Refresh token gotcha:** Google only returns a `refresh_token` on first consent or after you revoke the prior grant at https://myaccount.google.com/permissions. Our `auth` flow uses `prompt=consent` to maximize the chance Google returns one — but if your code-exchange response is missing `refresh_token`, the tool will tell you to revoke and retry.

| Variable | Purpose | Stored where | Secret? |
|---|---|---|---|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Approved developer token | `~/.google-ads-mcp/config.json` or env | **yes** |
| `GOOGLE_ADS_CLIENT_ID` | OAuth client id | local or env | no |
| `GOOGLE_ADS_CLIENT_SECRET` | OAuth client secret | local or env | **yes** |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | MCC id (no dashes) | local or env | no |
| `GOOGLE_ADS_REDIRECT_URI` | OAuth callback | local or env (default `http://127.0.0.1:3000/callback`) | no |
| `GOOGLE_ADS_PRIVACY_MODE` | `summary` \| `structured` \| `raw` | local or env (default `structured`) | no |
| `GOOGLE_ADS_ALLOW_MUTATIONS` | Enable write tools | local or env (default `false`) | no |
| `GOOGLE_ADS_TOKEN_PATH` | Override token storage | local or env (default `~/.google-ads-mcp/tokens.json`) | no |
| `GOOGLE_ADS_CACHE` | Enable SQLite cache | local or env (default off) | no |
| `GOOGLE_ADS_CACHE_PATH` | Override cache path | local or env | no |
| `GOOGLE_ADS_NO_RETRY` | Disable retry middleware | env (default off) | no |

---

## Privacy modes

| Mode | What you get | Customer id |
|---|---|---|
| `summary` | id + name + status fields only | partial-redacted (`123-***-7890`) |
| `structured` (default) | flat normalized rows with metrics | partial-redacted |
| `raw` | full upstream Google Ads REST payload | **full** |

Pass `privacy_mode` per call to override the default per response.

**Redaction matrix:**

| Field | summary | structured | raw |
|---|---|---|---|
| developer_token | n/a | n/a | n/a (never returned) |
| access_token, refresh_token, client_secret | [REDACTED] in all errors | [REDACTED] | [REDACTED] |
| email addresses in error messages | [REDACTED] | [REDACTED] | [REDACTED] |
| customer_id | `123-***-7890` | `123-***-7890` | full |
| metrics (clicks, cost, etc.) | dropped | included | included |

---

## ⚠️ Mutation gating — read this

**Default: mutations are DISABLED.** Six tools are gated:

- `google_ads_pause_keyword` / `google_ads_resume_keyword`
- `google_ads_set_keyword_bid_micros`
- `google_ads_set_campaign_budget_micros`
- `google_ads_pause_campaign` / `google_ads_resume_campaign`

If an agent calls any of them without `GOOGLE_ADS_ALLOW_MUTATIONS=true`, it gets:

```
Error: Write tools are disabled. To enable: re-run `google-ads-mcp-server setup --allow-mutations`
or set GOOGLE_ADS_ALLOW_MUTATIONS=true. ASK THE USER BEFORE TURNING THIS ON — it lets agents
change campaigns, bids, budgets, and pause/resume keywords.
```

Even with the env enabled, **every mutation requires `explicit_user_intent: true`** in the per-call arguments. And every mutation is logged to stderr with the resource name:

```
[google-ads-mcp] MUTATION pause_keyword {"resource_name":"customers/1234567890/adGroupCriteria/999~111222333"}
```

Read `SECURITY.md` for the threat model.

---

## Agent client examples

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "google-ads": {
      "command": "npx",
      "args": ["-y", "google-ads-mcp-unofficial"]
    }
  }
}
```

Then restart Claude Desktop.

### Cursor / Windsurf

`~/.cursor/mcp.json` (or your IDE equivalent):

```json
{
  "mcpServers": {
    "google-ads": {
      "command": "npx",
      "args": ["-y", "google-ads-mcp-unofficial@0.1.0"]
    }
  }
}
```

### Hermes

```yaml
# ~/.hermes/config.yaml
mcp_servers:
  google-ads:
    command: npx
    args:
      - -y
      - google-ads-mcp-unofficial@0.1.0
    timeout: 120
    connect_timeout: 60
    sampling:
      enabled: false
```

Then `/reload-mcp` (do NOT restart the gateway for normal data access).

### OpenClaw

`~/.openclaw/mcp.servers.json`:

```json
{
  "google-ads": {
    "command": "npx",
    "args": ["-y", "google-ads-mcp-unofficial@0.1.0"]
  }
}
```

### Codex / TOML clients

See `examples/codex.toml` for the equivalent TOML block.

---

## Workflow examples

### 1. Daily performance pulse

```jsonc
// Agent asks: "How did my Google Ads do yesterday?"
{
  "name": "google_ads_daily_report",
  "arguments": {
    "customer_id": "1234567890",
    "cpc_alert_threshold": 0.15
  }
}
```

Returns markdown with yesterday + 7d + 30d aggregates. If yesterday's CPC exceeds 0.15, the output gets an `ALERT` banner.

### 2. Identify waste (read-only)

```jsonc
{
  "name": "google_ads_find_waste",
  "arguments": {
    "customer_id": "1234567890",
    "date_range": "LAST_30_DAYS",
    "min_clicks": 5,
    "min_cost_micros": 200000,
    "zero_conversions_only": true
  }
}
```

Returns a ranked list of keywords matching "spent ≥ $0.20 with ≥5 clicks and 0 conversions" — but never pauses them.

### 3. Pause a single keyword (mutation, gated)

After the user confirms:

```jsonc
{
  "name": "google_ads_pause_keyword",
  "arguments": {
    "customer_id": "1234567890",
    "ad_group_id": "999",
    "criterion_id": "111222333",
    "explicit_user_intent": true
  }
}
```

---

## Troubleshooting

| Symptom | Action |
|---|---|
| `Missing required Google Ads environment variables` | Run `setup` or set the env vars listed in the error. |
| `Google did not return a refresh_token` | Revoke at https://myaccount.google.com/permissions then re-run `auth`. |
| `PERMISSION_DENIED` on a read | Confirm `GOOGLE_ADS_LOGIN_CUSTOMER_ID` matches the MCC that owns the target customer (no dashes). |
| `Write tools are disabled` | Expected. Ask the user before enabling `GOOGLE_ADS_ALLOW_MUTATIONS=true`. |
| Hermes tools missing after config edit | `/reload-mcp` or `hermes mcp test google-ads`. Do NOT restart the gateway. |
| Token file insecure perms warning | `chmod 600 ~/.google-ads-mcp/tokens.json` |

---

## Support

- GitHub Issues: https://github.com/davidmosiah/google-ads-mcp-unofficial/issues
- Email: support@delx.ai
- X: [@delx369](https://x.com/delx369)

---

## Disclaimer

Unofficial integration. **Not affiliated with Google.** This MCP does not include automated financial-account changes beyond what the Google Ads REST API allows. Always review proposed changes before enabling `GOOGLE_ADS_ALLOW_MUTATIONS`. The author is not responsible for budget overruns, paused campaigns, or any other consequences of automated changes to your Google Ads account.

MIT-licensed.
