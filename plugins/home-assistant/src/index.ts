import { CollectorPlugin, getDecimalPlaces } from '@junctionrelay/collector-sdk';
import type { SensorResult, ConfigureParams, FetchSelectedSensorsParams } from '@junctionrelay/collector-sdk';

let baseUrl = '';
let token = '';

interface HAEntity {
  entity_id: string;
  state: string;
  attributes?: {
    friendly_name?: string;
    unit_of_measurement?: string;
    [key: string]: unknown;
  };
}

async function fetchStates(): Promise<HAEntity[]> {
  const resp = await fetch(`${baseUrl}/api/states`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }

  return await resp.json() as HAEntity[];
}

function entityToSensor(entity: HAEntity): SensorResult {
  const friendlyName = entity.attributes?.friendly_name ?? entity.entity_id;
  const unit = entity.attributes?.unit_of_measurement ?? 'N/A';

  return {
    externalId: entity.entity_id,
    name: friendlyName,
    value: entity.state,
    unit,
    category: 'Home Assistant',
    decimalPlaces: getDecimalPlaces(entity.state),
    sensorType: 'API',
    componentName: entity.entity_id,
    sensorTag: friendlyName,
  };
}

new CollectorPlugin({
  metadata: {
    collectorName: 'HomeAssistant',
    displayName: 'Home Assistant',
    description: 'Smart home automation',
    category: 'Home & IoT',
    emoji: '🏠',
    fields: {
      requiresUrl: true,
      requiresAccessToken: true,
      urlLabel: 'Home Assistant URL',
      urlPlaceholder: 'http://192.168.1.100:8123',
      accessTokenLabel: 'Long-Lived Access Token',
      accessTokenPlaceholder: 'eyJ...',
    },
    defaults: {
      name: 'Home Assistant',
      url: 'http://192.168.1.100:8123',
      pollRate: 5000,
      sendRate: 5000,
    },
    setupInstructions: [
      {
        title: 'Home Assistant URL',
        body: 'Your Home Assistant instance URL (e.g., `http://192.168.1.100:8123`)',
      },
      {
        title: 'Create Long-Lived Access Token',
        body: 'Go to **Profile** (click your name) → **Security** → Scroll to "Long-lived access tokens" → Click **Create Token** → Copy the generated token',
      },
    ],
  },

  async configure(params: ConfigureParams) {
    const url = (params.url ?? '').trim();
    baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    token = params.accessToken ?? '';
    return { success: true };
  },

  async testConnection() {
    if (!baseUrl || !token) {
      return { success: false, error: 'URL and access token are required' };
    }

    try {
      const resp = await fetch(`${baseUrl}/api/`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (resp.ok) {
        return { success: true };
      }
      return { success: false, error: `HTTP ${resp.status}: ${resp.statusText}` };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async fetchSensors() {
    if (!baseUrl || !token) throw new Error('Not configured — call configure first');
    const entities = await fetchStates();
    const sensors = entities.map(entityToSensor);
    return { sensors };
  },

  async fetchSelectedSensors(config: ConfigureParams, params: FetchSelectedSensorsParams) {
    if (!baseUrl || !token) throw new Error('Not configured — call configure first');
    const entities = await fetchStates();
    const sensors = entities
      .filter(e => params.sensorIds.includes(e.entity_id))
      .map(entityToSensor);
    return { sensors };
  },
});
