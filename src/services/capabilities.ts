import { MCP_NAME, NPM_PACKAGE_NAME, DEFAULT_SCOPES } from "../constants.js";

export function buildCapabilities() {
  return {
    project: NPM_PACKAGE_NAME,
    mcp_name: MCP_NAME,
    creator: {
      name: "David Mosiah",
      github: "https://github.com/davidmosiah"
    },
    unofficial: true,
    api_boundary: {
      source: "Official Google Ads REST API v17",
      raw_definition: "Raw means the full JSON response returned by supported Google Ads REST API endpoints.",
      does_not_include: [
        "Google Ads Scripts (run only inside the Google Ads dashboard, not via API)",
        "Google Ads Editor offline edits",
        "Google Analytics or GA4 data",
        "Search Ads 360 / Display & Video 360 endpoints",
        "automated financial-account changes outside the Google Ads API surface"
      ]
    },
    auth_model: {
      type: "OAuth 2.0 authorization code + Google Ads developer token",
      token_storage: "Local token file with user-only permissions",
      recommended_redirect_uri: "http://127.0.0.1:3000/callback",
      default_scopes: DEFAULT_SCOPES
    },
    privacy_modes: [
      { mode: "summary", use_when: "Agent only needs ids, names, and statuses." },
      { mode: "structured", use_when: "Default — flat normalized rows with partial-redacted customer ids." },
      { mode: "raw", use_when: "User explicitly needs the upstream Google Ads REST payload." }
    ],
    mutation_model: {
      gated_by_env: "GOOGLE_ADS_ALLOW_MUTATIONS",
      default: "disabled",
      mutation_tools: [
        "google_ads_pause_keyword",
        "google_ads_resume_keyword",
        "google_ads_set_keyword_bid_micros",
        "google_ads_set_campaign_budget_micros",
        "google_ads_pause_campaign",
        "google_ads_resume_campaign"
      ],
      reminder: "Agents changing real ad spend is high-stakes. Ask the user before enabling. Every mutation is logged to stderr."
    },
    supported_data: [
      {
        name: "Accounts",
        examples: ["accessible customers", "manager + child customers via login-customer-id"],
        tools: ["google_ads_list_accounts"]
      },
      {
        name: "Campaigns",
        examples: ["campaign list", "single campaign with budget + bidding strategy"],
        tools: ["google_ads_list_campaigns", "google_ads_get_campaign"]
      },
      {
        name: "Ad groups and keywords",
        examples: ["ad groups under a campaign", "keywords with match type + criterion id"],
        tools: ["google_ads_list_ad_groups", "google_ads_list_keywords"]
      },
      {
        name: "Performance metrics",
        examples: ["impressions, clicks, cost_micros, ctr, avg_cpc, conversions"],
        tools: [
          "google_ads_get_account_performance",
          "google_ads_get_campaign_performance",
          "google_ads_get_keyword_performance"
        ]
      },
      {
        name: "Workflow tools",
        examples: ["daily performance report", "waste keyword detection (read-only)"],
        tools: ["google_ads_daily_report", "google_ads_find_waste"]
      },
      {
        name: "Mutations (gated)",
        examples: ["pause/resume keywords + campaigns", "update bids and budgets"],
        tools: [
          "google_ads_pause_keyword", "google_ads_resume_keyword",
          "google_ads_set_keyword_bid_micros", "google_ads_set_campaign_budget_micros",
          "google_ads_pause_campaign", "google_ads_resume_campaign"
        ]
      }
    ],
    recommended_agent_flow: [
      "Call google_ads_agent_manifest when installing into a server agent such as Hermes or OpenClaw.",
      "Call google_ads_connection_status before calling data tools.",
      "Call google_ads_list_accounts to discover the customer_id to operate on.",
      "Use google_ads_daily_report for a quick performance snapshot.",
      "Use google_ads_find_waste to identify cleanup candidates (read-only).",
      "Mutations are disabled by default — ask the user before enabling GOOGLE_ADS_ALLOW_MUTATIONS.",
      "Frame outputs as operational marketing context, not financial advice."
    ],
    client_aliases: {
      hermes: {
        tool_prefix: "mcp_google_ads_",
        direct_tools: [
          "mcp_google_ads_google_ads_agent_manifest",
          "mcp_google_ads_google_ads_connection_status",
          "mcp_google_ads_google_ads_list_accounts",
          "mcp_google_ads_google_ads_daily_report"
        ],
        reload_command: "/reload-mcp or hermes mcp test google-ads",
        gateway_restart_required_for_data_access: false
      }
    },
    contribution_paths: [
      "Add additional GAQL-backed read tools as Google Ads exposes more endpoints.",
      "Improve the GAQL → markdown rendering for richer agent summaries.",
      "Add support for Performance Max and asset-group level reads.",
      "Improve the docs covering OAuth setup for the first-time user."
    ],
    links: {
      github: "https://github.com/davidmosiah/google-ads-mcp-unofficial",
      npm: "https://www.npmjs.com/package/google-ads-mcp-unofficial",
      google_ads_api_docs: "https://developers.google.com/google-ads/api/rest/overview",
      google_ads_developer_token: "https://developers.google.com/google-ads/api/docs/first-call/dev-token"
    }
  };
}
