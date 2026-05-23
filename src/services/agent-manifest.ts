import { DEFAULT_SCOPES, NPM_PACKAGE_NAME, PINNED_NPM_PACKAGE, SERVER_VERSION, MCP_NAME } from "../constants.js";

export const AGENT_CLIENTS = ["generic", "claude", "cursor", "windsurf", "hermes", "openclaw"] as const;
export type AgentClientName = typeof AGENT_CLIENTS[number];

export const HERMES_DIRECT_TOOLS = [
  "mcp_google_ads_google_ads_agent_manifest",
  "mcp_google_ads_google_ads_connection_status",
  "mcp_google_ads_google_ads_data_inventory",
  "mcp_google_ads_google_ads_list_accounts",
  "mcp_google_ads_google_ads_list_campaigns",
  "mcp_google_ads_google_ads_daily_report",
  "mcp_google_ads_google_ads_find_waste",
  "mcp_google_ads_google_ads_get_account_performance",
  "mcp_google_ads_google_ads_get_campaign_performance"
];

export const STANDARD_TOOLS = [
  "google_ads_agent_manifest",
  "google_ads_cache_status",
  "google_ads_capabilities",
  "google_ads_clear_cache",
  "google_ads_connection_status",
  "google_ads_daily_report",
  "google_ads_data_inventory",
  "google_ads_exchange_code",
  "google_ads_find_waste",
  "google_ads_get_account_performance",
  "google_ads_get_auth_url",
  "google_ads_get_campaign",
  "google_ads_get_campaign_performance",
  "google_ads_get_keyword_performance",
  "google_ads_list_accounts",
  "google_ads_list_ad_groups",
  "google_ads_list_campaigns",
  "google_ads_list_keywords",
  "google_ads_onboarding",
  "google_ads_privacy_audit",
  "google_ads_profile_get",
  "google_ads_profile_update",
  "google_ads_quick_wins",
  "google_ads_revoke_access"
];

export const MUTATION_TOOLS = [
  "google_ads_pause_campaign",
  "google_ads_pause_keyword",
  "google_ads_resume_campaign",
  "google_ads_resume_keyword",
  "google_ads_set_campaign_budget_micros",
  "google_ads_set_keyword_bid_micros"
];

export function parseAgentClientName(value: string): AgentClientName {
  return AGENT_CLIENTS.includes(value as AgentClientName) ? value as AgentClientName : "generic";
}

export function buildAgentManifest(client: AgentClientName = "generic") {
  return {
    project: NPM_PACKAGE_NAME,
    mcp_name: MCP_NAME,
    client,
    unofficial: true,
    package: {
      name: NPM_PACKAGE_NAME,
      version: SERVER_VERSION,
      install_command: `npx -y ${NPM_PACKAGE_NAME}`,
      pinned_install_command: `npx -y ${PINNED_NPM_PACKAGE}`,
      binary: "google-ads-mcp-server"
    },
    oauth: {
      provider: "Google OAuth 2.0 + Google Ads Developer Token",
      redirect_uri: "http://127.0.0.1:3000/callback",
      scopes: DEFAULT_SCOPES,
      token_storage: "~/.google-ads-mcp/tokens.json with 0600 permissions",
      secret_storage: "~/.google-ads-mcp/config.json or GOOGLE_ADS_* environment variables; never print secrets"
    },
    mutation_gate: {
      env_flag: "GOOGLE_ADS_ALLOW_MUTATIONS",
      default: false,
      tools: MUTATION_TOOLS,
      enable_hint: "Re-run `google-ads-mcp-server setup --allow-mutations` or set GOOGLE_ADS_ALLOW_MUTATIONS=true. ASK THE USER FIRST."
    },
    recommended_first_calls: [
      "google_ads_profile_get",
      "google_ads_connection_status",
      "google_ads_data_inventory",
      "google_ads_list_accounts",
      "google_ads_daily_report"
    ],
    standard_tools: STANDARD_TOOLS,
    mutation_tools: MUTATION_TOOLS,
    resources: [],
    hermes: {
      config_path: "~/.hermes/config.yaml",
      skill_path: "~/.hermes/skills/google-ads-mcp/SKILL.md",
      tool_name_prefix: "mcp_google_ads_",
      common_tool_names: HERMES_DIRECT_TOOLS,
      recommended_config: hermesConfigSnippet(),
      use_direct_tools: true,
      avoid_terminal_workarounds: true,
      no_gateway_restart_for_data_access: true,
      reload_after_config_change: "/reload-mcp or hermes mcp test google-ads",
      doctor_command: `npx -y ${NPM_PACKAGE_NAME} doctor --client hermes --json`
    },
    agent_rules: [
      "Call google_ads_connection_status before any data tool.",
      "Discover the correct customer_id with google_ads_list_accounts before campaign or keyword reads.",
      "Mutations (bid/budget/pause changes) are DISABLED by default. Ask the user explicitly before recommending they enable GOOGLE_ADS_ALLOW_MUTATIONS.",
      "Treat Google Ads spend as the user's money. Never mutate without explicit confirmation per change.",
      "Use google_ads_find_waste (read-only) before suggesting paused keywords — it returns candidates ranked by waste, not actions.",
      "Frame outputs as operational marketing context, not financial advice.",
      "Customer ids are partial-redacted in structured mode. Use raw mode only when the user asks for the full id."
    ],
    troubleshooting: [
      { symptom: "missing GOOGLE_ADS_DEVELOPER_TOKEN / GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET", action: "Run `google-ads-mcp-server setup` or set GOOGLE_ADS_* env vars." },
      { symptom: "Google did not return refresh_token on auth", action: "Revoke at https://myaccount.google.com/permissions then re-run `google-ads-mcp-server auth` (uses prompt=consent)." },
      { symptom: "401 or expired token", action: "Re-run auth or wait — refresh_token-backed access tokens are refreshed automatically." },
      { symptom: "PERMISSION_DENIED on account read", action: "Confirm login_customer_id is the manager (MCC) that owns the target customer, no dashes." },
      { symptom: "write tool returns 'mutations disabled'", action: "Ask the user, then set GOOGLE_ADS_ALLOW_MUTATIONS=true or rerun setup with --allow-mutations." },
      { symptom: "Hermes configured but tools unavailable", action: "Run `/reload-mcp` or `hermes mcp test google-ads`; do not restart gateway for normal reload." }
    ],
    links: {
      github: "https://github.com/davidmosiah/google-ads-mcp-unofficial",
      npm: "https://www.npmjs.com/package/google-ads-mcp-unofficial",
      google_ads_api_docs: "https://developers.google.com/google-ads/api/rest/overview",
      developer_token_docs: "https://developers.google.com/google-ads/api/docs/first-call/dev-token"
    }
  };
}

