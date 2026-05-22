import { homedir } from "node:os";
import { join } from "node:path";
import { SERVER_NAME } from "../constants.js";
import type { PrivacyMode } from "../types.js";
import { loadConfigSources } from "./local-config.js";
import { REDACTED_KEY_PATTERNS } from "./redaction.js";

function parsePrivacyMode(value: string | undefined): PrivacyMode {
  if (value === "summary" || value === "structured" || value === "raw") return value;
  return "structured";
}

function parseBool(value: string | undefined): boolean {
  return Boolean(value && ["1", "true", "yes", "on", "sqlite"].includes(value.toLowerCase()));
}

export function buildPrivacyAudit(): Record<string, unknown> {
  const requiredEnv = ["GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET"];
  const sources = loadConfigSources();
  const value = (name: keyof typeof sources.values) => sources.values[name];
  return {
    project: SERVER_NAME,
    unofficial: true,
    config_source: sources.source,
    local_config_path: sources.local.path,
    local_config_exists: sources.local.exists,
    local_config_secure_permissions: sources.local.secure_permissions,
    privacy_mode_default: parsePrivacyMode(value("GOOGLE_ADS_PRIVACY_MODE")),
    raw_payloads_opt_in: true,
    mutations_allowed: parseBool(value("GOOGLE_ADS_ALLOW_MUTATIONS")),
    mutations_gate_env: "GOOGLE_ADS_ALLOW_MUTATIONS",
    cache_enabled: parseBool(value("GOOGLE_ADS_CACHE")),
    cache_path: value("GOOGLE_ADS_CACHE_PATH") ?? join(homedir(), ".google-ads-mcp", "cache.sqlite"),
    token_path: value("GOOGLE_ADS_TOKEN_PATH") ?? join(homedir(), ".google-ads-mcp", "tokens.json"),
    stdout_safe: true,
    secret_env_vars: ["GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN"],
    required_env_present: Object.fromEntries(requiredEnv.map((name) => [name, Boolean(value(name as keyof typeof sources.values))])),
    redacted_key_patterns: REDACTED_KEY_PATTERNS,
    notes: [
      "This is an unofficial Google Ads integration.",
      "OAuth tokens and developer token are stored locally and are not returned by tools.",
      "Raw Google Ads payloads require GOOGLE_ADS_PRIVACY_MODE=raw or privacy_mode=raw.",
      "Mutations (bid/budget/pause changes) are disabled by default and gated behind GOOGLE_ADS_ALLOW_MUTATIONS=true.",
      "Errors are redacted before returning to MCP clients.",
      "stdio transport logs to stderr to avoid corrupting JSON-RPC.",
      "Customer ids are partial-redacted in structured mode (default) — opt into raw to see full ids."
    ]
  };
}
