import { URLSearchParams, URL } from "node:url";
import {
  GOOGLE_ADS_API_BASE_URL,
  GOOGLE_OAUTH_AUTH_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  SERVER_NAME,
  SERVER_VERSION
} from "../constants.js";
import type { GaqlSearchResponse, GoogleAdsConfig, GoogleAdsTokenSet } from "../types.js";
import { disabledCacheStatus, GoogleAdsCache, type CacheStatus } from "./cache.js";
import { fetchWithRetry as fetchWithRetryMiddleware } from "./http-retry.js";
import { redactErrorMessage } from "./redaction.js";
import { TokenStore } from "./token-store.js";

const USER_AGENT = `${SERVER_NAME}/${SERVER_VERSION}`;

export interface GaqlSearchOptions {
  customerId: string;
  query: string;
  pageSize?: number;
  pageToken?: string;
}

export interface MutateOperation {
  /**
   * The resource path for the operation, e.g. `keywordPlanService:mutateKeywordPlans`,
   * `campaignService:mutateCampaigns`, `adGroupCriterionService:mutateAdGroupCriteria`.
   * Wrapped by this client into `customers/{cid}/{path}`.
   */
  servicePath: string;
  /** The JSON body sent to the service, must match the Google Ads REST contract. */
  body: Record<string, unknown>;
  customerId: string;
}

/**
 * Minimal Google Ads REST client.
 *
 * Implements OAuth2 refresh-token flow, GAQL search, and generic mutate calls.
 * Does NOT depend on the heavyweight `google-ads-api` npm package — speaks
 * the REST API directly per https://developers.google.com/google-ads/api/rest/overview.
 */
export class GoogleAdsClient {
  private readonly tokenStore: TokenStore;
  private cache?: GoogleAdsCache;

  constructor(private readonly config: GoogleAdsConfig) {
    this.tokenStore = new TokenStore(config.tokenPath);
  }

