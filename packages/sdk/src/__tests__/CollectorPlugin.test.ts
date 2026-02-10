import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JsonRpcRequest, JsonRpcResponse } from '@junctionrelay/collector-protocol';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, 'fixture-plugin.ts');

function spawnFixture(): ChildProcess {
  return spawn('npx', ['tsx', fixturePath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
  });
}

function sendRequest(proc: ChildProcess, method: string, params: Record<string, unknown> = {}, id: number = 1): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: proc.stdout!, terminal: false });

    const timeout = setTimeout(() => {
      rl.close();
      reject(new Error(`Timeout waiting for response to ${method}`));
    }, 10000);

    rl.once('line', (line) => {
      clearTimeout(timeout);
      rl.close();
      try {
        resolve(JSON.parse(line) as JsonRpcResponse);
      } catch (err) {
        reject(err);
      }
    });

    const request: JsonRpcRequest = { jsonrpc: '2.0', method, params, id };
    proc.stdin!.write(JSON.stringify(request) + '\n');
  });
}

function waitForReady(proc: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: proc.stderr!, terminal: false });
    const timeout = setTimeout(() => {
      rl.close();
      reject(new Error('Timeout waiting for plugin ready'));
    }, 10000);

    rl.once('line', () => {
      clearTimeout(timeout);
      // Keep stderr reader open for the process lifetime
      resolve();
    });
  });
}

describe('CollectorPlugin integration', () => {
  let proc: ChildProcess;

  after(() => {
    if (proc && !proc.killed) {
      proc.stdin?.end();
      proc.kill('SIGTERM');
    }
  });

  it('handles getMetadata round trip', async () => {
    proc = spawnFixture();
    await waitForReady(proc);

    const response = await sendRequest(proc, 'getMetadata', {}, 1);
    assert.equal(response.jsonrpc, '2.0');
    assert.equal(response.id, 1);
    assert.equal(response.error, undefined);

    const metadata = response.result as { collectorName: string; displayName: string };
    assert.equal(metadata.collectorName, 'TestPlugin');
    assert.equal(metadata.displayName, 'Test Plugin');
  });

  it('handles configure round trip', async () => {
    const response = await sendRequest(proc, 'configure', { collectorId: 42 }, 2);
    assert.equal(response.id, 2);
    assert.equal(response.error, undefined);
    assert.deepEqual(response.result, { success: true });
  });

  it('handles fetchSensors round trip', async () => {
    const response = await sendRequest(proc, 'fetchSensors', {}, 3);
    assert.equal(response.id, 3);
    assert.equal(response.error, undefined);

    const result = response.result as { sensors: Array<{ uniqueSensorKey: string }> };
    assert.equal(result.sensors.length, 2);
    assert.equal(result.sensors[0].uniqueSensorKey, 'test_sensor_1');
    assert.equal(result.sensors[1].uniqueSensorKey, 'test_sensor_2');
  });

  it('handles fetchSelectedSensors with auto-filter', async () => {
    const response = await sendRequest(proc, 'fetchSelectedSensors', {
      sensorIds: ['test_sensor_1'],
    }, 4);
    assert.equal(response.id, 4);
    assert.equal(response.error, undefined);

    const result = response.result as { sensors: Array<{ uniqueSensorKey: string }> };
    assert.equal(result.sensors.length, 1);
    assert.equal(result.sensors[0].uniqueSensorKey, 'test_sensor_1');
  });

  it('handles healthCheck round trip', async () => {
    const response = await sendRequest(proc, 'healthCheck', {}, 5);
    assert.equal(response.id, 5);
    assert.equal(response.error, undefined);

    const result = response.result as { healthy: boolean; uptime: number };
    assert.equal(result.healthy, true);
    assert.equal(typeof result.uptime, 'number');
  });

  it('returns parse error for invalid JSON', async () => {
    // Send raw invalid JSON
    const promise = new Promise<JsonRpcResponse>((resolve, reject) => {
      const rl = readline.createInterface({ input: proc.stdout!, terminal: false });
      const timeout = setTimeout(() => {
        rl.close();
        reject(new Error('Timeout'));
      }, 10000);
      rl.once('line', (line) => {
        clearTimeout(timeout);
        rl.close();
        resolve(JSON.parse(line));
      });
    });

    proc.stdin!.write('not valid json\n');
    const response = await promise;
    assert.equal(response.error?.code, -32700);
    assert.equal(response.error?.message, 'Parse error');
  });

  it('returns method-not-found for unknown methods', async () => {
    const response = await sendRequest(proc, 'unknownMethod', {}, 7);
    assert.equal(response.id, 7);
    assert.notEqual(response.error, undefined);
    assert.equal(response.error!.code, -32601);
    assert.ok(response.error!.message.includes('Method not found'));
  });
});
