// CollectorPlugin is exported for rpc-host.mjs (Server child-process mode).
// Plugin authors should NOT instantiate it — just `export default { metadata, ... } satisfies CollectorPluginConfig`.
export { CollectorPlugin } from './CollectorPlugin.js';
export type { CollectorPluginConfig } from './CollectorPlugin.js';
export { getDecimalPlaces, sanitizeSensorValue, sanitizeDecimalPlaces, safeRound } from './helpers.js';
export * from '@junctionrelay/collector-protocol';
