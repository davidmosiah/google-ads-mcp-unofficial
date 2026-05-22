import type { GoogleAdsConfig, PrivacyMode } from "../types.js";
import { redactCustomerId } from "./redaction.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function resolvePrivacyMode(config: GoogleAdsConfig, override?: PrivacyMode): PrivacyMode {
  return override ?? config.privacyMode;
}

/**
 * Apply privacy normalization to a Google Ads payload.
 *
 * - raw: pass-through (the upstream REST shape)
 * - structured: flatten known nested objects (campaign, ad_group, etc) into
 *   flat dicts, partial-redact customer ids, drop manager-only metadata
 * - summary: only id + label fields
 */
export function applyPrivacy(payload: unknown, mode: PrivacyMode): unknown {
  if (mode === "raw") return payload;
  if (Array.isArray(payload)) return payload.map((row) => applyPrivacy(row, mode));
  if (!isObject(payload)) return payload;

  // GAQL search row shape: { campaign: {...}, ad_group: {...}, metrics: {...} }
  // Flatten into a single dict for easier agent consumption.
  const flat: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (isObject(v) && !isResourceObject(v)) {
      for (const [sk, sv] of Object.entries(v)) {
        flat[`${k}.${sk}`] = privacyValue(sk, sv, mode);
      }
    } else {
      flat[k] = privacyValue(k, v, mode);
    }
  }
  if (mode === "summary") return summarize(flat);
  return flat;
}

function isResourceObject(value: Record<string, unknown>): boolean {
  // simple heuristic — leaf objects that look like primitives (size 1, value)
  return Object.keys(value).length === 0;
}

function privacyValue(key: string, value: unknown, mode: PrivacyMode): unknown {
  if (typeof value !== "string") return value;
  if (key.toLowerCase().includes("customer_id") || key === "id" && /^\d{7,}$/.test(value)) {
    return mode === "raw" ? value : redactCustomerId(value);
  }
  return value;
}

function summarize(flat: Record<string, unknown>): Record<string, unknown> {
  // Keep core identifiers + name + status; drop metrics in summary mode.
  const keep = new Set<string>();
  for (const key of Object.keys(flat)) {
    if (
      key.endsWith(".id") ||
      key.endsWith(".name") ||
      key.endsWith(".status") ||
      key.endsWith(".resource_name") ||
      key === "id" || key === "name" || key === "status" || key === "resource_name"
    ) {
      keep.add(key);
    }
  }
  return Object.fromEntries(Object.entries(flat).filter(([k]) => keep.has(k)));
}
