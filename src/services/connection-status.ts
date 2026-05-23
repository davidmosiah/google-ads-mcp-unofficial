import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PINNED_NPM_PACKAGE } from "../constants.js";
import type { GoogleAdsTokenSet, PrivacyMode } from "../types.js";
import { HERMES_DIRECT_TOOLS, type AgentClientName } from "./agent-manifest.js";
import { DEFAULT_CACHE_TTL_SECONDS, disabledCacheStatus, GoogleAdsCache } from "./cache.js";
import { loadConfigSources } from "./local-config.js";

type Env = Record<string, string | undefined>;

export interface ConnectionStatusOptions {
  env?: Env;
  homeDir?: string;
  nowMs?: number;
  client?: AgentClientName;
}

export interface ConnectionStatus extends Record<string, unknown> {
  ok: boolean;
  ready_for_google_ads_api: boolean;
  client?: AgentClientName;
  node: { version: string; supported: boolean };
  privacy_mode: PrivacyMode;
  mutations_allowed: boolean;
  required_env: Record<string, boolean>;
  missing_env: string[];
  login_customer_id?: string;
  redirect_uri?: string;
  automatic_auth_supported: boolean;
  config: {
    source: "env" | "local_config" | "mixed" | "missing";
    path: string;
    exists: boolean;
    secure_permissions?: boolean;
    error?: string;
  };
  token: {
    path: string;
    exists: boolean;
    readable: boolean;
    permissions?: string;
    secure_permissions?: boolean;
    expires_at?: number;
    expired?: boolean;
    has_refresh_token?: boolean;
    error?: string;
  };
  cache: {
    enabled: boolean;
    path: string;
    entries_count: number;
    oldest_age_ms?: number;
    newest_age_ms?: number;
    default_ttl_seconds: number;
  };
  retry: { enabled: boolean; max_attempts: number; env_disable_flag: string };
  client_checks?: { hermes?: HermesClientCheck };
  next_steps: string[];
}

export interface HermesClientCheck {
  config_path: string;
  config_exists: boolean;
  google_ads_server_configured: boolean;
  package_pinned: boolean;
  mcp_reload_confirmation_disabled?: boolean;
  skill_path: string;
  skill_installed: boolean;
  direct_tool_prefix: string;
  expected_direct_tools: string[];
  recommendations: string[];
  error?: string;
}

const REQUIRED_ENV = ["GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET"];

export async function buildConnectionStatus(options: ConnectionStatusOptions = {}): Promise<ConnectionStatus> {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const sources = loadConfigSources(env, homeDir);
  const value = (name: keyof typeof sources.values) => sources.values[name];
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const tokenPath = value("GOOGLE_ADS_TOKEN_PATH") ?? join(homeDir, ".google-ads-mcp", "tokens.json");
  const cachePath = value("GOOGLE_ADS_CACHE_PATH") ?? join(homeDir, ".google-ads-mcp", "cache.sqlite");
  const redirectUri = value("GOOGLE_ADS_REDIRECT_URI") ?? "http://127.0.0.1:3000/callback";
  const requiredEnv = Object.fromEntries(REQUIRED_ENV.map((name) => [name, Boolean(value(name as keyof typeof sources.values))]));
  const missingEnv = REQUIRED_ENV.filter((name) => !requiredEnv[name]);
  const token = await inspectToken(tokenPath, nowSeconds);
  const nodeSupported = Number(process.versions.node.split(".")[0] ?? 0) >= 20;
  const automaticAuthSupported = Boolean(redirectUri && isLocalHttpRedirect(redirectUri));
  const tokenUsable = token.exists && token.readable && token.secure_permissions !== false && (token.expired !== true || token.has_refresh_token === true);
  const ready = missingEnv.length === 0 && tokenUsable;
  const ok = ready && nodeSupported;
  const clientChecks = options.client === "hermes" ? { hermes: await inspectHermesClient(homeDir) } : undefined;

  return {
    ok,
    ready_for_google_ads_api: ready,
    client: options.client,
    node: { version: process.versions.node, supported: nodeSupported },
    privacy_mode: parsePrivacyMode(value("GOOGLE_ADS_PRIVACY_MODE")),
    mutations_allowed: parseBool(value("GOOGLE_ADS_ALLOW_MUTATIONS")),
    required_env: requiredEnv,
    missing_env: missingEnv,
    login_customer_id: value("GOOGLE_ADS_LOGIN_CUSTOMER_ID"),
    redirect_uri: redirectUri,
    automatic_auth_supported: automaticAuthSupported,
    config: {
      source: sources.source,
      path: sources.local.path,
      exists: sources.local.exists,
      secure_permissions: sources.local.secure_permissions,
      error: sources.local.error
    },
    token,
    cache: inspectCache(parseBool(value("GOOGLE_ADS_CACHE")), cachePath, parseTtlSeconds(value("GOOGLE_ADS_CACHE_TTL_SECONDS"))),
    retry: {
      enabled: env.GOOGLE_ADS_NO_RETRY !== "true",
      max_attempts: 3,
      env_disable_flag: "GOOGLE_ADS_NO_RETRY"
    },
    client_checks: clientChecks,
    next_steps: buildNextSteps({ missingEnv, token, nodeSupported, automaticAuthSupported, redirectUri })
  };
}

