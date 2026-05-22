# Changelog

## 0.1.2 - 2026-05-22

### Added

- **HTTP transport** (`--http` flag). The CLI now boots Streamable HTTP MCP via `dist/index.js --http`. Listens on `127.0.0.1:3000/mcp` by default; `/health` returns `{ok, name, version}`. Env: `GOOGLE_ADS_MCP_HOST`, `GOOGLE_ADS_MCP_PORT`, `GOOGLE_ADS_MCP_ALLOWED_ORIGIN`, `GOOGLE_ADS_MCP_TRANSPORT=http`. Previously the README mentioned `--http` but the transport wasn't actually wired up — only stdio worked. Now both transports are real.
- **`scripts/smoke-http.mjs`** — boots `dist/index.js --http` on a random port, polls `/health` until 200, asserts the response shape (`ok`, `name`, `version`). Wired into `npm test` so HTTP regressions get caught at CI time.
- **`.github/workflows/ci.yml`** — runs `npm ci && npm test` on push + PR to main, Node 22. Same pattern as the rest of the davidmosiah MCP ecosystem.
- **`glama.json`** — Glama MCP registry metadata for passive discovery.

### Changed

- New dependencies: `express ^5.2.1`, `cors ^2.8.6` (and dev `@types/express`, `@types/cors`) — required for HTTP transport. Same deps used by every other HTTP-capable MCP in the davidmosiah ecosystem; no new attack surface.
- `package.json` test script chain now: `typecheck → build → test:metadata → smoke → smoke:http → test:http-retry`.

## 0.1.1 - 2026-05-22

### Documentation

- **`docs/auth.md` — added "Before you start" section** that explains the Google Ads API access tiers (Test → Basic → Standard) and walks through how to apply for Basic access. Previously users could install the MCP, run setup, and then hit `USER_PERMISSION_DENIED` on every real customer query because their developer token was on Test-access default — with no in-repo hint of the cause. Now the gap is explicit: prerequisites checklist (MCC + linked advertiser + Cloud project + use-case description), step-by-step Basic-access application instructions, and a "Testing without Basic access" path using Google Ads test accounts.
- **`docs/auth.md` — added "Common first-call errors"** table mapping the 7 most common Google Ads first-call failures to actionable fixes (USER_PERMISSION_DENIED, Access blocked, invalid_grant, developer-token: not authorized, QUOTA_EXCEEDED, etc.).
- **`docs/auth.md` — added OAuth consent screen warning** about Testing-mode requiring your Gmail in Test users to avoid "Access blocked: project has not been verified".
- **`README.md` — Quick Start now opens with a Basic-access prerequisite callout** linking to `docs/auth.md` so first-time users see the gotcha before running setup.
- **`README.md` — Troubleshooting table expanded** from 6 to 9 rows. New entries: `USER_PERMISSION_DENIED` (Test vs Basic access), `Access blocked: project has not been verified`, `developer-token: not authorized`, `QUOTA_EXCEEDED`.

No code changes. All tools, schemas, and behaviors identical to 0.1.0.

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
