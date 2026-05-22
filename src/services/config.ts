import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SCOPES } from "../constants.js";
import type { GoogleAdsConfig, PrivacyMode } from "../types.js";
import { loadConfigSources } from "./local-config.js";

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export function getConfig(): GoogleAdsConfig {
  const sources = loadConfigSources(process.env, homedir());
  const value = (name: keyof typeof sources.values) => env(name) ?? sources.values[name];
  const developerToken = value("GOOGLE_ADS_DEVELOPER_TOKEN");
  const clientId = value("GOOGLE_ADS_CLIENT_ID");
  const clientSecret = value("GOOGLE_ADS_CLIENT_SECRET");
  const redirectUri = value("GOOGLE_ADS_REDIRECT_URI") ?? "http://127.0.0.1:3000/callback";
  const loginCustomerId = sanitizeCustomerId(value("GOOGLE_ADS_LOGIN_CUSTOMER_ID"));
  const tokenPath = value("GOOGLE_ADS_TOKEN_PATH") ?? join(homedir(), ".google-ads-mcp", "tokens.json");
  const cachePath = value("GOOGLE_ADS_CACHE_PATH") ?? join(homedir(), ".google-ads-mcp", "cache.sqlite");
  const scopes = (value("GOOGLE_ADS_SCOPES")?.split(/[ ,]+/).filter(Boolean)) ?? DEFAULT_SCOPES;
  const privacyMode = parsePrivacyMode(value("GOOGLE_ADS_PRIVACY_MODE"));
  const allowMutations = parseBool(value("GOOGLE_ADS_ALLOW_MUTATIONS"), false);
  const cacheEnabled = parseBool(value("GOOGLE_ADS_CACHE"), false);

  const missing = [
    ["GOOGLE_ADS_DEVELOPER_TOKEN", developerToken],
    ["GOOGLE_ADS_CLIENT_ID", clientId],
    ["GOOGLE_ADS_CLIENT_SECRET", clientSecret]
  ].filter(([, v]) => !v).map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Missing required Google Ads environment variables: ${missing.join(", ")}. ` +
      "Create a Google Cloud OAuth2 client and request a Google Ads developer token, then run `google-ads-mcp-server setup`."
    );
  }

  return {
    developerToken: developerToken!,
    clientId: clientId!,
    clientSecret: clientSecret!,
    redirectUri,
    loginCustomerId,
    scopes,
    tokenPath,
    privacyMode,
    allowMutations,
    cacheEnabled,
    cachePath
  };
}

function parsePrivacyMode(value: string | undefined): PrivacyMode {
  if (value === "summary" || value === "structured" || value === "raw") return value;
  return "structured";
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return ["1", "true", "yes", "on", "sqlite"].includes(value.toLowerCase());
}

/** Strip dashes / non-digit characters from a customer id ("123-456-7890" → "1234567890"). */
export function sanitizeCustomerId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/[^\d]/g, "");
  return digits || undefined;
}