function parsePrivacyMode(value: string | undefined): PrivacyMode {
  if (value === "summary" || value === "structured" || value === "raw") return value;
  return "structured";
}

function parseBool(value: string | undefined): boolean {
  return Boolean(value && ["1", "true", "yes", "on", "sqlite"].includes(value.toLowerCase()));
}

function parseTtlSeconds(value: string | undefined): number {
  if (!value) return DEFAULT_CACHE_TTL_SECONDS;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_CACHE_TTL_SECONDS;
  return Math.floor(n);
}

function inspectCache(
  enabled: boolean,
  path: string,
  ttlSeconds: number
): ConnectionStatus["cache"] {
  if (!enabled) {
    const disabled = disabledCacheStatus(path, ttlSeconds);
    return {
      enabled: false,
      path: disabled.cache_path,
      entries_count: disabled.entries_count,
      default_ttl_seconds: disabled.default_ttl_seconds
    };
  }
  // Read-only inspection — open the cache and immediately close it. Cheap and
  // avoids leaking handles into the connection-status flow.
  let cache: GoogleAdsCache | undefined;
  try {
    cache = new GoogleAdsCache(path, ttlSeconds);
    const status = cache.status();
    return {
      enabled: true,
      path: status.cache_path,
      entries_count: status.entries_count,
      oldest_age_ms: status.oldest_age_ms,
      newest_age_ms: status.newest_age_ms,
      default_ttl_seconds: status.default_ttl_seconds
    };
  } catch {
    return { enabled: true, path, entries_count: 0, default_ttl_seconds: ttlSeconds };
  } finally {
    cache?.close();
  }
}

function isLocalHttpRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) && Boolean(url.port);
  } catch {
    return false;
  }
}

