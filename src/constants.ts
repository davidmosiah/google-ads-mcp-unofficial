export const SERVER_NAME = "google-ads-mcp-server";
export const SERVER_VERSION = "0.1.0";
export const NPM_PACKAGE_NAME = "google-ads-mcp-unofficial";
export const PINNED_NPM_PACKAGE = `${NPM_PACKAGE_NAME}@${SERVER_VERSION}`;
export const MCP_NAME = "io.github.davidmosiah/google-ads-mcp";

// Google Ads REST API v17 (latest stable as of 2026). The base URL is paired
// with a customer id in the path: /v17/customers/{customer_id}/googleAds:search
export const GOOGLE_ADS_API_VERSION = "v17";
export const GOOGLE_ADS_API_BASE_URL = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;

// OAuth2 endpoints (shared with all Google APIs)
export const GOOGLE_OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

// Default scope is the single scope required for the Google Ads API.
export const DEFAULT_SCOPES = ["https://www.googleapis.com/auth/adwords"];

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 1000;

// Micros conversion factor — Google Ads stores currency as integer micros
// (e.g., $1.50 = 1_500_000 micros). Used by helper formatters.
export const MICROS_PER_UNIT = 1_000_000;
