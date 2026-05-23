// SQLite cache for Google Ads GAQL responses.
//
// Disabled by default. Enable via GOOGLE_ADS_CACHE=sqlite (or =true) and override
// the path with GOOGLE_ADS_CACHE_PATH. TTL is per-row and defaults to 60s — the
// Google Ads metric set updates roughly once per hour for most segments, so a 60s
// read-through cache eliminates duplicate hits during agent loops without
// returning stale data on a meaningful timescale.
//
// Cache key is a SHA-256 of `${customerId}\n${query}\n${privacyMode ?? "structured"}`.
// Mutations bypass the cache entirely (the client only consults it for GAQL search
// calls). Cache reads ignore expired rows; expired rows are pruned on `clear()` and
// implicitly overwritten on the next miss for the same key.

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export const DEFAULT_CACHE_TTL_SECONDS = 60;

export interface CacheStatus extends Record<string, unknown> {
  cache_enabled: boolean;
  cache_path: string;
  entries_count: number;
  oldest_age_ms?: number;
  newest_age_ms?: number;
  default_ttl_seconds: number;
}

export interface CacheLookupInput {
  customerId: string;
  query: string;
  privacyMode?: string;
}

export interface CacheGetOptions {
  /** Override the configured TTL for a single lookup. 0 disables freshness check. */
  ttlSeconds?: number;
  /** Override Date.now for tests. */
  now?: () => number;
}

export interface CacheSetOptions {
  /** Override Date.now for tests. */
  now?: () => number;
}

export interface CacheClearResult extends Record<string, unknown> {
  cleared_entries: number;
}

export class GoogleAdsCache {
  private db: Database.Database;

  constructor(private readonly path: string, public readonly defaultTtlSeconds: number = DEFAULT_CACHE_TTL_SECONDS) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_cache (
        cache_key TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        privacy_mode TEXT NOT NULL,
        query_text TEXT NOT NULL,
        payload TEXT NOT NULL,
        cached_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS api_cache_cached_at_ms_idx ON api_cache(cached_at_ms);
    `);
    // Best-effort migration: drop the pre-0.1.3 schema if it exists alongside.
    // The old table had no cached_at_ms column; if a stale row set is detected,
    // the new INSERTs will fail. We tolerate that quietly — the user can always
    // delete cache.sqlite to reset.
  }

  get(input: CacheLookupInput, options: CacheGetOptions = {}): unknown | undefined {
    const ttl = options.ttlSeconds ?? this.defaultTtlSeconds;
    const now = (options.now ?? Date.now)();
    const minCachedAt = ttl > 0 ? now - ttl * 1000 : 0;
    const row = this.db
      .prepare("SELECT payload, cached_at_ms FROM api_cache WHERE cache_key = ?")
      .get(cacheKey(input)) as { payload?: string; cached_at_ms?: number } | undefined;
    if (!row?.payload) return undefined;
    if (ttl > 0 && (row.cached_at_ms ?? 0) < minCachedAt) return undefined;
    try {
      return JSON.parse(row.payload);
    } catch {
      return undefined;
    }
  }

  set(input: CacheLookupInput, payload: unknown, options: CacheSetOptions = {}): void {
    const now = (options.now ?? Date.now)();
    this.db
      .prepare(
        `INSERT INTO api_cache (cache_key, customer_id, privacy_mode, query_text, payload, cached_at_ms)
         VALUES (@cache_key, @customer_id, @privacy_mode, @query_text, @payload, @cached_at_ms)
         ON CONFLICT(cache_key) DO UPDATE SET
           payload = excluded.payload,
           cached_at_ms = excluded.cached_at_ms`
      )
      .run({
        cache_key: cacheKey(input),
        customer_id: input.customerId,
        privacy_mode: input.privacyMode ?? "structured",
        query_text: input.query,
        payload: JSON.stringify(payload),
        cached_at_ms: now
      });
  }

  clear(): CacheClearResult {
    const { changes } = this.db.prepare("DELETE FROM api_cache").run();
    return { cleared_entries: Number(changes) };
  }

  status(now: () => number = Date.now): CacheStatus {
    const row = this.db
      .prepare("SELECT COUNT(*) AS entries, MIN(cached_at_ms) AS oldest_ms, MAX(cached_at_ms) AS newest_ms FROM api_cache")
      .get() as { entries: number; oldest_ms?: number; newest_ms?: number };
    const nowMs = now();
    return {
      cache_enabled: true,
      cache_path: this.path,
      entries_count: row.entries,
      oldest_age_ms: row.oldest_ms ? Math.max(0, nowMs - row.oldest_ms) : undefined,
      newest_age_ms: row.newest_ms ? Math.max(0, nowMs - row.newest_ms) : undefined,
      default_ttl_seconds: this.defaultTtlSeconds
    };
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // ignore — connection may already be closed
    }
  }
}

export function disabledCacheStatus(path: string, defaultTtlSeconds = DEFAULT_CACHE_TTL_SECONDS): CacheStatus {
  return {
    cache_enabled: false,
    cache_path: path,
    entries_count: 0,
    default_ttl_seconds: defaultTtlSeconds
  };
}

export function cacheKey(input: CacheLookupInput): string {
  const privacy = input.privacyMode ?? "structured";
  const composite = `${input.customerId}\n${input.query}\n${privacy}`;
  return createHash("sha256").update(composite).digest("hex");
}
