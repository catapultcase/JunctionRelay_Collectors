// ============================================================================
// Protocol Constants
// ============================================================================

export const PROTOCOL_VERSION = '1.0.0';

/**
 * Regex for validating namespaced plugin identifiers.
 * Format: `<namespace>.<name>` — both segments lowercase kebab-case.
 * Examples: `junctionrelay.system-time`, `catapultcase.my-collector`
 *
 * Native/built-in collector types (Cloudflare, Host, HWiNFO, etc.) do NOT
 * use this pattern — they remain un-namespaced. Only plugin collector types
 * require the dot-separated namespace.
 */
export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Returns true if the given collector name is a plugin (has a dot namespace).
 * Native built-in types like 'Cloudflare', 'Host', 'HWiNFO' return false.
 */
export function isPluginCollectorName(id: string): boolean {
  return id.includes('.');
}

export const MAX_DECIMAL_PLACES = 15;

export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SERVER_ERROR: -32000,
} as const;

// ============================================================================
// JSON-RPC 2.0 Message Types
// ============================================================================

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: Record<string, unknown>;
  id: number | string;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ============================================================================
// Collector Metadata — returned by getMetadata
// ============================================================================

export interface CollectorFieldRequirements {
  requiresUrl: boolean;
  requiresAccessToken: boolean;
  urlLabel?: string;
  urlPlaceholder?: string;
  accessTokenLabel?: string;
  accessTokenPlaceholder?: string;
  urlValidationPattern?: string | null;
  accessTokenValidationPattern?: string | null;
}

export interface CollectorDefaults {
  name: string;
  url?: string;
  pollRate?: number;
  sendRate?: number;
}

export interface SetupStep {
  title: string;
  body: string;
}

export interface CollectorMetadata {
  /**
   * Unique collector identifier. Plugin collectors must use namespaced
   * dot-notation matching PLUGIN_ID_PATTERN (e.g. 'junctionrelay.system-time').
   * Native built-in collectors use un-namespaced PascalCase names.
   */
  collectorName: string;
  displayName: string;
  description: string;
  category: string;
  emoji: string;
  fields: CollectorFieldRequirements;
  defaults: CollectorDefaults;
  setupInstructions: SetupStep[];
  setupNote?: string | null;
  supportsPersistentSession?: boolean;
  requiresService?: boolean;
  requiredServiceType?: string | null;
}

// ============================================================================
// Method Params & Results
// ============================================================================

export interface ConfigureParams {
  collectorId: number;
  url?: string;
  accessToken?: string;
  decimalPlaces?: number;
}

export interface SensorResult {
  uniqueSensorKey: string;
  name: string;
  value: string;
  unit: string;
  category: string;
  decimalPlaces: number;
  sensorType: string;
  componentName: string;
  sensorTag: string;
}

export interface FetchSelectedSensorsParams {
  sensorIds: string[];
}

export interface FetchSensorsResult {
  sensors: SensorResult[];
}

export interface TestConnectionResult {
  success: boolean;
  error?: string;
}

export interface HealthCheckResult {
  healthy: boolean;
  uptime: number;
}

export interface ConfigureResult {
  success: boolean;
}

export interface SessionResult {
  success: boolean;
}

// ============================================================================
// Method name constants
// ============================================================================

export type CollectorMethod =
  | 'getMetadata'
  | 'configure'
  | 'testConnection'
  | 'fetchSensors'
  | 'fetchSelectedSensors'
  | 'startSession'
  | 'stopSession'
  | 'healthCheck';

// ============================================================================
// Plugin Manifest & Discovery
// ============================================================================

export interface CollectorPluginManifest {
  type: 'collector';
  entry: string;
  collectorName: string;
  displayName: string;
  description: string;
  category: string;
  emoji: string;
  fields: CollectorFieldRequirements;
  defaults: CollectorDefaults;
  setupInstructions: SetupStep[];
  setupNote?: string | null;
  supportsPersistentSession?: boolean;
  requiresService?: boolean;
  requiredServiceType?: string | null;
}

export interface DiscoveredPlugin {
  name: string;
  version: string;
  path: string;
  entry: string;
  manifest: CollectorPluginManifest;
}
