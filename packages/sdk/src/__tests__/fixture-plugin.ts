import { CollectorPlugin } from '../CollectorPlugin.js';
import type { ConfigureParams, FetchSensorsResult } from '@junctionrelay/collector-protocol';

new CollectorPlugin({
  metadata: {
    collectorName: 'TestPlugin',
    displayName: 'Test Plugin',
    description: 'A test fixture plugin',
    category: 'Test',
    emoji: '🧪',
    fields: {
      requiresUrl: false,
      requiresAccessToken: false,
    },
    defaults: {
      name: 'Test Plugin',
      pollRate: 1000,
      sendRate: 1000,
    },
    setupInstructions: [],
  },

  async fetchSensors(_config: ConfigureParams): Promise<FetchSensorsResult> {
    return {
      sensors: [
        {
          externalId: 'test_sensor_1',
          name: 'Test Sensor 1',
          value: '42',
          unit: 'units',
          category: 'Test',
          decimalPlaces: 0,
          sensorType: 'Test',
          componentName: 'test-component',
          sensorTag: 'test_1',
        },
        {
          externalId: 'test_sensor_2',
          name: 'Test Sensor 2',
          value: '3.14',
          unit: 'units',
          category: 'Test',
          decimalPlaces: 2,
          sensorType: 'Test',
          componentName: 'test-component',
          sensorTag: 'test_2',
        },
      ],
    };
  },
});
