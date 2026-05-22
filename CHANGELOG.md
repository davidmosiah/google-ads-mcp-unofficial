# Changelog

## 0.1.0 - 2026-05-22

Initial release.

### Tools (22 total)

**Meta + diagnostic (5):**
- `google_ads_connection_status` — auth + token freshness + customer id config + retry-budget visibility
- `google_ads_capabilities` — supported scopes, mutation gating, privacy modes
- `google_ads_agent_manifest` — STANDARD/MUTATION tools, hermes/openclaw snippets
- `google_ads_data_inventory` — categories, recommended first calls
- `google_ads_privacy_audit` — what's stored locally, what's redacted, mutations gate status

**Shared profile (3):** vendored from `delx-wellness/lib/profile-store.ts`
- `google_ads_profile_get`
- `google_ads_profile_update` (gated by `explicit_user_intent: true`)
- `google_ads_onboarding` (en / pt-BR)

**Auth (3):**
- `google_ads_get_auth_url`
- `google_ads_exchange_code`
- `google_ads_revoke_access`

**Reads — always safe (8):**
- `google_ads_list_accounts` — manager + child accounts visible via login_customer_id
- `google_ads_list_campaigns` — with status filter
- `google_ads_get_campaign` — single campaign with budget + bidding strategy
- `google_ads_list_ad_groups` — under a campaign
- `google_ads_list_keywords` — with campaign / ad_group / status filters
- `google_ads_get_account_performance` — date-range aggregates
- `google_ads_get_campaign_performance` — per-campaign metrics
- `google_ads_get_keyword_performance` — per-keyword metrics + derived conversion_rate

**Workflow tools (2):**
- `google_ads_daily_report` — YESTERDAY + LAST_7_DAYS + LAST_30_DAYS snapshot with optional CPC alert threshold
- `google_ads_find_waste` — identify "high cost + zero conversions" keyword candidates (read-only, ranked)

**Mutations — gated by `GOOGLE_ADS_ALLOW_MUTATIONS=true` (6):**
- `google_ads_pause_keyword`
- `google_ads_resume_keyword`
- `google_ads_set_keyword_bid_micros`
- `google_ads_set_campaign_budget_micros`
- `google_ads_pause_campaign`
- `google_ads_resume_campaign`

### SOTA features

- **HTTP retry middleware** — exponential backoff (500ms/1s/2s), ±20% jitter, `Retry-After` honored, retries 408/429/500/502/503/504 + network errors. `GOOGLE_ADS_NO_RETRY=true` to disable.
- **Privacy modes** — `summary` | `structured` (default) | `raw`. Customer ids partial-redacted in structured (`123-***-7890`), full in raw.
- **Mutation gating** — every write tool checks `getConfig().allowMutations`; throws actionable error if disabled. Every mutation logged to stderr for audit.
- **Shared Delx profile** — vendored from `delx-wellness/lib/profile-store.ts`. Cross-MCP profile state at `~/.delx-wellness/profile.json`.
- **Local config** — secrets in `~/.google-ads-mcp/config.json` (chmod 600); never returned by tools.
- **Doctor command** — `google-ads-mcp-server doctor [--client hermes] [--json] [--strict]`.
- **Smoke test** — boots the server via StdioClientTransport, asserts all 22 tools registered.
- **Metadata check** — verifies package.json / server.json consistency.
- **HTTP retry test** — six-case unit suite covering happy path, Retry-After, env disable, 401 non-retry, exhaustion, network errors.

### Out of scope (by design)

- Google Ads Scripts (`AdsApp`) — run only inside the Google Ads dashboard, not via API.
- Search Ads 360 / DV360 / GA4 — separate APIs, separate connectors.
- Automated financial-account changes beyond the Google Ads API surface.