  authUrl(state?: string, scopes?: string[]): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      // refresh tokens require offline access and prompt=consent on the first
      // authorization so Google returns a refresh_token (it omits it on
      // subsequent grants for the same user/client otherwise).
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      scope: (scopes?.length ? scopes : this.config.scopes).join(" ")
    });
    if (state) params.set("state", state);
    return `${GOOGLE_OAUTH_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(input: string): Promise<{ ok: true; token_path: string; scope?: string; expires_at?: number; has_refresh_token: boolean }> {
    const code = this.extractCode(input);
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret
    });

    const tokens = await this.requestTokens(body);
    if (!tokens.refresh_token) {
      // Surface the gotcha: Google withholds refresh_token when re-granting an existing scope.
      throw new Error(
        "Google did not return a refresh_token. Revoke the prior grant at https://myaccount.google.com/permissions and re-run `google-ads-mcp-server auth` with prompt=consent (default)."
      );
    }
    await this.tokenStore.withLock(async () => this.tokenStore.write(tokens));
    return {
      ok: true,
      token_path: this.config.tokenPath,
      scope: tokens.scope,
      expires_at: tokens.expires_at,
      has_refresh_token: Boolean(tokens.refresh_token)
    };
  }

  /**
   * Execute a GAQL query against `customers/{customerId}/googleAds:search`.
   * Auto-pages when callers iterate `nextPageToken`.
   */
  async search(options: GaqlSearchOptions): Promise<GaqlSearchResponse> {
    const cid = sanitize(options.customerId);
    const url = `${GOOGLE_ADS_API_BASE_URL}/customers/${cid}/googleAds:search`;
    const body: Record<string, unknown> = { query: options.query };
    if (options.pageSize) body.pageSize = options.pageSize;
    if (options.pageToken) body.pageToken = options.pageToken;
    return this.postJson(url, body) as Promise<GaqlSearchResponse>;
  }

  /**
   * Convenience helper — exhaustively page a GAQL query and concatenate
   * `results` arrays. Caller should set sensible LIMIT in the query when the
   * dataset could be large.
   */
  async searchAll(options: GaqlSearchOptions): Promise<{ results: Array<Record<string, unknown>>; pages: number }> {
    let pageToken: string | undefined = options.pageToken;
    const aggregated: Array<Record<string, unknown>> = [];
    let pages = 0;
    do {
      const response = await this.search({ ...options, pageToken });
      pages += 1;
      if (response.results?.length) aggregated.push(...response.results);
      pageToken = response.nextPageToken;
      if (pages >= 50) break; // hard safety cap to avoid runaway agents
    } while (pageToken);
    return { results: aggregated, pages };
  }

  /**
   * Generic mutate operation — wraps any `customers/{cid}/{servicePath}` POST
   * with the same auth/retry plumbing.
   */
  async mutate(op: MutateOperation): Promise<unknown> {
    const cid = sanitize(op.customerId);
    const url = `${GOOGLE_ADS_API_BASE_URL}/customers/${cid}/${op.servicePath}`;
    return this.postJson(url, op.body);
  }

  cacheStatus(): CacheStatus {
    if (!this.config.cacheEnabled) return disabledCacheStatus(this.config.cachePath);
    return this.getCache().status();
  }

  async revokeAccess(): Promise<{ ok: true; token_path: string; local_tokens_cleared: boolean }> {
    const current = await this.tokenStore.read();
    const token = current?.access_token ?? current?.refresh_token;
    if (token) {
      // best-effort revoke at Google — doesn't matter if it fails (token may already be invalid)
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" });
      } catch {
        // swallow — local clear is the source of truth
      }
    }
    await this.tokenStore.withLock(async () => this.tokenStore.clear());
    return { ok: true, token_path: this.config.tokenPath, local_tokens_cleared: true };
  }

  private async postJson(url: string, body: Record<string, unknown>): Promise<unknown> {
    const bodyText = JSON.stringify(body);

    // Try the cache first for GET-equivalent reads (search calls are POSTs but
    // semantically idempotent on the query+body pair).
    if (this.config.cacheEnabled && url.includes(":search")) {
      const cached = this.getCache().get("POST", url, bodyText);
      if (cached !== undefined) return cached;
    }

    const token = await this.getValidToken();
    const response = await this.fetchWithRetry(url, this.buildInit("POST", token.access_token, bodyText));
    if (response.status === 401) {
      const refreshed = await this.refreshToken(true);
      const retry = await this.fetchWithRetry(url, this.buildInit("POST", refreshed.access_token, bodyText));
      return this.parseAndCache(url, bodyText, retry);
    }
    return this.parseAndCache(url, bodyText, response);
  }

  private buildInit(method: string, accessToken: string, bodyText?: string): RequestInit {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "developer-token": this.config.developerToken
    };
    if (this.config.loginCustomerId) headers["login-customer-id"] = this.config.loginCustomerId;
    return { method, headers, body: bodyText };
  }

  private async getValidToken(): Promise<GoogleAdsTokenSet> {
    const tokens = await this.tokenStore.read();
    if (!tokens?.access_token) {
      throw new Error(
        "Google Ads token not found. Run `google-ads-mcp-server auth` (or call google_ads_get_auth_url + google_ads_exchange_code from the agent) to authorize."
      );
    }
    const expiresAt = tokens.expires_at ?? 0;
    const shouldRefresh = Boolean(tokens.refresh_token && expiresAt && expiresAt - Math.floor(Date.now() / 1000) < 120);
    return shouldRefresh ? this.refreshToken(false) : tokens;
  }

  private async refreshToken(force: boolean): Promise<GoogleAdsTokenSet> {
    return this.tokenStore.withLock(async () => {
      const current = await this.tokenStore.read();
      if (!current?.refresh_token) {
        throw new Error(
          "Google Ads refresh_token not found. Re-authorize with `google-ads-mcp-server auth` — Google only returns a refresh_token on the first consent (or after revoking at https://myaccount.google.com/permissions)."
        );
      }
      if (!force && current.expires_at && current.expires_at - Math.floor(Date.now() / 1000) >= 120) {
        return current;
      }

      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: current.refresh_token,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret
      });
      const refreshed = await this.requestTokens(body);
      // Google's refresh response typically omits refresh_token — keep the existing one.
      const next: GoogleAdsTokenSet = {
        ...current,
        access_token: refreshed.access_token,
        token_type: refreshed.token_type ?? current.token_type,
        scope: refreshed.scope ?? current.scope,
        expires_at: refreshed.expires_at ?? current.expires_at
      };
      await this.tokenStore.write(next);
      return next;
    });
  }

  private async requestTokens(body: URLSearchParams): Promise<GoogleAdsTokenSet> {
    const response = await this.fetchWithRetry(GOOGLE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": USER_AGENT
      },
      body: body.toString()
    });
    const data = await this.parseResponse(response) as Record<string, unknown>;
    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : undefined;
    return {
      access_token: String(data.access_token ?? ""),
      refresh_token: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
      token_type: typeof data.token_type === "string" ? data.token_type : undefined,
      scope: typeof data.scope === "string" ? data.scope : undefined,
      expires_at: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined
    };
  }

  private async parseResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    const payload = text ? safeJson(text) : null;
    if (!response.ok) {
      const details = payload && typeof payload === "object" ? JSON.stringify(payload) : text;
      throw new Error(`Google Ads API HTTP ${response.status}: ${redactErrorMessage(details || response.statusText)}`);
    }
    return payload ?? {};
  }

  private async parseAndCache(url: string, bodyText: string, response: Response): Promise<unknown> {
    try {
      const payload = await this.parseResponse(response);
      if (this.config.cacheEnabled && url.includes(":search")) {
        this.getCache().set("POST", url, payload, bodyText);
      }
      return payload;
    } catch (error) {
      if (this.config.cacheEnabled && url.includes(":search")) {
        const cached = this.getCache().get("POST", url, bodyText);
        if (cached !== undefined) return cached;
      }
      throw error;
    }
  }

  private getCache(): GoogleAdsCache {
    this.cache ??= new GoogleAdsCache(this.config.cachePath);
    return this.cache;
  }

  private fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    return fetchWithRetryMiddleware(fetch, url, init, {
      vendor: "google_ads",
      envFlag: "GOOGLE_ADS_NO_RETRY"
    });
  }

  private extractCode(input: string): string {
    try {
      const url = new URL(input);
      const code = url.searchParams.get("code");
      if (code) return code;
    } catch {
      // Not a URL; treat as raw code.
    }
    return input;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sanitize(customerId: string): string {
  const digits = String(customerId).replace(/[^\d]/g, "");
  if (!digits) throw new Error(`Invalid customer_id: ${customerId}`);
  return digits;
}
