export type ResponseFormat = "markdown" | "json";
export type PrivacyMode = "summary" | "structured" | "raw";

export interface GoogleAdsTokenSet {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type?: string;
  scope?: string;
}

export interface GoogleAdsConfig {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  loginCustomerId?: string;
  scopes: string[];
  tokenPath: string;
  privacyMode: PrivacyMode;
  allowMutations: boolean;
  cacheEnabled: boolean;
  cachePath: string;
}

export interface ToolResponse<T> extends Record<string, unknown> {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: T;
  isError?: boolean;
}

/**
 * Google Ads REST search response shape (googleAds:search).
 * `results` is the array of rows, each containing nested resource objects per
 * the GAQL SELECT clause.
 */
export interface GaqlSearchResponse {
  results?: Array<Record<string, unknown>>;
  nextPageToken?: string;
  totalResultsCount?: string;
  fieldMask?: string;
  summaryRow?: Record<string, unknown>;
}
