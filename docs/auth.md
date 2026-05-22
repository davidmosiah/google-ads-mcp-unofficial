# Authentication

This MCP requires two credentials: a **Google Ads Developer Token** and a **Google OAuth 2.0 Client**. Read the "Before you start" section first if you've never used the Google Ads API before — most first-call failures come from skipping a prerequisite.

---

## 📋 Before you start — read this if you're new to Google Ads API

The Google Ads API has **three access tiers**. Default is the most restrictive. Skipping this section is the #1 source of `PERMISSION_DENIED` and `USER_PERMISSION_DENIED` errors on first call.

| Tier | What it can do | How to get it | Daily limit |
|---|---|---|---|
| **Test access** (default) | Query test accounts ONLY. CANNOT touch real production data. | Auto-granted with any new developer token. | 15,000 operations against test accounts |
| **Basic access** | Query/mutate real production Google Ads accounts. The realistic minimum for actually using this MCP. | Apply via the form below. Approval typically takes **2–4 business days**. | 15,000 operations / day |
| **Standard access** | Higher quotas, fewer rate restrictions. | Upgrade request after you've used Basic for a few weeks. | 1,000,000 operations / day |

> ⚠️ **If you only have Test access and try to query a real customer ID, every read fails with `PERMISSION_DENIED`. There is no workaround except applying for Basic access.** The first thing you should do after creating your developer token is apply for Basic access.

### Prerequisites checklist

Before requesting a developer token, make sure you have all of these. The application form will ask about them.

