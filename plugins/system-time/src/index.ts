import { CollectorPlugin } from '@junctionrelay/collector-sdk';
import type { SensorResult } from '@junctionrelay/collector-sdk';

new CollectorPlugin({
  metadata: {
    collectorName: 'SystemTime',
    displayName: 'System Time',
    description: 'Local system date and time',
    category: 'System & Testing',
    emoji: '🕐',
    fields: {
      requiresUrl: false,
      requiresAccessToken: false,
    },
    defaults: {
      name: 'System Time',
      pollRate: 5000,
      sendRate: 5000,
    },
    setupInstructions: [
      {
        title: 'No configuration needed',
        body: 'This collector reads the local system clock. No URL or credentials required. Provides both UTC and local time formats with timezone detection.',
      },
    ],
  },

  async fetchSensors() {
    const now = new Date();
    const utcIso = now.toISOString();
    const utcTimestamp = String(Math.floor(now.getTime() / 1000));
    const utcReadable = now.toUTCString();
    const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .replace('Z', '');
    const localReadable = now.toString();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const sensors: SensorResult[] = [
      {
        uniqueSensorKey: 'system_utc_time_iso',
        name: 'System UTC Time (ISO 8601)',
        value: utcIso,
        unit: 'UTC',
        category: 'System',
        decimalPlaces: 0,
        sensorType: 'DateTime',
        componentName: 'SystemTime',
        sensorTag: 'Time',
      },
      {
        uniqueSensorKey: 'system_utc_timestamp',
        name: 'System UTC Timestamp',
        value: utcTimestamp,
        unit: 'seconds',
        category: 'System',
        decimalPlaces: 0,
        sensorType: 'Numeric',
        componentName: 'SystemTime',
        sensorTag: 'Timestamp',
      },
      {
        uniqueSensorKey: 'system_utc_time_readable',
        name: 'System UTC Time (Readable)',
        value: utcReadable,
        unit: 'UTC',
        category: 'System',
        decimalPlaces: 0,
        sensorType: 'Text',
        componentName: 'SystemTime',
        sensorTag: 'Time',
      },
      {
        uniqueSensorKey: 'system_local_time_iso',
        name: 'System Local Time (ISO 8601)',
        value: localIso,
        unit: 'Local',
        category: 'System',
        decimalPlaces: 0,
        sensorType: 'DateTime',
        componentName: 'SystemTime',
        sensorTag: 'Time',
      },
      {
        uniqueSensorKey: 'system_local_time_readable',
        name: 'System Local Time (Readable)',
        value: localReadable,
        unit: 'Local',
        category: 'System',
        decimalPlaces: 0,
        sensorType: 'Text',
        componentName: 'SystemTime',
        sensorTag: 'Time',
      },
      {
        uniqueSensorKey: 'system_timezone',
        name: 'System Timezone',
        value: timezone,
        unit: 'Zone',
        category: 'System',
        decimalPlaces: 0,
        sensorType: 'Text',
        componentName: 'SystemTime',
        sensorTag: 'TimeZone',
      },
    ];

    return { sensors };
  },

  async testConnection() {
    return { success: true };
  },
});
