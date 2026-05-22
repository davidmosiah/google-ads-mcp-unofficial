# Hermes installation

```bash
npx -y google-ads-mcp-unofficial setup --client hermes
```

This writes/merges `~/.hermes/config.yaml`:

```yaml
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

And drops a skill at `~/.hermes/skills/google-ads-mcp/SKILL.md` so the agent prefers direct MCP tools over terminal workarounds.

## Reload

After config changes, use `/reload-mcp` or `hermes mcp test google-ads`. **Do NOT** restart the Hermes gateway for normal data access — that's unnecessary churn.

## Direct tool names (with the `mcp_google_ads_` prefix Hermes applies)

- `mcp_google_ads_google_ads_connection_status`
- `mcp_google_ads_google_ads_list_accounts`
- `mcp_google_ads_google_ads_daily_report`
- `mcp_google_ads_google_ads_find_waste`
- `mcp_google_ads_google_ads_get_account_performance`
- `mcp_google_ads_google_ads_get_campaign_performance`

## Mutations

If the user wants Hermes to actually change campaigns:

```bash
GOOGLE_ADS_ALLOW_MUTATIONS=true npx -y google-ads-mcp-unofficial setup --client hermes --allow-mutations --no-auth
```

Mutations remain double-gated: env flag + `explicit_user_intent: true` per call.
