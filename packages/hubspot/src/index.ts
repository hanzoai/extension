// @hanzo/hubspot — public surface. The pure, host-agnostic core that the
// HubSpot serverless function and card compose: config, the Hanzo call over a
// CRM record (built on the published @hanzo/ai), the HubSpot CRM API request
// shaping, engagement write-back, OAuth token exchange, and record→context
// assembly. No I/O lives here — every export is unit-tested without a network.

export * from './config.js';
export * from './hanzo.js';
export * from './oauth.js';
export * from './record.js';
export * from './api/hubspot-api.js';
export * from './api/write-back.js';
