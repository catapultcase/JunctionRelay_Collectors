import { CollectorPlugin } from '@junctionrelay/collector-sdk';
import type { CollectorPluginConfig } from '@junctionrelay/collector-sdk';

const config: CollectorPluginConfig = {
  metadata: {
    collectorName: 'HostTestPlugin',
    displayName: 'Host Test Plugin',
    description: 'A test fixture for PluginHost tests',
    category: 'Test',
    emoji: '🧪',
    fields: {
      requiresUrl: false,
      requiresAccessToken: false,
    },
    defaults: {
      name: 'Host Test Plugin',
      pollRate: 1000,
      sendRate: 1000,
    },
    setupInstructions: [],
  },

  async fetchSensors() {
    return {
      sensors: [
        {
          uniqueSensorKey: 'host_test_1',
          name: 'Host Test Sensor',
          value: '100',
          unit: 'units',
          category: 'Test',
          decimalPlaces: 0,
          sensorType: 'Test',
          componentName: 'test-component',
          sensorTag: 'host_test_1',
        },
      ],
    };
  },
};

// Export for in-process loading (XSD)
export default config;

// Start RPC when run as a process (via npx tsx or rpc-host.mjs)
const plugin = new CollectorPlugin(config);
plugin.startRpc();
