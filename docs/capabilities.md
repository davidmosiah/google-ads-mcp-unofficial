# Capabilities

The full machine-readable capability matrix is returned by `google_ads_capabilities`. This doc is the human summary.

## API boundary

- **Source:** Official Google Ads REST API v17
- **Raw means:** the full JSON response returned by supported endpoints
- **Does NOT include:**
  - Google Ads Scripts (`AdsApp`) — run only inside the Google Ads dashboard
  - Google Ads Editor offline edits
  - Google Analytics or GA4 data
  - Search Ads 360 / Display & Video 360
  - Automated financial-account changes outside the Google Ads API surface

## Auth model

- OAuth 2.0 authorization code + Google Ads developer token
- Recommended redirect: `http://127.0.0.1:3000/callback`
- Single scope: `https://www.googleapis.com/auth/adwords`
- Tokens stored locally with user-only permissions

## Privacy modes

| Mode | Use when |
|---|---|
| `summary` | Agent only needs ids/names/statuses |
| `structured` | Default — flat normalized rows with partial-redacted customer ids |
| `raw` | User explicitly needs upstream payload (and full customer id) |

## Mutation model

- Gated by env flag `GOOGLE_ADS_ALLOW_MUTATIONS` (default off)
- Each mutation tool requires `explicit_user_intent: true` per call
- Every mutation logged to stderr with resource_name + operation type

## Supported data categories

1. **Accounts** — accessible customers, manager + child via login-customer-id
2. **Campaigns** — list, single get with budget + bidding strategy
3. **Ad groups and keywords** — list, with criterion ids and match types
4. **Performance metrics** — impressions, clicks, cost_micros, ctr, average_cpc, conversions, conversion_rate (derived)
5. **Workflow tools** — daily report (3-window aggregates), find waste (zero-conv high-cost detection)
6. **Mutations (gated)** — pause/resume keyword/campaign, set bid, set budget

## Recommended agent flow

1. `google_ads_agent_manifest` — when installing into a server agent
2. `google_ads_connection_status` — before any data tool
3. `google_ads_list_accounts` — discover the customer_id
4. `google_ads_daily_report` — quick performance snapshot
5. `google_ads_find_waste` — identify cleanup candidates (read-only)
6. Mutations only after explicit user approval per call

## Out of scope (intentional)

- Bulk multi-keyword mutations in a single tool call — agents must call one at a time with `explicit_user_intent`
- Auto-applying find_waste output — that's exactly why it's split: find vs. pause
- Cross-account batch reports — call per customer_id
