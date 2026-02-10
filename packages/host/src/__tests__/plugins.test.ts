import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginHost } from '../PluginHost.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginsRoot = path.resolve(__dirname, '../../../../plugins');

describe('plugin-system-time', () => {
  let host: PluginHost;

  after(async () => {
    if (host?.isRunning) await host.stop();
  });

  it('returns correct metadata', async () => {
    host = new PluginHost(path.join(pluginsRoot, 'system-time'), { timeout: 15000 });
    await host.start();

    const metadata = await host.getMetadata();
    assert.equal(metadata.collectorName, 'SystemTime');
    assert.equal(metadata.displayName, 'System Time');
    assert.equal(metadata.emoji, '🕐');
    assert.equal(metadata.category, 'System & Testing');
    assert.equal(metadata.fields.requiresUrl, false);
    assert.equal(metadata.fields.requiresAccessToken, false);
  });

  it('configures successfully', async () => {
    const result = await host.configure({ collectorId: 1 });
    assert.deepEqual(result, { success: true });
  });

  it('returns 6 sensors with correct uniqueSensorKeys', async () => {
    const result = await host.fetchSensors();
    assert.equal(result.sensors.length, 6);

    const ids = result.sensors.map(s => s.uniqueSensorKey);
    assert.ok(ids.includes('system_utc_time_iso'));
    assert.ok(ids.includes('system_utc_timestamp'));
    assert.ok(ids.includes('system_utc_time_readable'));
    assert.ok(ids.includes('system_local_time_iso'));
    assert.ok(ids.includes('system_local_time_readable'));
    assert.ok(ids.includes('system_timezone'));

    // Verify sensor properties
    const utcIso = result.sensors.find(s => s.uniqueSensorKey === 'system_utc_time_iso')!;
    assert.equal(utcIso.sensorType, 'DateTime');
    assert.equal(utcIso.componentName, 'SystemTime');
    assert.equal(utcIso.category, 'System');
    assert.equal(utcIso.unit, 'UTC');

    const timestamp = result.sensors.find(s => s.uniqueSensorKey === 'system_utc_timestamp')!;
    assert.equal(timestamp.sensorType, 'Numeric');
    assert.equal(timestamp.unit, 'seconds');
    assert.ok(Number(timestamp.value) > 0);

    const timezone = result.sensors.find(s => s.uniqueSensorKey === 'system_timezone')!;
    assert.equal(timezone.sensorType, 'Text');
    assert.ok(timezone.value.length > 0);
  });

  it('passes health check', async () => {
    const result = await host.healthCheck();
    assert.equal(result.healthy, true);
  });

  it('stops cleanly', async () => {
    await host.stop();
    assert.equal(host.isRunning, false);
  });
});

describe('plugin-internet-time', () => {
  let host: PluginHost;

  after(async () => {
    if (host?.isRunning) await host.stop();
  });

  it('returns correct metadata', async () => {
    host = new PluginHost(path.join(pluginsRoot, 'internet-time'), { timeout: 15000 });
    await host.start();

    const metadata = await host.getMetadata();
    assert.equal(metadata.collectorName, 'InternetTime');
    assert.equal(metadata.displayName, 'Internet Time');
    assert.equal(metadata.emoji, '🌐');
    assert.equal(metadata.category, 'System & Testing');
    assert.equal(metadata.fields.requiresUrl, false);
    assert.equal(metadata.fields.requiresAccessToken, false);
  });

  it('configures successfully', async () => {
    const result = await host.configure({ collectorId: 2 });
    assert.deepEqual(result, { success: true });
  });

  it('returns 5 sensors with correct uniqueSensorKeys', async () => {
    const result = await host.fetchSensors();
    assert.equal(result.sensors.length, 5);

    const ids = result.sensors.map(s => s.uniqueSensorKey);
    assert.ok(ids.includes('internet_utc_time_iso'));
    assert.ok(ids.includes('internet_utc_timestamp'));
    assert.ok(ids.includes('internet_utc_time_readable'));
    assert.ok(ids.includes('internet_time_source'));
    assert.ok(ids.includes('internet_time_sync_status'));

    // Verify sensor properties
    const source = result.sensors.find(s => s.uniqueSensorKey === 'internet_time_source')!;
    assert.ok(['Internet', 'Cached'].includes(source.value));
    assert.equal(source.category, 'Network');
    assert.equal(source.componentName, 'InternetTime');
  });

  it('stops cleanly', async () => {
    await host.stop();
    assert.equal(host.isRunning, false);
  });
});

describe('plugin-generic-api', () => {
  let host: PluginHost;

  after(async () => {
    if (host?.isRunning) await host.stop();
  });

  it('returns correct metadata', async () => {
    host = new PluginHost(path.join(pluginsRoot, 'generic-api'), { timeout: 15000 });
    await host.start();

    const metadata = await host.getMetadata();
    assert.equal(metadata.collectorName, 'GenericAPI');
    assert.equal(metadata.displayName, 'Generic API');
    assert.equal(metadata.emoji, '🔌');
    assert.equal(metadata.fields.requiresUrl, true);
    assert.equal(metadata.fields.requiresAccessToken, true);
  });

  it('configures successfully', async () => {
    const result = await host.configure({ collectorId: 3 });
    assert.deepEqual(result, { success: true });
  });

  it('stops cleanly', async () => {
    await host.stop();
    assert.equal(host.isRunning, false);
  });
});

describe('plugin-home-assistant', () => {
  let host: PluginHost;

  after(async () => {
    if (host?.isRunning) await host.stop();
  });

  it('returns correct metadata', async () => {
    host = new PluginHost(path.join(pluginsRoot, 'home-assistant'), { timeout: 15000 });
    await host.start();

    const metadata = await host.getMetadata();
    assert.equal(metadata.collectorName, 'HomeAssistant');
    assert.equal(metadata.displayName, 'Home Assistant');
    assert.equal(metadata.emoji, '🏠');
    assert.equal(metadata.category, 'Home & IoT');
    assert.equal(metadata.fields.requiresUrl, true);
    assert.equal(metadata.fields.requiresAccessToken, true);
    assert.equal(metadata.fields.urlLabel, 'Home Assistant URL');
    assert.equal(metadata.fields.accessTokenLabel, 'Long-Lived Access Token');
  });

  it('configures successfully', async () => {
    const result = await host.configure({ collectorId: 4 });
    assert.deepEqual(result, { success: true });
  });

  it('stops cleanly', async () => {
    await host.stop();
    assert.equal(host.isRunning, false);
  });
});