async function inspectToken(path: string, nowSeconds: number): Promise<ConnectionStatus["token"]> {
  try {
    const [stat, text] = await Promise.all([fs.stat(path), fs.readFile(path, "utf8")]);
    const permissions = (stat.mode & 0o777).toString(8).padStart(3, "0");
    const securePermissions = process.platform === "win32" ? true : (stat.mode & 0o077) === 0;
    const token = JSON.parse(text) as Partial<GoogleAdsTokenSet>;
    const expiresAt = typeof token.expires_at === "number" ? token.expires_at : undefined;
    return {
      path,
      exists: true,
      readable: true,
      permissions,
      secure_permissions: securePermissions,
      expires_at: expiresAt,
      expired: expiresAt ? expiresAt <= nowSeconds : undefined,
      has_refresh_token: typeof token.refresh_token === "string" && token.refresh_token.length > 0
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { path, exists: false, readable: false };
    return { path, exists: true, readable: false, error: (error as Error).message };
  }
}

async function inspectHermesClient(homeDir: string): Promise<HermesClientCheck> {
  const configPath = join(homeDir, ".hermes", "config.yaml");
  const skillPath = join(homeDir, ".hermes", "skills", "google-ads-mcp", "SKILL.md");
  const base: Omit<HermesClientCheck, "recommendations"> = {
    config_path: configPath,
    config_exists: false,
    google_ads_server_configured: false,
    package_pinned: false,
    skill_path: skillPath,
    skill_installed: false,
    direct_tool_prefix: "mcp_google_ads_",
    expected_direct_tools: HERMES_DIRECT_TOOLS
  };

  try {
    const [config, skillExists] = await Promise.all([
      readOptionalText(configPath),
      existsFile(skillPath)
    ]);
    const configText = config.text ?? "";
    const check = {
      ...base,
      config_exists: config.exists,
      google_ads_server_configured: /google-ads-mcp-unofficial|google-ads-mcp-server|google-ads-mcp/.test(configText) && /^\s*google[-_]ads\s*:/m.test(configText),
      package_pinned: /google-ads-mcp-unofficial@\d+\.\d+\.\d+/.test(configText),
      mcp_reload_confirmation_disabled: config.exists ? /mcp_reload_confirm\s*:\s*false/.test(configText) : undefined,
      skill_installed: skillExists
    };
    return { ...check, recommendations: buildHermesRecommendations(check) };
  } catch (error) {
    const check = { ...base, error: (error as Error).message };
    return { ...check, recommendations: buildHermesRecommendations(check) };
  }
}

async function readOptionalText(path: string): Promise<{ exists: boolean; text?: string }> {
  try {
    return { exists: true, text: await fs.readFile(path, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
    throw error;
  }
}

async function existsFile(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function buildHermesRecommendations(check: Omit<HermesClientCheck, "recommendations">): string[] {
  const recommendations: string[] = [];
  if (!check.config_exists) {
    recommendations.push("Run `google-ads-mcp-server setup --client hermes --no-auth` to create a Hermes MCP config and local skill.");
  } else if (!check.google_ads_server_configured) {
    recommendations.push("Add a `google-ads` MCP server block to `~/.hermes/config.yaml`.");
  }
  if (check.config_exists && check.google_ads_server_configured && !check.package_pinned) {
    recommendations.push(`Pin the Hermes MCP command to \`${PINNED_NPM_PACKAGE}\` to avoid stale npx cache surprises.`);
  }
  if (!check.skill_installed) {
    recommendations.push("Install the Hermes skill at `~/.hermes/skills/google-ads-mcp/SKILL.md` so agents prefer direct MCP tools over terminal workarounds.");
  }
  if (check.config_exists && check.mcp_reload_confirmation_disabled !== true) {
    recommendations.push("Optional for lower friction: set `approvals.mcp_reload_confirm: false` if your Hermes policy allows MCP reload without confirmation.");
  }
  recommendations.push("After Hermes config changes, use `/reload-mcp` or `hermes mcp test google-ads`; do not run `hermes gateway restart` for normal data access.");
  return recommendations;
}

function buildNextSteps(input: {
  missingEnv: string[];
  token: ConnectionStatus["token"];
  nodeSupported: boolean;
  automaticAuthSupported: boolean;
  redirectUri?: string;
}): string[] {
  const steps: string[] = [];
  if (!input.nodeSupported) steps.push("Install Node.js 20 or newer.");
  for (const name of input.missingEnv) {
    if (name === "GOOGLE_ADS_DEVELOPER_TOKEN") {
      steps.push("Request a Google Ads developer token at https://developers.google.com/google-ads/api/docs/first-call/dev-token (requires an MCC account). Then set GOOGLE_ADS_DEVELOPER_TOKEN.");
    } else if (name === "GOOGLE_ADS_CLIENT_ID" || name === "GOOGLE_ADS_CLIENT_SECRET") {
      steps.push(`Create an OAuth2 desktop client in Google Cloud Console and set ${name}.`);
    } else {
      steps.push(`Set ${name}.`);
    }
  }
  if (input.redirectUri && !input.automaticAuthSupported) {
    steps.push("For one-command auth, set GOOGLE_ADS_REDIRECT_URI to a local callback such as http://127.0.0.1:3000/callback.");
  }
  if (!input.token.exists) {
    steps.push("Run `google-ads-mcp-server auth` to authorize Google Ads and save local tokens.");
  } else if (!input.token.readable) {
    steps.push(`Fix token file readability at ${input.token.path}.`);
  } else if (input.token.secure_permissions === false) {
    steps.push(`Restrict token file permissions with: chmod 600 ${input.token.path}`);
  } else if (input.token.expired && !input.token.has_refresh_token) {
    steps.push("Re-authorize with `google-ads-mcp-server auth`; the current token is expired and has no refresh token.");
  }
  if (steps.length === 0) steps.push("Ready. Add this MCP server to your agent and start with google_ads_list_accounts.");
  return steps;
}
