// Quick-wins helper + schema tests — no live API.
//
// Coverage:
//   1. buildDateRangeClause maps 7/14/30/90/1 → DURING LAST_*; others → BETWEEN
//   2. buildQuickWinCandidate maps a GAQL row into the candidate shape with the
//      correct recommended_bid_micros math (current bid + 25% capped at 2x)
//   3. QuickWinsInputSchema enforces customer_id, min_ctr range, max_avg_cpc_micros >= 0
//   4. Default values match the spec (lookback=30, min_ctr=5, max_avg_cpc=100_000, etc.)

import assert from 'node:assert/strict';
import { buildDateRangeClause, buildQuickWinCandidate } from '../dist/tools/google-ads-tools.js';
import { QuickWinsInputSchema } from '../dist/schemas/common.js';

// Case 1: buildDateRangeClause
assert.equal(buildDateRangeClause(7), 'segments.date DURING LAST_7_DAYS');
assert.equal(buildDateRangeClause(14), 'segments.date DURING LAST_14_DAYS');
assert.equal(buildDateRangeClause(30), 'segments.date DURING LAST_30_DAYS');
assert.equal(buildDateRangeClause(90), 'segments.date DURING LAST_90_DAYS');
assert.equal(buildDateRangeClause(1), 'segments.date DURING YESTERDAY');

// Non-standard lookback → BETWEEN clause (45 days ending yesterday, fixed clock).
// Use a fixed millisecond clock so the test is timezone-agnostic.
const fixedMs = Date.UTC(2026, 4, 23, 12, 0, 0); // 2026-05-23 UTC noon
const clause = buildDateRangeClause(45, fixedMs);
assert.match(clause, /^segments\.date BETWEEN '\d{4}-\d{2}-\d{2}' AND '\d{4}-\d{2}-\d{2}'$/, 'BETWEEN form for non-standard ranges');
// End = 2026-05-22 (yesterday); start = 2026-05-22 - 44 days = 2026-04-08
assert.ok(clause.includes("'2026-05-22'"), `expected end 2026-05-22, got: ${clause}`);
assert.ok(clause.includes("'2026-04-08'"), `expected start 2026-04-08, got: ${clause}`);

// Case 2: buildQuickWinCandidate math
const row = {
  ad_group_criterion: {
    criterion_id: '12345',
    keyword: { text: 'cheap widgets', match_type: 'EXACT' },
    effective_cpc_bid_micros: '40000' // $0.04 current bid
  },
  ad_group: { id: '999' },
  campaign: { id: '777' },
  metrics: {
    average_cpc: '35000', // $0.035 actual avg CPC
    ctr: 0.12, // 12% CTR
    conversions: 3.5
  }
};
const candidate = buildQuickWinCandidate(row);
assert.equal(candidate.criterion_id, '12345');
assert.equal(candidate.ad_group_id, '999');
assert.equal(candidate.campaign_id, '777');
assert.equal(candidate.keyword_text, 'cheap widgets');
assert.equal(candidate.match_type, 'EXACT');
assert.equal(candidate.current_avg_cpc_micros, 35000);
assert.equal(candidate.current_cpc_bid_micros, 40000);
assert.equal(candidate.ctr_pct, 12.00, 'ctr_pct rounded to 2 decimals from 0.12 ratio');
assert.equal(candidate.conversions, 3.5);
// 40000 * 1.25 = 50000; 40000 * 2 = 80000; min(50000, 80000) = 50000
assert.equal(candidate.recommended_bid_micros, 50000, 'recommended = current + 25% (within 2x cap)');
assert.match(candidate.reason, /CTR 12\.00%/);
assert.match(candidate.reason, /3\.5 conversions/);

// Case 2b: recommended capped at 2x when 1.25x would exceed it (shouldn't —
// 1.25x is always within 2x — but verify the floor behavior on edge case).
const edge = buildQuickWinCandidate({
  ad_group_criterion: { criterion_id: '1', keyword: { text: 'x', match_type: 'BROAD' }, effective_cpc_bid_micros: '8' },
  ad_group: { id: '1' }, campaign: { id: '1' },
  metrics: { average_cpc: '5', ctr: 0.06, conversions: 1 }
});
// 8 * 1.25 = 10; 8 * 2 = 16; min(10, 16) = 10
assert.equal(edge.recommended_bid_micros, 10);

// Case 2c: missing bid → recommended null
const noBid = buildQuickWinCandidate({
  ad_group_criterion: { criterion_id: '2', keyword: { text: 'y', match_type: 'PHRASE' } },
  ad_group: { id: '2' }, campaign: { id: '2' },
  metrics: { average_cpc: undefined, ctr: 0.07, conversions: 1 }
});
assert.equal(noBid.recommended_bid_micros, null, 'recommended null when no base bid');
assert.equal(noBid.current_avg_cpc_micros, null);
assert.equal(noBid.current_cpc_bid_micros, null);

// Case 3: QuickWinsInputSchema validation
const happy = QuickWinsInputSchema.parse({ customer_id: '1234567890' });
assert.equal(happy.lookback_days, 30);
assert.equal(happy.min_ctr, 5);
assert.equal(happy.max_avg_cpc_micros, 100_000);
assert.equal(happy.min_conversions, 0.5);
assert.equal(happy.limit, 50);
assert.equal(happy.response_format, 'markdown');

const tighten = QuickWinsInputSchema.parse({
  customer_id: '1234567890', lookback_days: 7, min_ctr: 10, max_avg_cpc_micros: 50_000,
  min_conversions: 2, limit: 25, response_format: 'json'
});
assert.equal(tighten.lookback_days, 7);
assert.equal(tighten.response_format, 'json');

// Required customer_id
assert.throws(() => QuickWinsInputSchema.parse({}), /customer_id|required/i, 'customer_id required');
// lookback_days bounds
assert.throws(() => QuickWinsInputSchema.parse({ customer_id: '1234567890', lookback_days: 0 }));
assert.throws(() => QuickWinsInputSchema.parse({ customer_id: '1234567890', lookback_days: 91 }));
// min_ctr bounds
assert.throws(() => QuickWinsInputSchema.parse({ customer_id: '1234567890', min_ctr: -1 }));
assert.throws(() => QuickWinsInputSchema.parse({ customer_id: '1234567890', min_ctr: 101 }));
// limit bounds
assert.throws(() => QuickWinsInputSchema.parse({ customer_id: '1234567890', limit: 0 }));
assert.throws(() => QuickWinsInputSchema.parse({ customer_id: '1234567890', limit: 201 }));

console.log(JSON.stringify({ ok: true, suite: 'quick-wins' }, null, 2));
