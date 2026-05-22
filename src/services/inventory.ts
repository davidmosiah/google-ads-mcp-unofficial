import { buildCapabilities } from "./capabilities.js";

type SupportedDataCategory = { name: string; examples?: string[]; tools?: string[] };
type PrivacyModeDescription = { mode?: string; use_when?: string };

type CapabilityInventory = {
  project: string;
  mcp_name: string;
  unofficial?: boolean;
  api_boundary?: {
    source?: string;
    raw_definition?: string;
    does_not_include?: string[];
  };
  auth_model?: {
    type?: string;
    token_storage?: string;
    recommended_redirect_uri?: string;
    default_scopes?: string[];
  };
  privacy_modes?: PrivacyModeDescription[];
  supported_data?: SupportedDataCategory[];
  recommended_agent_flow?: string[];
  links?: Record<string, string>;
};

export function buildDataInventory() {
  const capabilities = buildCapabilities() as CapabilityInventory;
  const categories = (capabilities.supported_data ?? []).map((category) => ({
    name: category.name,
    examples: category.examples ?? [],
    tools: category.tools ?? []
  }));
  const tools = [...new Set(categories.flatMap((category) => category.tools))].sort();
  const scopes = capabilities.auth_model?.default_scopes ?? [];

  return {
    kind: "data_inventory" as const,
    source: capabilities.project,
    mcp_name: capabilities.mcp_name,
    generated_at: new Date().toISOString(),
    unofficial: Boolean(capabilities.unofficial),
    data_access_model: "oauth_api",
    auth: capabilities.auth_model,
    scopes,
    api_boundary: capabilities.api_boundary,
    privacy_modes: capabilities.privacy_modes ?? [],
    categories,
    totals: {
      categories: categories.length,
      listed_tools: tools.length,
      scopes: scopes.length
    },
    first_tools: [
      "google_ads_profile_get",
      "google_ads_connection_status",
      "google_ads_list_accounts",
      "google_ads_daily_report"
    ],
    recommended_agent_flow: capabilities.recommended_agent_flow ?? [],
    links: capabilities.links ?? {},
    notes: [
      "This inventory is static MCP metadata and does not call Google Ads APIs.",
      "Call google_ads_connection_status before any data tool to verify credentials and local token readiness.",
      "Mutations are disabled by default. Enable with GOOGLE_ADS_ALLOW_MUTATIONS=true only after explicit user approval.",
      "Customer ids are partial-redacted in structured mode (default). Use raw mode for full ids."
    ]
  };
}

export function formatInventoryMarkdown(inventory: ReturnType<typeof buildDataInventory>): string {
  const categoryLines = inventory.categories.map((category) =>
    "- **" + category.name + "**: " + (category.tools.join(", ") || "no direct tool listed")
  );
  return [
    "# Google Ads MCP Data Inventory",
    "",
    "- **source**: " + inventory.source,
    "- **categories**: " + inventory.totals.categories,
    "- **listed_tools**: " + inventory.totals.listed_tools,
    "- **scopes**: " + (inventory.scopes.length ? inventory.scopes.join(", ") : "n/a"),
    "",
    "## Categories",
    ...categoryLines
  ].join("\n");
}
