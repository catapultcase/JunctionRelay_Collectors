// ============================================================================
// Protocol Constants
// ============================================================================

export const PROTOCOL_VERSION = '1.0.0';

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

export interface PluginManifest {
  type: 'collector';
  entry?: string;
}

export interface DiscoveredPlugin {
  name: string;
  version: string;
  path: string;
  entry: string;
  manifest: PluginManifest;
}
