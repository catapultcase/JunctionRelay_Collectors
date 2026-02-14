import type { CollectorPluginConfig, SensorResult } from '@junctionrelay/collector-sdk';

const CACHE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
const REQUEST_TIMEOUT_MS = 10000;
const USER_AGENT = 'JunctionRelay/1.0';

let cachedTime: Date | null = null;
let cachedAt: number | null = null;
let isConnected = false;

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function tryWorldTimeAPI(): Promise<Date | null> {
  try {
    const resp = await fetchWithTimeout('https://worldtimeapi.org/api/timezone/UTC', {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { utc_datetime?: string };
    if (data.utc_datetime) return new Date(data.utc_datetime);
    return null;
  } catch {
    return null;
  }
}

async function tryTimeAPI(): Promise<Date | null> {
  try {
    const resp = await fetchWithTimeout(
      'https://timeapi.io/api/Time/current/zone?timeZone=UTC',
      { headers: { 'User-Agent': USER_AGENT } },
    );
    if (!resp.ok) return null;
    const data = await resp.json() as {
      year?: number; month?: number; day?: number;
      hour?: number; minute?: number; seconds?: number;
    };
    if (data.year != null) {
      return new Date(Date.UTC(
        data.year, (data.month ?? 1) - 1, data.day ?? 1,
        data.hour ?? 0, data.minute ?? 0, data.seconds ?? 0,
      ));
    }
    return null;
  } catch {
    return null;
  }
}

async function tryGoogleDateHeader(): Promise<Date | null> {
  try {
    const resp = await fetchWithTimeout('https://www.google.com', {
      method: 'HEAD',
      headers: { 'User-Agent': USER_AGENT },
    });
    const dateHeader = resp.headers.get('date');
    if (dateHeader) return new Date(dateHeader);
    return null;
  } catch {
    return null;
  }
}

async function tryWorldClockAPI(): Promise<Date | null> {
  try {
    const resp = await fetchWithTimeout('http://worldclockapi.com/api/json/utc/now', {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { currentDateTime?: string };
    if (data.currentDateTime) return new Date(data.currentDateTime);
    return null;
  } catch {
    return null;
  }
}

async function getUtcTimeFromInternet(): Promise<{ time: Date; source: string }> {
  // Try each API in order
  const apis: Array<[() => Promise<Date | null>, string]> = [
    [tryWorldTimeAPI, 'WorldTimeAPI'],
    [tryTimeAPI, 'TimeAPI'],
    [tryGoogleDateHeader, 'Google'],
    [tryWorldClockAPI, 'WorldClockAPI'],
  ];

  for (const [fn] of apis) {
    const result = await fn();
    if (result) {
      cachedTime = result;
      cachedAt = Date.now();
      isConnected = true;
      return { time: result, source: 'Internet' };
    }
  }

  // All APIs failed — try cache
  if (cachedTime && cachedAt && (Date.now() - cachedAt) < CACHE_MAX_AGE_MS) {
    const elapsed = Date.now() - cachedAt;
    const adjustedTime = new Date(cachedTime.getTime() + elapsed);
    isConnected = false;
    return { time: adjustedTime, source: 'Cached' };
  }

  isConnected = false;
  throw new Error('All time APIs failed and no valid cache available');
}

export default {
  metadata: {
    collectorName: 'junctionrelay.internet-time',
    displayName: 'Internet Time',
    description: 'Accurate time from internet sources',
    category: 'System & Testing',
    emoji: '🌐',
    fields: {
      requiresUrl: false,
      requiresAccessToken: false,
    },
    defaults: {
      name: 'Internet Time',
      pollRate: 5000,
      sendRate: 5000,
    },
    setupInstructions: [
      {
        title: 'No configuration needed',
        body: 'Automatically fetches accurate UTC time from multiple internet sources with smart caching and failover. Requires network connectivity.',
      },
    ],
  },

  async fetchSensors() {
    const { time, source } = await getUtcTimeFromInternet();

    const sensors: SensorResult[] = [
      {
        uniqueSensorKey: 'internet_utc_time_iso',
        name: 'Internet UTC Time (ISO 8601)',
        value: time.toISOString(),
        unit: 'UTC',
        category: 'Network',
        decimalPlaces: 0,
        sensorType: 'DateTime',
        componentName: 'InternetTime',
        sensorTag: 'Time',
      },
      {
        uniqueSensorKey: 'internet_utc_timestamp',
        name: 'Internet UTC Timestamp',
        value: String(Math.floor(time.getTime() / 1000)),
        unit: 'seconds',
        category: 'Network',
        decimalPlaces: 0,
        sensorType: 'Numeric',
        componentName: 'InternetTime',
        sensorTag: 'Timestamp',
      },
      {
        uniqueSensorKey: 'internet_utc_time_readable',
        name: 'Internet UTC Time (Readable)',
        value: time.toUTCString(),
        unit: 'UTC',
        category: 'Network',
        decimalPlaces: 0,
        sensorType: 'Text',
        componentName: 'InternetTime',
        sensorTag: 'Time',
      },
      {
        uniqueSensorKey: 'internet_time_source',
        name: 'Time Source',
        value: source,
        unit: 'Source',
        category: 'Network',
        decimalPlaces: 0,
        sensorType: 'Text',
        componentName: 'InternetTime',
        sensorTag: 'Source',
      },
      {
        uniqueSensorKey: 'internet_time_sync_status',
        name: 'Time Sync Status',
        value: isConnected ? 'Connected' : 'Disconnected',
        unit: 'Status',
        category: 'Network',
        decimalPlaces: 0,
        sensorType: 'Text',
        componentName: 'InternetTime',
        sensorTag: 'Status',
      },
    ];

    return { sensors };
  },

  async testConnection() {
    const result = await tryWorldTimeAPI();
    if (result) {
      return { success: true };
    }
    return { success: false, error: 'Unable to reach time APIs' };
  },
} satisfies CollectorPluginConfig;