export function formatAgentManifestMarkdown(manifest: ReturnType<typeof buildAgentManifest>): string {
  return `# Google Ads MCP Agent Manifest

Unofficial: ${manifest.unofficial}
Package: \`${manifest.package.name}\` v${manifest.package.version}
Install: \`${manifest.package.install_command}\`
Pinned install: \`${manifest.package.pinned_install_command}\`

## OAuth + Developer Token
Provider: ${manifest.oauth.provider}
Redirect URI: \`${manifest.oauth.redirect_uri}\`
Scopes: \`${manifest.oauth.scopes.join(" ")}\`
Tokens: ${manifest.oauth.token_storage}

## Mutation Gate
Env flag: \`${manifest.mutation_gate.env_flag}\` (default ${manifest.mutation_gate.default})
Gated tools:
${manifest.mutation_gate.tools.map((t) => `- \`${t}\``).join("\n")}

## First Calls
${manifest.recommended_first_calls.map((tool) => `- \`${tool}\``).join("\n")}

## Hermes
Config: \`${manifest.hermes.config_path}\`
Skill: \`${manifest.hermes.skill_path}\`
Reload: \`${manifest.hermes.reload_after_config_change}\`
Direct tools:
${manifest.hermes.common_tool_names.map((tool) => `- \`${tool}\``).join("\n")}

## Agent Rules
${manifest.agent_rules.map((rule) => `- ${rule}`).join("\n")}
`;
}

export function hermesConfigSnippet(): string {
  return `mcp_servers:\n  google-ads:\n    command: npx\n    args:\n      - -y\n      - ${PINNED_NPM_PACKAGE}\n    timeout: 120\n    connect_timeout: 60\n    sampling:\n      enabled: false`;
}

export function hermesSkillMarkdown(): string {
  return `# Google Ads MCP Skill

Use this skill whenever a user asks Hermes to inspect or operate a Google Ads account through the Google Ads MCP.

## Rules
- Start with \`mcp_google_ads_google_ads_connection_status\`.
- Discover the account with \`mcp_google_ads_google_ads_list_accounts\` before campaign reads.
- Prefer \`mcp_google_ads_google_ads_daily_report\` and \`mcp_google_ads_google_ads_find_waste\` over raw GAQL reads.
- Mutations (pause/resume/bid/budget) are DISABLED by default. Ask the user explicitly before recommending they enable \`GOOGLE_ADS_ALLOW_MUTATIONS\`.
- Customer ids are partial-redacted by default. Only request raw mode when the user needs the full id.
- Reload MCP with \`/reload-mcp\` or \`hermes mcp test google-ads\`; do not restart the gateway for normal data access.
`;
}
