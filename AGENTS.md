# Agent-facing usage — google-ads-mcp-unofficial

This document tells AI agents how to operate the Google Ads MCP safely.

## Tool count: 22

- 5 meta/diagnostic — always safe, no API calls
- 3 shared profile — read/write `~/.delx-wellness/profile.json`
- 3 auth — OAuth lifecycle
- 8 reads — GAQL queries against Google Ads REST
- 2 workflow — synthesized reports/audits, always read-only
- 6 mutations — GATED by `GOOGLE_ADS_ALLOW_MUTATIONS=true`

## Agent first-call ladder

1. `google_ads_connection_status` — verify env + token are ready
2. `google_ads_data_inventory` — see categories + tool roster
3. `google_ads_list_accounts` — discover the customer_id to operate on
4. `google_ads_daily_report({ customer_id })` — fast performance pulse
5. `google_ads_find_waste({ customer_id })` — identify cleanup candidates (read-only)

## Hard rules (do not violate)

1. **Mutations are off by default.** Before suggesting the user enable `GOOGLE_ADS_ALLOW_MUTATIONS=true`, explicitly ask. Do not silently set it.
2. **One change at a time.** When mutations are enabled, do not batch pauses or bid changes across many keywords without explicit confirmation per change.
3. **`explicit_user_intent: true` is required on every mutation call.** Even after env-level enable.
4. **Frame outputs as marketing operations, not financial advice.**
5. **Customer ids leak account scale.** Default to `structured` privacy mode (partial-redacted). Use `raw` only when the user needs the full id.
6. **Daily report is read-only.** It synthesizes 3 windows of metrics — never propose actions in the same call.

## Money safety

Google Ads spend is real money. The MCP defends against accidental waste with three layers:

- **Env-level gate** (`GOOGLE_ADS_ALLOW_MUTATIONS`)
- **Per-call gate** (`explicit_user_intent`)
- **Audit log** (every mutation written to stderr with resource_name + payload)

If a write tool errors with `"Write tools are disabled..."`, do not retry. Surface the message to the user and let them decide whether to enable mutations.

## Tool call shapes (key tools)

```jsonc
// Discover accounts
{ "name": "google_ads_list_accounts", "arguments": { "response_format": "json" } }

// Daily report with CPC alert
{
  "name": "google_ads_daily_report",
  "arguments": {
    "customer_id": "1234567890",
    "cpc_alert_threshold": 0.15,
    "response_format": "markdown"
  }
}

// Find waste
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

// Pause a keyword (gated)
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

## Hermes operator pattern

The Hermes profile pin (`io.github.davidmosiah/google-ads-mcp@<version>`) gives you these direct tools:

- `mcp_google_ads_google_ads_connection_status`
- `mcp_google_ads_google_ads_list_accounts`
- `mcp_google_ads_google_ads_daily_report`
- `mcp_google_ads_google_ads_find_waste`

Use them directly. Do not shell out to `npx google-ads-mcp-server doctor` from within Hermes — the gateway will call the MCP for you. Reload with `/reload-mcp` or `hermes mcp test google-ads`.
