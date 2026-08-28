# Changelog

## 0.1.6 - 2026-08-28

Default docs and examples no longer contain a copyable `GOOGLE_ADS_ALLOW_MUTATIONS=true` assignment. Mutations stay off until the env is enabled and `explicit_user_intent` is set. `secret-scan` covers README/examples/llms.

## 0.1.5 - 2026-08-26

### Changed

- Target official Google Ads REST API **v25** (`/v25/customers/{id}/googleAds:search`). npm `0.1.4` still advertised an older major.

## 0.1.4

- Security: fleet pin hygiene — `hono@4.13.1`, `@hono/node-server@2.1.0`, `fast-uri@3.1.5`, `ip-address@10.4.0` (stale security overrides were still vulnerable).


## 0.1.3 - 2026-05-22

### Added

- **SQLite GAQL response cache (parity with whoop/oura/garmin MCPs)**. Disabled by default. Enable with `GOOGLE_ADS_CACHE=sqlite` (or `=true`); override path with `GOOGLE_ADS_CACHE_PATH` (default `~/.google-ads-mcp/cache.sqlite`); override TTL with `GOOGLE_ADS_CACHE_TTL_SECONDS` (default 60s — Google Ads metrics update roughly hourly, so a 60s read-through cache eliminates duplicate hits during agent loops without returning stale data). Key is a SHA-256 of `(customer_id + GAQL query + privacy_mode)`; mutations bypass the cache entirely. On a fresh API failure the client falls back to the most recent cache entry regardless of age (better stale data than no data when upstream is down). Cache size, oldest entry age, default TTL, and path are surfaced in `google_ads_connection_status` and `google_ads_privacy_audit`.
- **`google_ads_cache_status`** (new tool, read-only) — returns `{cache_enabled, cache_path, entries_count, oldest_age_ms, newest_age_ms, default_ttl_seconds}` without touching Google Ads.
- **`google_ads_clear_cache`** (new tool) — wipes local cache rows. Not gated by `GOOGLE_ADS_ALLOW_MUTATIONS` because nothing in the ad account changes — only local memoization is affected.
- **`google_ads_quick_wins`** (new workflow tool, read-only) — inverse of `google_ads_find_waste`. Finds keywords with **LOW CPC + HIGH CTR + at-least-some conversions** = candidates to RAISE the bid on (likely under-bidding profitable keywords). Inspired by the RobloxDrop "aumenta bid de keywords com CPC < R$0.10 e CTR > 10%" optimizer pattern. Input: `customer_id`, `lookback_days` (1-90, default 30), `min_ctr` (default 5%), `max_avg_cpc_micros` (default 100_000 = $0.10), `min_conversions` (default 0.5), `limit` (default 50). Output: ranked candidates with `recommended_bid_micros` (current bid + 25%, capped at 2x current) plus actionable `next_steps`. Pair with `google_ads_set_keyword_bid_micros` (gated) per criterion_id after user confirmation.
- **`scripts/cache-test.mjs`** — round-trip cache lifecycle test: set → get hit → privacy-mode separation → TTL expiry → clear. No live API.
- **`scripts/quick-wins-test.mjs`** — schema + candidate-builder + date-range-clause coverage. No live API. Verifies `recommended_bid_micros` math (current + 25% capped at 2x), `ctr_pct` conversion (0..1 ratio → 0..100 percent), `lookback_days` mapping to `LAST_N_DAYS`/`BETWEEN`.

### Changed

- `GoogleAdsClient.search()` now accepts an optional `privacyMode` argument so cache rows for the same query under different privacy modes don't collide. Paginated continuations (`pageToken`) are never cached — the token already implies state.
- `scripts/smoke-tools.mjs` expected-tool count: 27 → 30. Adds assertions for the new cache/quick-wins tools' default-state shapes (`cache_enabled=false`, `entries_count=0`, validation rejects missing `customer_id`).
- `package.json` test script chain now: `typecheck → build → test:metadata → smoke → smoke:http → test:http-retry → test:cache → test:quick-wins`.

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
