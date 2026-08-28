import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  AgentManifestInputSchema,
  AgentManifestOutputSchema,
  AuthUrlInputSchema,
  AuthUrlOutputSchema,
  CacheClearOutputSchema,
  CacheStatusOutputSchema,
  CampaignPerformanceInputSchema,
  CampaignStatusToggleInputSchema,
  CapabilitiesOutputSchema,
  CollectionOutputSchema,
  ConnectionStatusInputSchema,
  ConnectionStatusOutputSchema,
  CustomerIdSchema,
  DailyReportInputSchema,
  DataInventoryOutputSchema,
  ExchangeCodeInputSchema,
  ExchangeCodeOutputSchema,
  FindWasteInputSchema,
  GetCampaignInputSchema,
  KeywordPerformanceInputSchema,
  ListAccountsInputSchema,
  ListAdGroupsInputSchema,
  ListCampaignsInputSchema,
  ListKeywordsInputSchema,
  MutationOutputSchema,
  PauseKeywordInputSchema,
  PerformanceInputSchema,
  PrivacyAuditOutputSchema,
  PrivacyModeSchema,
  PrivacyModeValueSchema,
  QuickWinsInputSchema,
  ResponseFormatSchema,
  ResponseOnlyInputSchema,
  ResumeKeywordInputSchema,
  RevokeAccessOutputSchema,
  SetCampaignBudgetInputSchema,
  SetKeywordBidInputSchema,
  StandardOutputSchema
} from "../schemas/common.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { GOOGLE_ADS_API_BASE_URL } from "../constants.js";
import { buildAgentManifest, formatAgentManifestMarkdown } from "../services/agent-manifest.js";
import { buildPrivacyAudit } from "../services/audit.js";
import { DEFAULT_CACHE_TTL_SECONDS, disabledCacheStatus, GoogleAdsCache, type CacheClearResult, type CacheStatus } from "../services/cache.js";
import { buildCapabilities } from "../services/capabilities.js";
import { buildConnectionStatus } from "../services/connection-status.js";
import { buildDataInventory, formatInventoryMarkdown } from "../services/inventory.js";
import { getConfig, sanitizeCustomerId } from "../services/config.js";
import { loadConfigSources } from "../services/local-config.js";
import { GoogleAdsClient } from "../services/google-ads-client.js";
import { bulletList, formatCollection, makeError, makeResponse, microsToUnit } from "../services/format.js";
import { applyPrivacy, resolvePrivacyMode } from "../services/privacy.js";
import { redactCustomerId } from "../services/redaction.js";
import {
  buildProfileSummary,
  getOnboardingFlow,
  getProfile,
  getProfilePath,
  missingCriticalFields,
  updateProfile,
  type WellnessProfileDocument
} from "../services/profile-store.js";

function client(): GoogleAdsClient {
  return new GoogleAdsClient(getConfig());
}

function requireMutationsEnabled(): void {
  // Check the gate BEFORE getConfig() — getConfig() throws on missing env, but
  // we want users to see the actionable "mutations are disabled" message first
  // even if their config isn't set up yet.
  const sources = loadConfigSources();
  const flag = process.env.GOOGLE_ADS_ALLOW_MUTATIONS ?? sources.values.GOOGLE_ADS_ALLOW_MUTATIONS;
  const enabled = flag ? ["1", "true", "yes", "on"].includes(flag.toLowerCase()) : false;
  if (!enabled) {
    throw new Error(
      "Write tools are disabled. To enable: re-run `google-ads-mcp-server setup --allow-mutations` or enable GOOGLE_ADS_ALLOW_MUTATIONS. ASK THE USER BEFORE TURNING THIS ON — it lets agents change campaigns, bids, budgets, and pause/resume keywords."
    );
  }
}

function requireExplicitIntent(value: boolean | undefined, action: string): void {
  if (!value) {
    throw new Error(
      `USER_ACTION_REQUIRED: Set explicit_user_intent=true after the user confirms they want to ${action}. This tool will not auto-apply changes.`
    );
  }
}

function logMutation(action: string, details: Record<string, unknown>): void {
  process.stderr.write(`[google-ads-mcp] MUTATION ${action} ${JSON.stringify(details)}\n`);
}

