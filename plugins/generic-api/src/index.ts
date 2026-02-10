import { CollectorPlugin, getDecimalPlaces } from '@junctionrelay/collector-sdk';
import type { SensorResult, ConfigureParams } from '@junctionrelay/collector-sdk';

let apiUrl = '';
let accessToken = '';

function determineUnit(key: string, value: unknown): string {
  const k = key.toLowerCase();
  if (k.includes('uptime') && k.includes('minutes')) return 'minutes';
  if (k.includes('timestamp') && typeof value === 'number') return 'unix';
  if (k.includes('hours')) return 'hours';
  if (k.includes('days')) return 'days';
  if (k.includes('revenue') || k.includes('payment')) return 'currency';
  if (k.includes('rate') || k.includes('ratio')) return 'percentage';
  if (k.includes('count') || k.includes('total') || k.includes('users') ||
      k.includes('devices') || k.includes('subscriptions') || k.includes('entries')) return 'count';
  if (k.includes('memory') || k.includes('size')) return 'bytes';
  if (typeof value === 'string') return 'text';
  if (k.includes('environment') || k.includes('version')) return 'text';
  return 'value';
}

function determineCategory(key: string): string {
  const k = key.toLowerCase();
  if (k.startsWith('system_')) return 'System';
  if (k.startsWith('cache_')) return 'Cache';
  if (k.startsWith('db_')) return 'Database';
  if (k.startsWith('financial_') || k.startsWith('revenue_')) return 'Financial';
  if (k.startsWith('growth_')) return 'Growth';
  if (k.startsWith('refresh_token_')) return 'Tokens';
  if (k.startsWith('collector_')) return 'Metadata';
  return 'API Data';
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value);
    const formatted = value.toFixed(6);
    return formatted.replace(/0+$/, '').replace(/\.$/, '');
  }
  return String(value);
}

new CollectorPlugin({
  metadata: {
    collectorName: 'GenericAPI',
    displayName: 'Generic API',
    description: 'Process JSON via AccessToken',
    category: 'System & Testing',
    emoji: '🔌',
    fields: {
      requiresUrl: true,
      requiresAccessToken: true,
      urlLabel: 'Generic API URL',
      urlPlaceholder: 'https://api.example.com',
      accessTokenLabel: 'Generic API Access Token',
      accessTokenPlaceholder: 'gapi_...',
    },
    defaults: {
      name: 'GenericAPI',
      url: 'https://api.example.com',
      pollRate: 60000,
      sendRate: 5000,
    },
    setupInstructions: [
      {
        title: 'API Endpoint URL',
        body: 'Enter the full URL to your JSON API endpoint. Must return JSON with `{ "success": true, "data": { ... } }` structure.',
      },
      {
        title: 'Access Token',
        body: 'API authentication token (if required). Sent as `X-Collector-Token` header. Leave blank if API does not require authentication.',
      },
      {
        title: 'Expected Response Format',
        body: '```json\n{"success": true, "data": {"metric1": 123, "metric2": "value"}}\n```\nEach key-value pair in the `data` object becomes an individual sensor with smart categorization and unit detection.',
      },
    ],
  },

  async configure(params: ConfigureParams) {
    const url = (params.url ?? '').trim();
    apiUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    accessToken = params.accessToken ?? '';
    return { success: true };
  },

  async testConnection() {
    if (!apiUrl) {
      return { success: false, error: 'No URL configured' };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch(apiUrl, {
        headers: { 'X-Collector-Token': accessToken },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        return { success: false, error: `HTTP ${resp.status}: ${resp.statusText}` };
      }

      const data = await resp.json() as { success?: boolean };
      if (!data.success) {
        return { success: false, error: 'API response did not contain success: true' };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async fetchSensors() {
    if (!apiUrl) throw new Error('Not configured — call configure first');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const resp = await fetch(apiUrl, {
      headers: { 'X-Collector-Token': accessToken },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }

    const json = await resp.json() as { success?: boolean; data?: Record<string, unknown> };
    if (!json.success || !json.data) {
      throw new Error('API response missing success or data fields');
    }

    const sensors: SensorResult[] = [];

    for (const [key, value] of Object.entries(json.data)) {
      // Skip complex objects
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        continue;
      }

      let sensorKey = key;
      let sensorValue: string;

      if (Array.isArray(value)) {
        sensorKey = `${key}_count`;
        sensorValue = String(value.length);
      } else {
        sensorValue = formatValue(value);
      }

      const uniqueSensorKey = sensorKey.toLowerCase().replace(/\s+/g, '_');
      const category = determineCategory(key);

      sensors.push({
        uniqueSensorKey,
        name: key,
        value: sensorValue,
        unit: determineUnit(key, value),
        category,
        decimalPlaces: getDecimalPlaces(sensorValue),
        sensorType: 'API',
        componentName: category,
        sensorTag: key,
      });
    }

    return { sensors };
  },
});
