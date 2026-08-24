import assert from 'node:assert/strict';

import { GOOGLE_ADS_API_BASE_URL, GOOGLE_ADS_API_VERSION } from '../dist/constants.js';
import { buildCapabilities } from '../dist/services/capabilities.js';

assert.equal(GOOGLE_ADS_API_VERSION, 'v25', 'runtime must target the current supported Google Ads API major version');
assert.equal(GOOGLE_ADS_API_BASE_URL, 'https://googleads.googleapis.com/v25');
assert.equal(buildCapabilities().api_boundary.source, 'Official Google Ads REST API v25');

console.log('api-version-test: ok');