- [ ] **A Google Ads MCC (Manager) account.** If you only have a single advertiser account, [create an MCC](https://ads.google.com/home/tools/manager-accounts/) first — the developer token attaches to the MCC, not to individual advertiser accounts. Free to create.
- [ ] **At least one advertiser account linked to your MCC.** Even if it's a paused/zero-spend account, you need at least one linked customer.
- [ ] **A Google Cloud project with billing enabled.** Free tier billing works; you just need a billing account attached. (Google Ads API is free to call — billing is required only because Google Cloud requires it on all API-enabled projects.)
- [ ] **A clear description of what you'll use the API for.** The application form has free-text fields about: tool name, purpose, expected daily operations, data handling, user count. Be specific and honest — "Personal AI agent that reads my own Google Ads account performance and suggests bid optimizations via Claude Desktop" is a fine, approvable answer.

### Apply for Basic Access (do this NOW, while you set up the rest)

1. Sign in to your MCC at [ads.google.com](https://ads.google.com) as the MCC owner.
2. Open **Tools & Settings → Setup → API Center**: https://ads.google.com/aw/apicenter
3. If you have no token: click **Apply for token**, fill the form, submit. You'll get a Test-access token immediately.
4. **Same page**, you'll see your token plus an **Access level** field showing "Test". Click **Apply for Basic access** and fill the application:
   - **Tool name**: anything (e.g. "Personal Google Ads MCP")
   - **Tool URL**: your GitHub repo URL or `https://github.com/davidmosiah/google-ads-mcp-unofficial`
   - **Purpose**: pick "Internal" if this is for your own accounts, "Reporting" or "Account management" otherwise
   - **API usage**: be honest — `< 1,000 ops/day` is realistic for personal use
   - **Data handling**: "Data is processed locally and stays on the user's machine"
5. Submit. You'll get an email decision within **2-4 business days** (sometimes same-day for low-risk personal use, sometimes a week+ if they ask follow-ups).
6. **While you wait**: continue with the rest of this guide. You can test the MCP against a Google Ads test account immediately (see "Testing without Basic access" below).

Useful Google docs:
- Access levels and quotas: https://developers.google.com/google-ads/api/docs/access-levels
- Application FAQ: https://support.google.com/google-ads/answer/2375391
- The developer token form fields: https://developers.google.com/google-ads/api/docs/first-call/dev-token

### Testing without Basic access

If you don't want to wait for approval, you can exercise this MCP end-to-end against a Google Ads **test account**:

1. From your MCC, click the **"+"** button → **Create a test account**.
2. The test account gets a customer_id like real accounts but exists only in the test environment.
3. Set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` to your MCC id and use the test customer_id in tool calls — every read/mutation works while you wait for Basic approval.

> The test environment is for shape-checking your integration. Metrics in test accounts are not real and write operations don't move real money.

---

## 1. Google Ads Developer Token

A developer token authorizes the Google Ads REST API to accept requests on behalf of your MCC (Manager) account. **One token per MCC.** Treat it like a credential.

1. Sign in at https://ads.google.com/aw/apicenter as the MCC owner.
2. Apply for a developer token (and immediately apply for **Basic access** — see "Before you start").
3. Copy the token; you'll paste it into the `setup` wizard or set it as `GOOGLE_ADS_DEVELOPER_TOKEN`.

Docs: https://developers.google.com/google-ads/api/docs/first-call/dev-token

---

## 2. Google Cloud OAuth 2.0 Client

1. Open https://console.cloud.google.com/apis/credentials.
2. **Enable the Google Ads API** for the project: APIs & Services → Library → "Google Ads API" → Enable.
3. Configure the **OAuth consent screen** if you haven't already: External user type, app name = "Google Ads MCP" (or whatever), scopes = `https://www.googleapis.com/auth/adwords`. While the app is in **Testing** mode, add your own Gmail to **Test users** (otherwise consent screen blocks you with "Access blocked: project has not been verified").
4. Create credentials → OAuth client ID → **Desktop application** (recommended for local-first MCP).
5. Note the client id and client secret.
6. Add `http://127.0.0.1:3000/callback` (or whatever port you want) to the Authorized redirect URIs — this is where our local listener catches the auth code.

> ⚠️ Some Google Cloud projects default to **"Internal" only** if you have a Workspace account. If you see "User type" locked to Internal, that's fine — you can still authorize your own Workspace email without verification.

---

## 3. OAuth dance

```bash
npx -y google-ads-mcp-unofficial auth
```

What happens:

1. We open Google's consent screen in your browser with `access_type=offline&prompt=consent`.
2. You approve.
3. Google redirects to `http://127.0.0.1:3000/callback?code=...&state=...`.
4. Our local listener captures the code, exchanges it for tokens, and writes them to `~/.google-ads-mcp/tokens.json` with `chmod 600`.

### Refresh token gotcha

Google only returns a `refresh_token` on:

- The **first** consent for a `(user, client_id, scopes)` combo, OR
- A subsequent consent **after** you've revoked the prior grant.

We use `prompt=consent` to maximize the chance Google returns one. If the exchange response is missing `refresh_token`, we throw:

```
Google did not return a refresh_token. Revoke the prior grant at
https://myaccount.google.com/permissions and re-run `google-ads-mcp-server auth`.
```

Follow that hint exactly.

---

## 4. Multi-account access (MCC)

If you manage multiple Google Ads customers under one MCC, set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` to the MCC id (10 digits, no dashes). Every request includes that as the `login-customer-id` header, and `google_ads_list_accounts` returns every child customer the MCC owns.

---

## 5. Revoking access

```bash
# From the MCP
google_ads_revoke_access

# Or from the CLI
npx -y google-ads-mcp-unofficial doctor   # confirm what's there
rm ~/.google-ads-mcp/tokens.json          # nuke the local token
# Then revoke server-side: https://myaccount.google.com/permissions
```

---

## Common first-call errors and what they mean

| Error | What's actually wrong | Fix |
|---|---|---|
| `USER_PERMISSION_DENIED` on every read | You're querying a real customer_id from a Test-only developer token | Apply for Basic access (see "Before you start"); meanwhile use a test customer_id |
| `PERMISSION_DENIED: The caller does not have permission` | `GOOGLE_ADS_LOGIN_CUSTOMER_ID` doesn't match the MCC that owns the target customer_id | Verify the MCC owns the customer; the login_customer_id is the MCC id, not the target |
| `Access blocked: <project> has not been verified` | Your OAuth consent screen is in Testing and your Gmail is not in the Test users list | Add your Gmail to OAuth consent screen → Test users |
| `Google did not return a refresh_token` | Google reused a prior consent without re-issuing the refresh token | Revoke at https://myaccount.google.com/permissions, re-run `auth` |
| `invalid_grant` on refresh | Refresh token revoked or expired (>6 months unused) | Re-run `auth` to get a new refresh token |
| `developer-token: not authorized` | Developer token is from a different MCC than `login-customer-id` | Use the developer token from the MCC that owns the target customer |
| `QUOTA_EXCEEDED` | You've hit the 15,000 ops/day Basic limit | Wait until midnight Pacific or apply for Standard access |
