# Authentication

This MCP requires two credentials.

## 1. Google Ads Developer Token

A developer token authorizes the Google Ads REST API to accept requests on behalf of your MCC (Manager) account.

1. Sign in at https://ads.google.com/aw/apicenter as the MCC owner.
2. Apply for a developer token. New tokens land in **Test account access** mode — fine for testing, requires upgrade approval for production traffic.
3. Copy the token; you'll paste it into the `setup` wizard or set it as `GOOGLE_ADS_DEVELOPER_TOKEN`.

Docs: https://developers.google.com/google-ads/api/docs/first-call/dev-token

## 2. Google Cloud OAuth 2.0 Client

1. Open https://console.cloud.google.com/apis/credentials.
2. **Enable the Google Ads API** for the project: APIs & Services → Library → "Google Ads API" → Enable.
3. Create credentials → OAuth client ID → **Desktop application** (recommended for local-first MCP).
4. Note the client id and client secret.
5. Add `http://127.0.0.1:3000/callback` (or whatever port you want) to the Authorized redirect URIs — this is where our local listener catches the auth code.

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

## 4. Multi-account access (MCC)

If you manage multiple Google Ads customers under one MCC, set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` to the MCC id (10 digits, no dashes). Every request includes that as the `login-customer-id` header, and `google_ads_list_accounts` returns every child customer the MCC owns.

## 5. Revoking access

```bash
# From the MCP
google_ads_revoke_access

# Or from the CLI
npx -y google-ads-mcp-unofficial doctor   # confirm what's there
rm ~/.google-ads-mcp/tokens.json          # nuke the local token
# Then revoke server-side: https://myaccount.google.com/permissions
```
