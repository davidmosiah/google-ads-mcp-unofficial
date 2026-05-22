import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const expectedTools = [
  // meta + diagnostic (5)
  'google_ads_agent_manifest',
  'google_ads_capabilities',
  'google_ads_connection_status',
  'google_ads_data_inventory',
  'google_ads_privacy_audit',
  // shared profile (3)
  'google_ads_onboarding',
  'google_ads_profile_get',
  'google_ads_profile_update',
  // auth (3)
  'google_ads_exchange_code',
  'google_ads_get_auth_url',
  'google_ads_revoke_access',
  // reads (8)
  'google_ads_get_account_performance',
  'google_ads_get_campaign',
  'google_ads_get_campaign_performance',
  'google_ads_get_keyword_performance',
  'google_ads_list_accounts',
  'google_ads_list_ad_groups',
  'google_ads_list_campaigns',
  'google_ads_list_keywords',
  // workflow (2)
  'google_ads_daily_report',
  'google_ads_find_waste',
  // mutations (6)
  'google_ads_pause_campaign',
  'google_ads_pause_keyword',
  'google_ads_resume_campaign',
  'google_ads_resume_keyword',
  'google_ads_set_campaign_budget_micros',
  'google_ads_set_keyword_bid_micros'
];

const client = new Client({ name: 'google-ads-mcp-smoke-test', version: '0.0.0' });
const homeDir = mkdtempSync(join(tmpdir(), 'google-ads-mcp-smoke-'));
const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
  env: {
    ...process.env,
    HOME: homeDir,
    GOOGLE_ADS_DEVELOPER_TOKEN: '',
    GOOGLE_ADS_CLIENT_ID: '',
    GOOGLE_ADS_CLIENT_SECRET: '',
    GOOGLE_ADS_TOKEN_PATH: join(homeDir, '.google-ads-mcp', 'tokens.json'),
    GOOGLE_ADS_CACHE_PATH: join(homeDir, '.google-ads-mcp', 'cache.sqlite'),
    GOOGLE_ADS_ALLOW_MUTATIONS: 'false'
  }
});

await client.connect(transport);
try {
  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, expectedTools.sort(),
    `Tool mismatch.\nExpected (${expectedTools.length}): ${expectedTools.sort().join(', ')}\nGot (${toolNames.length}): ${toolNames.join(', ')}`);

  // Tools that don't touch the API at all should work without credentials.
  const auditResult = await client.callTool({
    name: 'google_ads_privacy_audit',
    arguments: { response_format: 'json' }
  });
  assert.equal(auditResult.structuredContent?.unofficial, true);
  assert.equal(auditResult.structuredContent?.mutations_allowed, false);
  assert.ok(['env', 'local_config', 'mixed', 'missing'].includes(auditResult.structuredContent?.config_source));
  assert.ok(auditResult.structuredContent?.secret_env_vars?.includes('GOOGLE_ADS_DEVELOPER_TOKEN'));
  assert.ok(auditResult.structuredContent?.secret_env_vars?.includes('GOOGLE_ADS_CLIENT_SECRET'));

  const capabilitiesResult = await client.callTool({
    name: 'google_ads_capabilities',
    arguments: { response_format: 'json' }
  });
  assert.equal(capabilitiesResult.structuredContent?.unofficial, true);
  assert.equal(capabilitiesResult.structuredContent?.mutation_model?.gated_by_env, 'GOOGLE_ADS_ALLOW_MUTATIONS');
  assert.ok(capabilitiesResult.structuredContent?.api_boundary?.does_not_include?.length > 0);

  const inventoryResult = await client.callTool({ name: 'google_ads_data_inventory', arguments: { response_format: 'json' } });
  assert.equal(inventoryResult.structuredContent?.kind, 'data_inventory');

  const manifestResult = await client.callTool({
    name: 'google_ads_agent_manifest',
    arguments: { client: 'hermes', response_format: 'json' }
  });
  assert.equal(manifestResult.structuredContent?.client, 'hermes');
  assert.ok(manifestResult.structuredContent?.hermes?.common_tool_names?.includes('mcp_google_ads_google_ads_connection_status'));
  assert.equal(manifestResult.structuredContent?.mutation_gate?.env_flag, 'GOOGLE_ADS_ALLOW_MUTATIONS');
  assert.equal(manifestResult.structuredContent?.mutation_gate?.default, false);

  const statusResult = await client.callTool({
    name: 'google_ads_connection_status',
    arguments: { client: 'hermes', response_format: 'json' }
  });
  assert.equal(statusResult.structuredContent?.ok, false);
  assert.ok(statusResult.structuredContent?.missing_env?.includes('GOOGLE_ADS_DEVELOPER_TOKEN'));
  assert.equal(statusResult.structuredContent?.client, 'hermes');
  assert.equal(statusResult.structuredContent?.mutations_allowed, false);
  assert.ok(statusResult.structuredContent?.client_checks?.hermes?.recommendations?.some((step) => step.includes('/reload-mcp')));

  // Mutation tool with mutations disabled should fail with an actionable error.
  const muteResult = await client.callTool({
    name: 'google_ads_pause_keyword',
    arguments: {
      customer_id: '1234567890',
      ad_group_id: '111',
      criterion_id: '222',
      explicit_user_intent: true,
      response_format: 'json'
    }
  });
  assert.equal(muteResult.isError, true, 'pause_keyword must error when mutations disabled');
  assert.ok(/GOOGLE_ADS_ALLOW_MUTATIONS/.test(muteResult.content[0].text), 'error must mention the gate env var');

  console.log(JSON.stringify({ ok: true, tools: toolNames.length }, null, 2));
} finally {
  await client.close();
}
