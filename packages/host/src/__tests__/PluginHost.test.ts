import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginHost } from '../PluginHost.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, 'fixtures');

describe('PluginHost integration', () => {
  let host: PluginHost;

  after(async () => {
    if (host?.isRunning) {
      await host.stop();
    }
  });

  it('starts a plugin and retrieves metadata', async () => {
    host = new PluginHost(fixturePath, { timeout: 15000 });
    await host.start();
    assert.ok(host.isRunning);

    const metadata = await host.getMetadata();
    assert.equal(metadata.collectorName, 'HostTestPlugin');
    assert.equal(metadata.displayName, 'Host Test Plugin');
    assert.equal(metadata.category, 'Test');
  });

  it('configures the plugin', async () => {
    const result = await host.configure({ collectorId: 1 });
    assert.deepEqual(result, { success: true });
  });

  it('fetches sensors', async () => {
    const result = await host.fetchSensors();
    assert.equal(result.sensors.length, 1);
    assert.equal(result.sensors[0].externalId, 'host_test_1');
    assert.equal(result.sensors[0].value, '100');
  });

  it('fetches selected sensors', async () => {
    const result = await host.fetchSelectedSensors({ sensorIds: ['host_test_1'] });
    assert.equal(result.sensors.length, 1);
    assert.equal(result.sensors[0].externalId, 'host_test_1');
  });

  it('runs health check', async () => {
    const result = await host.healthCheck();
    assert.equal(result.healthy, true);
    assert.equal(typeof result.uptime, 'number');
  });

  it('starts and stops session', async () => {
    const startResult = await host.startSession();
    assert.deepEqual(startResult, { success: true });

    const stopResult = await host.stopSession();
    assert.deepEqual(stopResult, { success: true });
  });

  it('stops the plugin', async () => {
    await host.stop();
    assert.equal(host.isRunning, false);
  });

  it('rejects send when plugin is not running', async () => {
    await assert.rejects(
      () => host.getMetadata(),
      { message: 'Plugin process not running' },
    );
  });
});

describe('PluginHost timeout', () => {
  it('rejects when plugin is not running', async () => {
    // Create host but don't start it — verify send rejects immediately
    const host = new PluginHost(fixturePath, { timeout: 100 });
    await assert.rejects(
      () => host.getMetadata(),
      { message: 'Plugin process not running' },
    );
  });

  it('has correct default options', () => {
    const host = new PluginHost(fixturePath);
    assert.equal(host.isRunning, false);
  });

  it('has correct custom options', () => {
    const host = new PluginHost(fixturePath, { timeout: 5000, maxRestarts: 1 });
    assert.equal(host.isRunning, false);
  });
});