export function registerGoogleAdsTools(server: McpServer): void {
  // ── Meta / diagnostic tools ────────────────────────────────────────────────
  server.registerTool(
    "google_ads_data_inventory",
    {
      title: "Google Ads Data Inventory",
      description: "List supported Google Ads data domains, scopes, privacy boundary, and recommended first calls. Does not call Google Ads APIs or expose user data.",
      inputSchema: ResponseOnlyInputSchema.shape,
      outputSchema: DataInventoryOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ response_format }) => {
      const inventory = buildDataInventory();
      return makeResponse(inventory, response_format, formatInventoryMarkdown(inventory));
    }
  );

  server.registerTool(
    "google_ads_capabilities",
    {
      title: "Google Ads MCP Capabilities",
      description: "Explain supported Google Ads data, mutation gating, privacy modes, and recommended agent workflow. Does not read Google Ads or expose secrets.",
      inputSchema: ResponseOnlyInputSchema.shape,
      outputSchema: CapabilitiesOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ response_format }) => {
      const capabilities = buildCapabilities();
      return makeResponse(capabilities, response_format, bulletList("Google Ads MCP Capabilities", {
        project: capabilities.project,
        unofficial: capabilities.unofficial,
        api_boundary: capabilities.api_boundary.source,
        unsupported: capabilities.api_boundary.does_not_include.join(", "),
        mutations: `gated by ${capabilities.mutation_model.gated_by_env} (default ${capabilities.mutation_model.default})`,
        docs: capabilities.links.google_ads_api_docs
      }));
    }
  );

  server.registerTool(
    "google_ads_agent_manifest",
    {
      title: "Google Ads Agent Manifest",
      description: "Machine-readable install, runtime, and client guidance for AI agents operating the Google Ads MCP. Does not read Google Ads or expose secrets.",
      inputSchema: AgentManifestInputSchema.shape,
      outputSchema: AgentManifestOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ client: targetClient, response_format }) => {
      const manifest = buildAgentManifest(targetClient);
      return makeResponse(manifest, response_format, formatAgentManifestMarkdown(manifest));
    }
  );

  server.registerTool(
    "google_ads_connection_status",
    {
      title: "Google Ads Connection Status",
      description: "Check whether local Google Ads env vars, token file, Node version, privacy mode, mutation gate, and retry settings are ready. Does not call Google Ads or expose secrets.",
      inputSchema: ConnectionStatusInputSchema.shape,
      outputSchema: ConnectionStatusOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ client: targetClient, response_format }) => {
      const status = await buildConnectionStatus({ client: targetClient });
      return makeResponse(status, response_format, bulletList("Google Ads Connection Status", {
        ok: status.ok,
        ready_for_google_ads_api: status.ready_for_google_ads_api,
        client: status.client,
        mutations_allowed: status.mutations_allowed,
        missing_env: status.missing_env.join(", ") || "none",
        login_customer_id: status.login_customer_id ? redactCustomerId(status.login_customer_id) : "not set",
        token_path: status.token.path,
        token_exists: status.token.exists,
        privacy_mode: status.privacy_mode,
        retry: `${status.retry.enabled ? "enabled" : "disabled"} (max=${status.retry.max_attempts})`,
        next_steps: status.next_steps.join(" | ")
      }));
    }
  );

  server.registerTool(
    "google_ads_privacy_audit",
    {
      title: "Google Ads Privacy Audit",
      description: "Return the local privacy, mutation-gate, cache, token-path, env-presence and redaction posture without revealing secret values.",
      inputSchema: ResponseOnlyInputSchema.shape,
      outputSchema: PrivacyAuditOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ response_format }) => {
      const audit = buildPrivacyAudit();
      return makeResponse(audit, response_format, bulletList("Google Ads Privacy Audit", audit));
    }
  );

  server.registerTool(
    "google_ads_cache_status",
    {
      title: "Google Ads Cache Status",
      description: "Return the SQLite GAQL-response cache status: enabled flag, on-disk path, entry count, oldest entry age, and default TTL. Read-only — never calls Google Ads and does not require credentials.",
      inputSchema: ResponseOnlyInputSchema.shape,
      outputSchema: CacheStatusOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ response_format }) => {
      try {
        const status = readCacheStatusFromEnv();
        return makeResponse(status, response_format, bulletList("Google Ads Cache Status", status));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  server.registerTool(
    "google_ads_clear_cache",
    {
      title: "Google Ads Clear Cache",
      description: "Delete all entries from the local SQLite GAQL-response cache. Does NOT touch Google Ads — only affects local memoization. Not gated by GOOGLE_ADS_ALLOW_MUTATIONS because nothing in your ad account changes. Does not require credentials.",
      inputSchema: ResponseOnlyInputSchema.shape,
      outputSchema: CacheClearOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ response_format }) => {
      try {
        const result = clearCacheFromEnv();
        return makeResponse(result, response_format, bulletList("Google Ads Cache Cleared", result));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  // ── Shared profile tools ───────────────────────────────────────────────────
  server.registerTool(
    "google_ads_profile_get",
    {
      title: "Profile Get (shared Delx profile)",
      description: "Read the shared Delx profile (~/.delx-wellness/profile.json). Returns the user's preferred name, language, timezone, etc. Cross-tool — same profile is shared with other Delx MCPs. Read-only.",
      inputSchema: ResponseOnlyInputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ response_format }) => {
      try {
        const profile = await getProfile();
        const payload = {
          ok: true,
          profile,
          summary: buildProfileSummary(profile),
          missing_critical: missingCriticalFields(profile),
          storage_path: getProfilePath()
        };
        return makeResponse(payload, response_format, bulletList("Google Ads Profile Get", {
          summary: payload.summary,
          missing_critical: payload.missing_critical.join(", ") || "none",
          storage_path: payload.storage_path
        }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  const ProfileUpdateInputSchema = z.object({
    patch: z.record(z.string(), z.unknown()).describe("Partial WellnessProfileDocument patch."),
    explicit_user_intent: z.boolean().optional().describe("Must be true."),
    response_format: ResponseFormatSchema
  }).strict();

  server.registerTool(
    "google_ads_profile_update",
    {
      title: "Profile Update (shared Delx profile)",
      description: "Persist a partial patch to the shared Delx profile (~/.delx-wellness/profile.json). REQUIRES explicit_user_intent=true. NEVER stores secrets — writes will be rejected at validation time.",
      inputSchema: ProfileUpdateInputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ patch, explicit_user_intent, response_format }) => {
      if (!explicit_user_intent) {
        return makeResponse({
          ok: false,
          error: "USER_ACTION_REQUIRED",
          hint: "Set explicit_user_intent=true after the user confirms."
        }, response_format, bulletList("Profile Update", { ok: false, hint: "USER_ACTION_REQUIRED" }));
      }
      try {
        const updated_fields = Object.keys(patch);
        const profile = await updateProfile(patch as Partial<WellnessProfileDocument>);
        const payload = {
          ok: true,
          profile,
          summary: buildProfileSummary(profile),
          updated_fields
        };
        return makeResponse(payload, response_format, bulletList("Profile Update", {
          summary: payload.summary,
          updated_fields: updated_fields.join(", ") || "none"
        }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  const OnboardingInputSchema = z.object({
    locale: z.enum(["en", "pt-BR"]).optional(),
    response_format: ResponseFormatSchema
  }).strict();

  server.registerTool(
    "google_ads_onboarding",
    {
      title: "Onboarding (shared Delx profile)",
      description: "Return the 11-question Delx onboarding flow plus the current profile state and missing critical fields. Same profile reused across all Delx MCPs.",
      inputSchema: OnboardingInputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ locale, response_format }) => {
      try {
        const flow = getOnboardingFlow(locale ?? "en");
        const profile = await getProfile();
        const payload = {
          ok: true,
          flow,
          profile,
          summary: buildProfileSummary(profile),
          missing_critical: missingCriticalFields(profile),
          cross_tool_hint: "The Delx profile is shared across MCPs. Other connectors read the same ~/.delx-wellness/profile.json — ask once, reuse everywhere."
        };
        return makeResponse(payload, response_format, bulletList("Google Ads Onboarding", {
          locale: flow.locale,
          questions: flow.questions.length,
          missing_critical: payload.missing_critical.join(", ") || "none",
          storage_path: flow.storage_path
        }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  // ── Auth tools ─────────────────────────────────────────────────────────────
  server.registerTool(
    "google_ads_get_auth_url",
    {
      title: "Get Google OAuth URL",
      description: "Generate a Google OAuth authorization URL for the Google Ads API. Does not read or modify Google Ads data. Use this first when no local token exists.",
      inputSchema: AuthUrlInputSchema.shape,
      outputSchema: AuthUrlOutputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (params) => {
      try {
        const config = getConfig();
        const url = new GoogleAdsClient(config).authUrl(params.state, params.scopes);
        const output = {
          auth_url: url,
          redirect_uri: config.redirectUri,
          scopes: params.scopes?.length ? params.scopes : config.scopes,
          next_step: "Open auth_url, approve access, then pass the returned code or full redirect URL to google_ads_exchange_code."
        };
        return makeResponse(output, params.response_format, bulletList("Google OAuth URL", output));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  server.registerTool(
    "google_ads_exchange_code",
    {
      title: "Exchange Google OAuth Code",
      description: "Exchange a Google OAuth authorization code for local tokens. Tokens stored at ~/.google-ads-mcp/tokens.json with 0600 perms; never returned in the response.",
      inputSchema: ExchangeCodeInputSchema.shape,
      outputSchema: ExchangeCodeOutputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async (params) => {
      try {
        const result = await client().exchangeCode(params.code);
        const output = {
          ...result,
          note: "Token values were stored locally with 0600 permissions and intentionally omitted from this response."
        };
        return makeResponse(output, params.response_format, bulletList("Google OAuth Exchange", output));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  server.registerTool(
    "google_ads_revoke_access",
    {
      title: "Revoke Google Ads Access",
      description: "Revoke the current Google OAuth grant and delete local tokens. Use only when the user explicitly wants to disconnect Google Ads.",
      inputSchema: ResponseOnlyInputSchema.shape,
      outputSchema: RevokeAccessOutputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    },
    async ({ response_format }) => {
      try {
        const result = await client().revokeAccess();
        const output = { ...result, note: "Google Ads access revoked and local tokens removed. Re-authorize with google_ads_get_auth_url before future API calls." };
        return makeResponse(output, response_format, bulletList("Google Ads Access Revoked", output));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  // ── READ tools (GAQL search) ───────────────────────────────────────────────
  server.registerTool(
    "google_ads_list_accounts",
    {
      title: "List Accessible Customer Accounts",
      description: "List all customer accounts the authenticated user can access. For a manager (MCC) account, this includes every child customer.",
      inputSchema: ListAccountsInputSchema.shape,
      outputSchema: CollectionOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ response_format }) => {
      try {
        const config = getConfig();
        const c = new GoogleAdsClient(config);
        // ListAccessibleCustomers — a special endpoint that doesn't need a customer in the URL.
        const token = await (async () => {
          // Cheap inline auth: just hit the endpoint with default auth headers
          // We use the GAQL search path on the login_customer_id (or any reachable customer) as a fallback.
          return null;
        })();
        void token;
        const listUrl = `${GOOGLE_ADS_API_BASE_URL}/customers:listAccessibleCustomers`;
        const res = await fetchListAccounts(c, listUrl);
        const resourceNames: string[] = Array.isArray(res?.resourceNames) ? res.resourceNames as string[] : [];
        const records = resourceNames.map((r) => {
          const customerId = r.split("/").pop() ?? "";
          return {
            resource_name: r,
            customer_id: config.privacyMode === "raw" ? customerId : redactCustomerId(customerId),
            customer_id_raw_length: customerId.length
          };
        });
        return makeResponse(
          { ok: true, privacy_mode: config.privacyMode, count: records.length, records, has_more: false },
          response_format,
          formatCollection("Accessible Google Ads Customers", records, { count: records.length })
        );
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  registerSearchTool(server, {
    name: "google_ads_list_campaigns",
    title: "List Google Ads Campaigns",
    description: "List campaigns under a Google Ads customer. Returns id, name, status, advertising_channel_type, bidding_strategy_type, and campaign_budget linkage.",
    inputSchema: ListCampaignsInputSchema,
    buildQuery: (p) => {
      const where = p.status === "ALL" ? "" : ` WHERE campaign.status = '${p.status}'`;
      return {
        query: `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign.campaign_budget FROM campaign${where} ORDER BY campaign.id LIMIT ${p.page_size}`
      };
    }
  });

  server.registerTool(
    "google_ads_get_campaign",
    {
      title: "Get Google Ads Campaign",
      description: "Get a single campaign with budget, bidding strategy, and status. Returns the linked campaign_budget id (use it with google_ads_set_campaign_budget_micros).",
      inputSchema: GetCampaignInputSchema.shape,
      outputSchema: StandardOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (params) => {
      try {
        const config = getConfig();
        const privacyMode = resolvePrivacyMode(config, params.privacy_mode);
        const cid = sanitizeCustomerId(params.customer_id);
        if (!cid) throw new Error("Invalid customer_id");
        const query = `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign_budget.id, campaign_budget.amount_micros, campaign_budget.delivery_method FROM campaign WHERE campaign.id = ${Number(params.campaign_id)} LIMIT 1`;
        const res = await new GoogleAdsClient(config).search({ customerId: cid, query });
        const row = res.results?.[0];
        if (!row) {
          return makeResponse({ ok: false, found: false, customer_id: redactCustomerId(cid), campaign_id: params.campaign_id }, params.response_format, bulletList("Get Campaign", { ok: false, found: false }));
        }
        const data = applyPrivacy(row, privacyMode);
        return makeResponse({ ok: true, privacy_mode: privacyMode, customer_id: privacyMode === "raw" ? cid : redactCustomerId(cid), data }, params.response_format, bulletList("Google Ads Campaign", { data: JSON.stringify(data) }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  registerSearchTool(server, {
    name: "google_ads_list_ad_groups",
    title: "List Google Ads Ad Groups",
    description: "List ad groups under a campaign (or all campaigns) in a customer.",
    inputSchema: ListAdGroupsInputSchema,
    buildQuery: (p) => {
      const conds: string[] = [];
      if (p.status !== "ALL") conds.push(`ad_group.status = '${p.status}'`);
      if (p.campaign_id) conds.push(`campaign.id = ${Number(p.campaign_id)}`);
      const where = conds.length ? ` WHERE ${conds.join(" AND ")}` : "";
      return {
        query: `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type, ad_group.cpc_bid_micros, campaign.id, campaign.name FROM ad_group${where} ORDER BY ad_group.id LIMIT ${p.page_size}`
      };
    }
  });

  registerSearchTool(server, {
    name: "google_ads_list_keywords",
    title: "List Google Ads Keywords",
    description: "List keyword criteria under a campaign or ad group. Returns criterion_id, keyword text, match type, status, and cpc_bid_micros.",
    inputSchema: ListKeywordsInputSchema,
    buildQuery: (p) => {
      const conds: string[] = ["ad_group_criterion.type = 'KEYWORD'"];
      if (p.status !== "ALL") conds.push(`ad_group_criterion.status = '${p.status}'`);
      if (p.campaign_id) conds.push(`campaign.id = ${Number(p.campaign_id)}`);
      if (p.ad_group_id) conds.push(`ad_group.id = ${Number(p.ad_group_id)}`);
      return {
        query: `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.cpc_bid_micros, ad_group.id, ad_group.name, campaign.id, campaign.name FROM keyword_view WHERE ${conds.join(" AND ")} ORDER BY ad_group_criterion.criterion_id LIMIT ${p.page_size}`
      };
    }
  });

  server.registerTool(
    "google_ads_get_account_performance",
    {
      title: "Get Account Performance",
      description: "Aggregate performance metrics (impressions, clicks, cost_micros, ctr, average_cpc, conversions) for the customer over a date range.",
      inputSchema: PerformanceInputSchema.shape,
      outputSchema: StandardOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (params) => {
      try {
        const config = getConfig();
        const privacyMode = resolvePrivacyMode(config, params.privacy_mode);
        const cid = sanitizeCustomerId(params.customer_id);
        if (!cid) throw new Error("Invalid customer_id");
        const query = `SELECT customer.id, customer.descriptive_name, customer.currency_code, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.average_cpc, metrics.conversions, metrics.conversions_value FROM customer WHERE segments.date DURING ${params.date_range} LIMIT 1`;
        const res = await new GoogleAdsClient(config).search({ customerId: cid, query });
        const row = res.results?.[0] ?? {};
        const data = applyPrivacy(row, privacyMode);
        const metrics = (row.metrics ?? {}) as Record<string, unknown>;
        const customer = (row.customer ?? {}) as Record<string, unknown>;
        return makeResponse({
          ok: true,
          privacy_mode: privacyMode,
          customer_id: privacyMode === "raw" ? cid : redactCustomerId(cid),
          date_range: params.date_range,
          data,
          summary: {
            customer_name: customer.descriptive_name,
            currency: customer.currency_code,
            impressions: metrics.impressions ?? 0,
            clicks: metrics.clicks ?? 0,
            cost_units: microsToUnit(metrics.cost_micros as number | string | undefined),
            ctr: metrics.ctr,
            average_cpc_units: microsToUnit(metrics.average_cpc as number | string | undefined),
            conversions: metrics.conversions ?? 0
          }
        }, params.response_format, bulletList("Account Performance", {
          date_range: params.date_range,
          impressions: metrics.impressions ?? 0,
          clicks: metrics.clicks ?? 0,
          cost: microsToUnit(metrics.cost_micros as number | string | undefined) ?? 0,
          avg_cpc: microsToUnit(metrics.average_cpc as number | string | undefined) ?? 0,
          conversions: metrics.conversions ?? 0
        }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  server.registerTool(
    "google_ads_get_campaign_performance",
    {
      title: "Get Campaign Performance",
      description: "Per-campaign performance metrics over a date range. Filter to a single campaign with campaign_id.",
      inputSchema: CampaignPerformanceInputSchema.shape,
      outputSchema: StandardOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (params) => {
      try {
        const config = getConfig();
        const privacyMode = resolvePrivacyMode(config, params.privacy_mode);
        const cid = sanitizeCustomerId(params.customer_id);
        if (!cid) throw new Error("Invalid customer_id");
        const filter = params.campaign_id ? ` AND campaign.id = ${Number(params.campaign_id)}` : "";
        const query = `SELECT campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.average_cpc, metrics.conversions FROM campaign WHERE segments.date DURING ${params.date_range}${filter} ORDER BY metrics.cost_micros DESC LIMIT 100`;
        const res = await new GoogleAdsClient(config).search({ customerId: cid, query });
        const records = (res.results ?? []).map((r) => applyPrivacy(r, privacyMode));
        return makeResponse({
          ok: true,
          privacy_mode: privacyMode,
          customer_id: privacyMode === "raw" ? cid : redactCustomerId(cid),
          date_range: params.date_range,
          count: records.length,
          records,
          has_more: false
        }, params.response_format, formatCollection("Campaign Performance", records, { date_range: params.date_range, count: records.length }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  server.registerTool(
    "google_ads_get_keyword_performance",
    {
      title: "Get Keyword Performance",
      description: "Per-keyword performance metrics over a date range. Returns clicks, cost_micros, ctr, average_cpc, conversions, conversion_rate. Filter with campaign_id, ad_group_id, or min_clicks.",
      inputSchema: KeywordPerformanceInputSchema.shape,
      outputSchema: StandardOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (params) => {
      try {
        const config = getConfig();
        const privacyMode = resolvePrivacyMode(config, params.privacy_mode);
        const cid = sanitizeCustomerId(params.customer_id);
        if (!cid) throw new Error("Invalid customer_id");
        const conds: string[] = [`segments.date DURING ${params.date_range}`];
        if (params.campaign_id) conds.push(`campaign.id = ${Number(params.campaign_id)}`);
        if (params.ad_group_id) conds.push(`ad_group.id = ${Number(params.ad_group_id)}`);
        if (params.min_clicks > 0) conds.push(`metrics.clicks >= ${params.min_clicks}`);
        const query = `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group.id, ad_group.name, campaign.id, campaign.name, metrics.clicks, metrics.cost_micros, metrics.impressions, metrics.ctr, metrics.average_cpc, metrics.conversions, metrics.conversions_value FROM keyword_view WHERE ${conds.join(" AND ")} ORDER BY metrics.cost_micros DESC LIMIT 200`;
        const res = await new GoogleAdsClient(config).search({ customerId: cid, query });
        const records = (res.results ?? []).map((r) => {
          const flat = applyPrivacy(r, privacyMode) as Record<string, unknown>;
          // attach derived conversion_rate
          const clicks = Number(flat["metrics.clicks"] ?? 0);
          const conversions = Number(flat["metrics.conversions"] ?? 0);
          if (clicks > 0) flat.conversion_rate = conversions / clicks;
          flat.cost_units = microsToUnit(flat["metrics.cost_micros"] as number | string | undefined);
          flat.avg_cpc_units = microsToUnit(flat["metrics.average_cpc"] as number | string | undefined);
          return flat;
        });
        return makeResponse({
          ok: true,
          privacy_mode: privacyMode,
          customer_id: privacyMode === "raw" ? cid : redactCustomerId(cid),
          date_range: params.date_range,
          count: records.length,
          records,
          has_more: false
        }, params.response_format, formatCollection("Keyword Performance", records, { date_range: params.date_range, count: records.length }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  // ── Workflow tools ─────────────────────────────────────────────────────────
  server.registerTool(
    "google_ads_daily_report",
    {
      title: "Daily Performance Report",
      description: "Synthetic daily performance snapshot. Pulls YESTERDAY + LAST_7_DAYS + LAST_30_DAYS aggregates for a customer, optionally alerts when CPC exceeds cpc_alert_threshold. Pure-read workflow tool — never mutates.",
      inputSchema: DailyReportInputSchema.shape,
      outputSchema: StandardOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (params) => {
      try {
        const config = getConfig();
        const cid = sanitizeCustomerId(params.customer_id);
        if (!cid) throw new Error("Invalid customer_id");
        const c = new GoogleAdsClient(config);
        const fetchWindow = async (range: string) => {
          const q = `SELECT customer.descriptive_name, customer.currency_code, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.average_cpc, metrics.conversions FROM customer WHERE segments.date DURING ${range} LIMIT 1`;
          const r = await c.search({ customerId: cid, query: q });
          const row = r.results?.[0] ?? {};
          const m = (row.metrics ?? {}) as Record<string, unknown>;
          const cust = (row.customer ?? {}) as Record<string, unknown>;
          return {
            range,
            customer_name: cust.descriptive_name,
            currency: cust.currency_code,
            impressions: Number(m.impressions ?? 0),
            clicks: Number(m.clicks ?? 0),
            cost_units: microsToUnit(m.cost_micros as number | string | undefined) ?? 0,
            ctr: Number(m.ctr ?? 0),
            avg_cpc_units: microsToUnit(m.average_cpc as number | string | undefined) ?? 0,
            conversions: Number(m.conversions ?? 0)
          };
        };
        const [yesterday, last7, last30] = await Promise.all([
          fetchWindow("YESTERDAY"),
          fetchWindow("LAST_7_DAYS"),
          fetchWindow("LAST_30_DAYS")
        ]);
        const alert = params.cpc_alert_threshold !== undefined && yesterday.avg_cpc_units > params.cpc_alert_threshold;
        const status: "OK" | "ALERT" = alert ? "ALERT" : "OK";
        const markdown = renderDailyReport({ yesterday, last7, last30, alert, threshold: params.cpc_alert_threshold, customer_id_display: redactCustomerId(cid) ?? cid });
        return makeResponse({
          ok: true,
          status,
          customer_id: config.privacyMode === "raw" ? cid : redactCustomerId(cid),
          yesterday,
          last7,
          last30,
          alert,
          cpc_alert_threshold: params.cpc_alert_threshold
        }, params.response_format, markdown);
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  server.registerTool(
    "google_ads_find_waste",
    {
      title: "Find Waste Keywords (read-only)",
      description: "Identify keywords matching the 'high cost + zero conversions' waste pattern (inspiration from script #1). Returns a ranked list of candidates — NEVER pauses anything. Pair with google_ads_pause_keyword (gated) after user confirmation.",
      inputSchema: FindWasteInputSchema.shape,
      outputSchema: StandardOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (params) => {
      try {
        const config = getConfig();
        const privacyMode = resolvePrivacyMode(config, params.privacy_mode);
        const cid = sanitizeCustomerId(params.customer_id);
        if (!cid) throw new Error("Invalid customer_id");
        const conds: string[] = [
          `segments.date DURING ${params.date_range}`,
          `metrics.clicks >= ${params.min_clicks}`,
          `metrics.cost_micros >= ${params.min_cost_micros}`
        ];
        if (params.campaign_id) conds.push(`campaign.id = ${Number(params.campaign_id)}`);
        if (params.zero_conversions_only) conds.push("metrics.conversions = 0");
        const query = `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group.id, ad_group.name, campaign.id, campaign.name, metrics.clicks, metrics.cost_micros, metrics.average_cpc, metrics.conversions FROM keyword_view WHERE ${conds.join(" AND ")} ORDER BY metrics.cost_micros DESC LIMIT 100`;
        const res = await new GoogleAdsClient(config).search({ customerId: cid, query });
        const candidates = (res.results ?? []).map((r) => {
          const flat = applyPrivacy(r, privacyMode) as Record<string, unknown>;
          flat.cost_units = microsToUnit(flat["metrics.cost_micros"] as number | string | undefined);
          flat.avg_cpc_units = microsToUnit(flat["metrics.average_cpc"] as number | string | undefined);
          flat.waste_score = Number(flat["metrics.cost_micros"] ?? 0);
          return flat;
        });
        const totalWaste = candidates.reduce((acc, c) => acc + Number(c["metrics.cost_micros"] ?? 0), 0);
        return makeResponse({
          ok: true,
          privacy_mode: privacyMode,
          customer_id: privacyMode === "raw" ? cid : redactCustomerId(cid),
          date_range: params.date_range,
          filters: { min_clicks: params.min_clicks, min_cost_micros: params.min_cost_micros, zero_conversions_only: params.zero_conversions_only },
          count: candidates.length,
          total_waste_units: microsToUnit(totalWaste),
          candidates,
          recommendation: candidates.length > 0
            ? "Review candidates. To pause, ask the user to enable GOOGLE_ADS_ALLOW_MUTATIONS, then call google_ads_pause_keyword per criterion_id."
            : "No waste candidates found at current thresholds. Try relaxing min_clicks or zero_conversions_only."
        }, params.response_format, bulletList("Find Waste Keywords", {
          customer_id: redactCustomerId(cid),
          date_range: params.date_range,
          candidates: candidates.length,
          total_waste: microsToUnit(totalWaste) ?? 0,
          recommendation: candidates.length > 0 ? "Review then act with mutations enabled" : "No candidates at current thresholds"
        }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  server.registerTool(
    "google_ads_quick_wins",
    {
      title: "Find Quick-Win Keywords (read-only)",
      description: "Identify keywords with LOW CPC + HIGH CTR + at-least-some conversions — candidates to RAISE the bid on. Inverse of google_ads_find_waste. Returns a ranked list with a recommended_bid_micros (current + 25%, capped at 2x). NEVER changes bids; pair with google_ads_set_keyword_bid_micros (gated) after user confirmation.",
      inputSchema: QuickWinsInputSchema.shape,
      outputSchema: StandardOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (params) => {
      try {
        const config = getConfig();
        const privacyMode = resolvePrivacyMode(config, params.privacy_mode);
        const cid = sanitizeCustomerId(params.customer_id);
        if (!cid) throw new Error("Invalid customer_id");
        const dateClause = buildDateRangeClause(params.lookback_days);
        // GAQL CTR is a 0..1 ratio (not 0..100), so divide the percent threshold by 100.
        const minCtrRatio = params.min_ctr / 100;
        const query = `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group.id, campaign.id, metrics.average_cpc, metrics.ctr, metrics.conversions, ad_group_criterion.effective_cpc_bid_micros FROM keyword_view WHERE ${dateClause} AND metrics.ctr > ${minCtrRatio} AND metrics.average_cpc < ${params.max_avg_cpc_micros} AND metrics.conversions >= ${params.min_conversions} ORDER BY metrics.conversions DESC LIMIT ${params.limit}`;
        const res = await new GoogleAdsClient(config).search({ customerId: cid, query }, privacyMode);
        const candidates = (res.results ?? []).map((row) => buildQuickWinCandidate(row));
        const output = {
          ok: true,
          privacy_mode: privacyMode,
          customer_id: privacyMode === "raw" ? cid : redactCustomerId(cid),
          criteria_applied: {
            lookback_days: params.lookback_days,
            min_ctr_pct: params.min_ctr,
            max_avg_cpc_micros: params.max_avg_cpc_micros,
            min_conversions: params.min_conversions,
            limit: params.limit
          },
          total_found: candidates.length,
          candidates,
          next_steps: candidates.length > 0
            ? [
                "Review the recommended_bid_micros for each candidate (current_bid + 25%, capped at 2x current).",
                "To raise bids, ask the user to enable GOOGLE_ADS_ALLOW_MUTATIONS, then call google_ads_set_keyword_bid_micros per criterion_id with the recommended value (or a more conservative one).",
                "Re-run google_ads_quick_wins after 7+ days to confirm the new bid improved conversions before raising again."
              ]
            : [
                "No quick-win candidates at current thresholds. Try lowering min_ctr or min_conversions, or widening lookback_days."
              ]
        };
        return makeResponse(output, params.response_format, bulletList("Quick-Win Keywords", {
          customer_id: redactCustomerId(cid),
          lookback_days: params.lookback_days,
          min_ctr_pct: params.min_ctr,
          max_avg_cpc_micros: params.max_avg_cpc_micros,
          min_conversions: params.min_conversions,
          candidates: candidates.length,
          next: candidates.length > 0 ? "Review candidates, then raise bids with mutations enabled" : "No candidates at current thresholds"
        }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  // ── MUTATION tools (gated) ─────────────────────────────────────────────────
  server.registerTool(
    "google_ads_pause_keyword",
    {
      title: "Pause Keyword (gated mutation)",
      description: "Pause a single keyword by criterion_id. GATED: requires GOOGLE_ADS_ALLOW_MUTATIONS enabled AND explicit_user_intent. Ask the user first.",
      inputSchema: PauseKeywordInputSchema.shape,
      outputSchema: MutationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async (params) => {
      try {
        requireMutationsEnabled();
        requireExplicitIntent(params.explicit_user_intent, "pause this keyword");
        const cid = sanitizeCustomerId(params.customer_id);
        if (!cid) throw new Error("Invalid customer_id");
        const resourceName = `customers/${cid}/adGroupCriteria/${params.ad_group_id}~${params.criterion_id}`;
        const body = {
          operations: [{
            updateMask: "status",
            update: { resourceName, status: "PAUSED" }
          }]
        };
        logMutation("pause_keyword", { resource_name: resourceName });
        const result = await new GoogleAdsClient(getConfig()).mutate({ customerId: cid, servicePath: "adGroupCriteria:mutate", body });
        return makeResponse({ ok: true, applied: true, resource: resourceName, result }, params.response_format, bulletList("Pause Keyword", { resource: resourceName, applied: true }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  server.registerTool(
    "google_ads_resume_keyword",
    {
      title: "Resume Keyword (gated mutation)",
      description: "Resume (enable) a single paused keyword by criterion_id. GATED.",
      inputSchema: ResumeKeywordInputSchema.shape,
      outputSchema: MutationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async (params) => {
      try {
        requireMutationsEnabled();
        requireExplicitIntent(params.explicit_user_intent, "resume this keyword");
        const cid = sanitizeCustomerId(params.customer_id);
        if (!cid) throw new Error("Invalid customer_id");
        const resourceName = `customers/${cid}/adGroupCriteria/${params.ad_group_id}~${params.criterion_id}`;
        const body = {
          operations: [{
            updateMask: "status",
            update: { resourceName, status: "ENABLED" }
          }]
        };
        logMutation("resume_keyword", { resource_name: resourceName });
        const result = await new GoogleAdsClient(getConfig()).mutate({ customerId: cid, servicePath: "adGroupCriteria:mutate", body });
        return makeResponse({ ok: true, applied: true, resource: resourceName, result }, params.response_format, bulletList("Resume Keyword", { resource: resourceName, applied: true }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  server.registerTool(
    "google_ads_set_keyword_bid_micros",
    {
      title: "Set Keyword Bid (gated mutation)",
      description: "Update the cpc_bid_micros for a keyword criterion. GATED. Bid must be in micros (10_000 = $0.01).",
      inputSchema: SetKeywordBidInputSchema.shape,
      outputSchema: MutationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async (params) => {
      try {
        requireMutationsEnabled();
        requireExplicitIntent(params.explicit_user_intent, `set this keyword's CPC bid to ${params.cpc_bid_micros} micros (${microsToUnit(params.cpc_bid_micros)} units)`);
        const cid = sanitizeCustomerId(params.customer_id);
        if (!cid) throw new Error("Invalid customer_id");
        const resourceName = `customers/${cid}/adGroupCriteria/${params.ad_group_id}~${params.criterion_id}`;
        const body = {
          operations: [{
            updateMask: "cpcBidMicros",
            update: { resourceName, cpcBidMicros: String(params.cpc_bid_micros) }
          }]
        };
        logMutation("set_keyword_bid", { resource_name: resourceName, cpc_bid_micros: params.cpc_bid_micros });
        const result = await new GoogleAdsClient(getConfig()).mutate({ customerId: cid, servicePath: "adGroupCriteria:mutate", body });
        return makeResponse({ ok: true, applied: true, resource: resourceName, cpc_bid_micros: params.cpc_bid_micros, cpc_bid_units: microsToUnit(params.cpc_bid_micros), result }, params.response_format, bulletList("Set Keyword Bid", { resource: resourceName, cpc_bid_units: microsToUnit(params.cpc_bid_micros) ?? 0 }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  server.registerTool(
    "google_ads_set_campaign_budget_micros",
    {
      title: "Set Campaign Budget (gated mutation)",
      description: "Update a campaign budget's amount_micros. GATED. campaign_budget_id is NOT the campaign id — discover it via google_ads_get_campaign (campaign_budget.id).",
      inputSchema: SetCampaignBudgetInputSchema.shape,
      outputSchema: MutationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async (params) => {
      try {
        requireMutationsEnabled();
        requireExplicitIntent(params.explicit_user_intent, `set the daily budget to ${microsToUnit(params.amount_micros)} units`);
        const cid = sanitizeCustomerId(params.customer_id);
        if (!cid) throw new Error("Invalid customer_id");
        const resourceName = `customers/${cid}/campaignBudgets/${params.campaign_budget_id}`;
        const body = {
          operations: [{
            updateMask: "amountMicros",
            update: { resourceName, amountMicros: String(params.amount_micros) }
          }]
        };
        logMutation("set_campaign_budget", { resource_name: resourceName, amount_micros: params.amount_micros });
        const result = await new GoogleAdsClient(getConfig()).mutate({ customerId: cid, servicePath: "campaignBudgets:mutate", body });
        return makeResponse({ ok: true, applied: true, resource: resourceName, amount_micros: params.amount_micros, amount_units: microsToUnit(params.amount_micros), result }, params.response_format, bulletList("Set Campaign Budget", { resource: resourceName, amount_units: microsToUnit(params.amount_micros) ?? 0 }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  server.registerTool(
    "google_ads_pause_campaign",
    {
      title: "Pause Campaign (gated mutation)",
      description: "Pause an entire campaign by id. GATED.",
      inputSchema: CampaignStatusToggleInputSchema.shape,
      outputSchema: MutationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async (params) => {
      try {
        requireMutationsEnabled();
        requireExplicitIntent(params.explicit_user_intent, "pause this campaign");
        const cid = sanitizeCustomerId(params.customer_id);
        if (!cid) throw new Error("Invalid customer_id");
        const resourceName = `customers/${cid}/campaigns/${params.campaign_id}`;
        const body = {
          operations: [{
            updateMask: "status",
            update: { resourceName, status: "PAUSED" }
          }]
        };
        logMutation("pause_campaign", { resource_name: resourceName });
        const result = await new GoogleAdsClient(getConfig()).mutate({ customerId: cid, servicePath: "campaigns:mutate", body });
        return makeResponse({ ok: true, applied: true, resource: resourceName, result }, params.response_format, bulletList("Pause Campaign", { resource: resourceName, applied: true }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  server.registerTool(
    "google_ads_resume_campaign",
    {
      title: "Resume Campaign (gated mutation)",
      description: "Resume (enable) a paused campaign by id. GATED.",
      inputSchema: CampaignStatusToggleInputSchema.shape,
      outputSchema: MutationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async (params) => {
      try {
        requireMutationsEnabled();
        requireExplicitIntent(params.explicit_user_intent, "resume this campaign");
        const cid = sanitizeCustomerId(params.customer_id);
        if (!cid) throw new Error("Invalid customer_id");
        const resourceName = `customers/${cid}/campaigns/${params.campaign_id}`;
        const body = {
          operations: [{
            updateMask: "status",
            update: { resourceName, status: "ENABLED" }
          }]
        };
        logMutation("resume_campaign", { resource_name: resourceName });
        const result = await new GoogleAdsClient(getConfig()).mutate({ customerId: cid, servicePath: "campaigns:mutate", body });
        return makeResponse({ ok: true, applied: true, resource: resourceName, result }, params.response_format, bulletList("Resume Campaign", { resource: resourceName, applied: true }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function registerSearchTool(
  server: McpServer,
  spec: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<z.ZodRawShape>;
    buildQuery: (params: Record<string, unknown>) => { query: string };
  }
): void {
  const shape = spec.inputSchema.shape as z.ZodRawShape;
  server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: shape,
      outputSchema: CollectionOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (params: Record<string, unknown>) => {
      try {
        const config = getConfig();
        const p = params;
        const privacyMode = resolvePrivacyMode(config, p.privacy_mode as ReturnType<typeof resolvePrivacyMode> | undefined);
        const cid = sanitizeCustomerId(p.customer_id as string);
        if (!cid) throw new Error("Invalid customer_id");
        const { query } = spec.buildQuery(params);
        const res = await new GoogleAdsClient(config).search({ customerId: cid, query, pageSize: p.page_size as number | undefined });
        const records = (res.results ?? []).map((r) => applyPrivacy(r, privacyMode));
        const output = {
          ok: true,
          privacy_mode: privacyMode,
          customer_id: privacyMode === "raw" ? cid : redactCustomerId(cid),
          count: records.length,
          records,
          next_page_token: res.nextPageToken,
          has_more: Boolean(res.nextPageToken)
        };
        return makeResponse(output, p.response_format as "markdown" | "json", formatCollection(spec.title, records, { count: records.length, customer_id: redactCustomerId(cid) }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );
}

async function fetchListAccounts(c: GoogleAdsClient, url: string): Promise<{ resourceNames?: string[] }> {
  // listAccessibleCustomers uses GET and no customer in path. Use the client's
  // request plumbing by exposing a tiny convenience — we have to inline it
  // because the public methods all POST to customer-scoped urls. Build a
  // minimal GET via fetch + auth headers reused from the client.
  // To keep things small, we use a private trampoline through `mutate` by
  // detecting the special listAccessible URL pattern in the client. Simpler:
  // call the GET directly here using the existing token from the client.
  const cfg = (c as unknown as { config: import("../types.js").GoogleAdsConfig }).config;
  const { TokenStore } = await import("../services/token-store.js");
  const tokens = await new TokenStore(cfg.tokenPath).read();
  if (!tokens?.access_token) {
    throw new Error("Google Ads token not found. Run `google-ads-mcp-server auth` first.");
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokens.access_token}`,
    Accept: "application/json",
    "developer-token": cfg.developerToken
  };
  if (cfg.loginCustomerId) headers["login-customer-id"] = cfg.loginCustomerId;
  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Ads API HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<{ resourceNames?: string[] }>;
}

function renderDailyReport(input: {
  yesterday: ReturnType<typeof Number> extends never ? never : {
    range: string; customer_name?: unknown; currency?: unknown;
    impressions: number; clicks: number; cost_units: number; ctr: number; avg_cpc_units: number; conversions: number;
  };
  last7: typeof input.yesterday;
  last30: typeof input.yesterday;
  alert: boolean;
  threshold?: number;
  customer_id_display: string;
}): string {
  const fmt = (n: number, d = 2) => Number.isFinite(n) ? n.toFixed(d) : "0";
  const lines = [
    `# Google Ads · Daily Report${input.alert ? " ⚠️ ALERT" : ""}`,
    "",
    `- **customer_id**: ${input.customer_id_display}`,
    `- **customer_name**: ${input.yesterday.customer_name ?? "n/a"}`,
    `- **currency**: ${input.yesterday.currency ?? "n/a"}`,
    "",
    "## Yesterday",
    `- Impressions: ${input.yesterday.impressions}`,
    `- Clicks: ${input.yesterday.clicks}`,
    `- CTR: ${fmt((input.yesterday.ctr ?? 0) * 100, 2)}%`,
    `- Cost: ${fmt(input.yesterday.cost_units)}`,
    `- Avg CPC: ${fmt(input.yesterday.avg_cpc_units)}`,
    `- Conversions: ${input.yesterday.conversions}`,
    "",
    "## Last 7 Days",
    `- Clicks: ${input.last7.clicks}  ·  Cost: ${fmt(input.last7.cost_units)}  ·  Avg CPC: ${fmt(input.last7.avg_cpc_units)}`,
    "",
    "## Last 30 Days",
    `- Clicks: ${input.last30.clicks}  ·  Cost: ${fmt(input.last30.cost_units)}  ·  Avg CPC: ${fmt(input.last30.avg_cpc_units)}`,
    ""
  ];
  if (input.alert) {
    lines.push(`> ⚠️ Yesterday's avg CPC ${fmt(input.yesterday.avg_cpc_units)} exceeds threshold ${fmt(input.threshold ?? 0)}.`);
    lines.push("> Consider lowering bids on costly keywords or running google_ads_find_waste to identify cleanup candidates.");
  }
  return lines.join("\n");
}

/**
 * Build a GAQL DATE_RANGE clause covering the last `days` days.
 *
 * Google Ads accepts a handful of pre-baked ranges (LAST_7_DAYS, LAST_30_DAYS,
 * LAST_90_DAYS, YESTERDAY, etc.) — use those when they match exactly. Otherwise
 * fall back to a `BETWEEN '<start>' AND '<end>'` form where both bounds are
 * UTC dates (YYYY-MM-DD). End date = yesterday (Google Ads typically lags
 * "today" by hours; yesterday gives finalized numbers).
 */
export function buildDateRangeClause(days: number, todayMs: number = Date.now()): string {
  if (days === 7) return "segments.date DURING LAST_7_DAYS";
  if (days === 30) return "segments.date DURING LAST_30_DAYS";
  if (days === 90) return "segments.date DURING LAST_90_DAYS";
  if (days === 14) return "segments.date DURING LAST_14_DAYS";
  if (days === 1) return "segments.date DURING YESTERDAY";
  const today = new Date(todayMs);
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));
  const start = new Date(end.getTime());
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return `segments.date BETWEEN '${toIsoDate(start)}' AND '${toIsoDate(end)}'`;
}

function toIsoDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Map a raw GAQL row from keyword_view into a quick-win candidate. The recommended
 * bid is current + 25%, but never more than 2x the current bid (rough guard
 * against runaway recommendations on outlier under-bid keywords).
 */
export function buildQuickWinCandidate(row: Record<string, unknown>): Record<string, unknown> {
  const criterion = (row.ad_group_criterion ?? {}) as Record<string, unknown>;
  const keyword = (criterion.keyword ?? {}) as Record<string, unknown>;
  const adGroup = (row.ad_group ?? {}) as Record<string, unknown>;
  const campaign = (row.campaign ?? {}) as Record<string, unknown>;
  const metrics = (row.metrics ?? {}) as Record<string, unknown>;
  const currentAvgCpcMicros = toNumber(metrics.average_cpc);
  const currentCpcBidMicros = toNumber(criterion.effective_cpc_bid_micros);
  const ctrRatio = toNumber(metrics.ctr) ?? 0;
  const conversions = toNumber(metrics.conversions) ?? 0;
  const baseBid = currentCpcBidMicros ?? currentAvgCpcMicros ?? 0;
  const proposed = Math.round(baseBid * 1.25);
  const cap = Math.round(baseBid * 2);
  const recommended = baseBid > 0 ? Math.min(proposed, cap) : null;
  return {
    criterion_id: criterion.criterion_id ?? null,
    ad_group_id: adGroup.id ?? null,
    campaign_id: campaign.id ?? null,
    keyword_text: keyword.text ?? null,
    match_type: keyword.match_type ?? null,
    current_avg_cpc_micros: currentAvgCpcMicros ?? null,
    current_cpc_bid_micros: currentCpcBidMicros ?? null,
    ctr_pct: Number((ctrRatio * 100).toFixed(2)),
    conversions,
    recommended_bid_micros: recommended,
    reason: `CTR ${(ctrRatio * 100).toFixed(2)}% with avg CPC ${currentAvgCpcMicros ?? 0} micros and ${conversions} conversions — likely under-bid.`
  };
}

function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function resolveCacheSettings(): { enabled: boolean; path: string; ttlSeconds: number } {
  const sources = loadConfigSources();
  const v = (k: keyof typeof sources.values) => sources.values[k];
  const rawEnabled = v("GOOGLE_ADS_CACHE");
  const enabled = Boolean(rawEnabled && ["1", "true", "yes", "on", "sqlite"].includes(rawEnabled.toLowerCase()));
  const path = v("GOOGLE_ADS_CACHE_PATH") ?? join(homedir(), ".google-ads-mcp", "cache.sqlite");
  const ttlRaw = v("GOOGLE_ADS_CACHE_TTL_SECONDS");
  const ttl = ttlRaw && Number.isFinite(Number(ttlRaw)) && Number(ttlRaw) >= 0 ? Math.floor(Number(ttlRaw)) : DEFAULT_CACHE_TTL_SECONDS;
  return { enabled, path, ttlSeconds: ttl };
}

function readCacheStatusFromEnv(): CacheStatus {
  const { enabled, path, ttlSeconds } = resolveCacheSettings();
  if (!enabled) return disabledCacheStatus(path, ttlSeconds);
  let cache: GoogleAdsCache | undefined;
  try {
    cache = new GoogleAdsCache(path, ttlSeconds);
    return cache.status();
  } finally {
    cache?.close();
  }
}

function clearCacheFromEnv(): CacheClearResult & { cache_enabled: boolean; cache_path: string } {
  const { enabled, path, ttlSeconds } = resolveCacheSettings();
  if (!enabled) {
    return { cleared_entries: 0, cache_enabled: false, cache_path: path };
  }
  let cache: GoogleAdsCache | undefined;
  try {
    cache = new GoogleAdsCache(path, ttlSeconds);
    const cleared = cache.clear();
    return { ...cleared, cache_enabled: true, cache_path: path };
  } finally {
    cache?.close();
  }
}

// Silence unused-import warnings for schema-only imports.
void PrivacyModeSchema;
void PrivacyModeValueSchema;
void CustomerIdSchema;
