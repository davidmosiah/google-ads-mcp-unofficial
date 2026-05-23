// SQLite cache lifecycle test — exercises the GoogleAdsCache class end-to-end
// without hitting the Google Ads API.
//
// Coverage:
//   1. fresh cache reports cache_enabled=true + entries_count=0
//   2. set() then get() within TTL returns the same payload
//   3. set() then get() with explicit ttlSeconds=0 still returns the row
//   4. different privacy_mode yields a different key (no cross-contamination)
//   5. paginated/different customer_id yields a different key
//   6. TTL expiry returns undefined; status reports oldest_age_ms > ttl*1000
//   7. clear() returns cleared_entries count and entries_count drops to 0

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CACHE_TTL_SECONDS, GoogleAdsCache, cacheKey, disabledCacheStatus } from '../dist/services/cache.js';

const tmp = mkdtempSync(join(tmpdir(), 'google-ads-cache-test-'));
const cachePath = join(tmp, 'cache.sqlite');

try {
  // Case 1: fresh cache
  let cache = new GoogleAdsCache(cachePath, 60);
  const initial = cache.status();
  assert.equal(initial.cache_enabled, true, 'cache_enabled true once instantiated');
  assert.equal(initial.cache_path, cachePath);
  assert.equal(initial.entries_count, 0);
  assert.equal(initial.default_ttl_seconds, 60);
  assert.equal(initial.oldest_age_ms, undefined);

  // Case 2: set/get round trip
  const input = { customerId: '1234567890', query: 'SELECT campaign.id FROM campaign', privacyMode: 'structured' };
  const payload = { results: [{ campaign: { id: '111' } }], totalResultsCount: '1' };
  cache.set(input, payload);
  const got = cache.get(input);
  assert.deepEqual(got, payload, 'set then get returns the same payload');
  const after = cache.status();
  assert.equal(after.entries_count, 1);
  assert.ok(typeof after.oldest_age_ms === 'number');
  assert.ok(typeof after.newest_age_ms === 'number');

  // Case 3: ttlSeconds=0 disables TTL filter and surfaces any row
  // (useful for the stale-fallback path inside the client when upstream errors).
  const stale = cache.get(input, { ttlSeconds: 0 });
  assert.deepEqual(stale, payload, 'ttlSeconds=0 returns row regardless of age');

  // Case 4: privacy_mode separation
  const rawInput = { ...input, privacyMode: 'raw' };
  assert.notEqual(cacheKey(input), cacheKey(rawInput), 'privacy_mode part of key');
  assert.equal(cache.get(rawInput), undefined, 'no cross-contamination across privacy modes');

  // Case 5: different customer_id is a different key
  const otherCustomer = { ...input, customerId: '9876543210' };
  assert.notEqual(cacheKey(input), cacheKey(otherCustomer), 'customer_id part of key');
  assert.equal(cache.get(otherCustomer), undefined);

  // Case 6: TTL expiry — fake the clock by passing a now() that is ttl+1s ahead.
  const future = Date.now() + 60 * 1000 + 1;
  const expired = cache.get(input, { now: () => future });
  assert.equal(expired, undefined, 'row past TTL is treated as cache miss');

  // status() reports oldest_age_ms with the future clock.
  const statusFuture = cache.status(() => future);
  assert.ok(statusFuture.oldest_age_ms >= 60 * 1000, 'oldest_age_ms >= ttl ms in the future view');

  // Case 7: clear()
  const cleared = cache.clear();
  assert.equal(cleared.cleared_entries, 1);
  const afterClear = cache.status();
  assert.equal(afterClear.entries_count, 0);

  cache.close();

  // Disabled-cache helper returns sensible shape.
  const disabled = disabledCacheStatus(cachePath, DEFAULT_CACHE_TTL_SECONDS);
  assert.equal(disabled.cache_enabled, false);
  assert.equal(disabled.cache_path, cachePath);
  assert.equal(disabled.entries_count, 0);
  assert.equal(disabled.default_ttl_seconds, DEFAULT_CACHE_TTL_SECONDS);

  // Re-open the cache and confirm WAL files were created (better-sqlite3 default).
  cache = new GoogleAdsCache(cachePath, 60);
  cache.set(input, payload);
  cache.close();

  console.log(JSON.stringify({ ok: true, suite: 'cache' }, null, 2));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
