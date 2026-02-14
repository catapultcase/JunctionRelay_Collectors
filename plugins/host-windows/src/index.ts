import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  type CollectorPluginConfig,
  type SensorResult,
  type ConfigureParams,
  getDecimalPlaces,
} from '@junctionrelay/collector-sdk';

// ============================================================================
// Python Bridge — manages the persistent Python metrics_collector.py process
// ============================================================================

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

interface PythonSensor {
  value: unknown;
  unit: string;
  sensorTag: string;
  pollerSource: string;
  rawLabel: string;
}

type PythonMetrics = Record<string, Record<string, PythonSensor>>;

// Resolve the plugin's root directory (where package.json lives)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_DIR = path.resolve(__dirname, '..');

let pythonProcess: ChildProcess | null = null;
let pythonReady = false;
let stdoutBuffer = '';
const pendingRequests: PendingRequest[] = [];

function getPythonPath(): string {
  return path.join(PLUGIN_DIR, 'binaries', 'python', 'python.exe');
}

function getPythonScript(): string {
  return path.join(PLUGIN_DIR, 'python', 'metrics_collector.py');
}

function getBinariesPath(): string {
  return path.join(PLUGIN_DIR, 'binaries');
}

function startPython(): Promise<void> {
  if (pythonProcess) return Promise.resolve();

  const pythonCmd = getPythonPath();
  const pythonScript = getPythonScript();

  if (!fs.existsSync(pythonCmd)) {
    return Promise.reject(
      new Error(
        `Bundled Python not found at: ${pythonCmd}. ` +
          'Run the build script to copy Python binaries from XSD resources.',
      ),
    );
  }

  if (!fs.existsSync(pythonScript)) {
    return Promise.reject(
      new Error(`Python metrics collector not found at: ${pythonScript}`),
    );
  }

  process.stderr.write(`[host-windows] Starting Python process: ${pythonCmd}\n`);

  pythonProcess = spawn(pythonCmd, [pythonScript], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PLUGIN_BINARIES_PATH: getBinariesPath() },
  });

  pythonReady = false;
  stdoutBuffer = '';

  pythonProcess.stdout!.on('data', (data: Buffer) => {
    stdoutBuffer += data.toString();

    let newlineIndex: number;
    while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

      if (!line) continue;

      try {
        const response = JSON.parse(line);

        if (response.status === 'ready') {
          process.stderr.write('[host-windows] Python process ready\n');
          pythonReady = true;
          continue;
        }

        if (pendingRequests.length > 0) {
          const { resolve } = pendingRequests.shift()!;
          resolve(response);
        }
      } catch (err) {
        process.stderr.write(
          `[host-windows] Failed to parse Python response: ${line}\n`,
        );
        if (pendingRequests.length > 0) {
          const { reject } = pendingRequests.shift()!;
          reject(new Error(`Invalid JSON from Python: ${line}`));
        }
      }
    }
  });

  pythonProcess.stderr!.on('data', (data: Buffer) => {
    process.stderr.write(`[host-windows] Python: ${data.toString().trim()}\n`);
  });

  pythonProcess.on('close', (code: number | null) => {
    process.stderr.write(
      `[host-windows] Python process exited with code ${code}\n`,
    );
    pythonProcess = null;
    pythonReady = false;

    while (pendingRequests.length > 0) {
      const { reject } = pendingRequests.shift()!;
      reject(new Error('Python process exited'));
    }
  });

  pythonProcess.on('error', (error: Error) => {
    process.stderr.write(
      `[host-windows] Python process error: ${error.message}\n`,
    );
    pythonProcess = null;
    pythonReady = false;
  });

  // Wait for the "ready" signal (up to 10s)
  return new Promise<void>((resolve, reject) => {
    const startTime = Date.now();
    const check = () => {
      if (pythonReady) {
        resolve();
      } else if (Date.now() - startTime > 10000) {
        reject(new Error('Python process failed to become ready after 10s'));
      } else if (!pythonProcess) {
        reject(new Error('Python process exited before becoming ready'));
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

function stopPython(): void {
  if (!pythonProcess) return;

  process.stderr.write('[host-windows] Stopping Python process\n');

  while (pendingRequests.length > 0) {
    const { reject } = pendingRequests.shift()!;
    reject(new Error('Python process stopping'));
  }

  pythonReady = false;

  try {
    if (pythonProcess.stdin && pythonProcess.stdin.writable) {
      pythonProcess.stdin.write('exit\n');
      pythonProcess.stdin.end();
    }
  } catch {
    // Process may already be dead
  }

  const proc = pythonProcess;
  pythonProcess = null;

  setTimeout(() => {
    if (proc && !proc.killed) {
      proc.kill('SIGKILL');
    }
  }, 500);
}

async function sendCommand(command: string): Promise<unknown> {
  if (!pythonProcess) {
    await startPython();
  }

  return new Promise((resolve, reject) => {
    if (
      !pythonProcess ||
      !pythonProcess.stdin ||
      !pythonProcess.stdin.writable
    ) {
      reject(new Error('Python process not available'));
      return;
    }

    pendingRequests.push({ resolve, reject });

    try {
      pythonProcess.stdin.write(`${command}\n`);
    } catch (err) {
      pendingRequests.pop();
      reject(
        new Error(
          `Failed to send command to Python: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  });
}

// ============================================================================
// Sensor Mapping — converts Python output to SensorResult[]
// ============================================================================

const CATEGORY_MAP: Record<string, string> = {
  system: 'System',
  cpu: 'CPU',
  gpu: 'GPU',
  memory: 'Memory',
  disk: 'Disk',
  network: 'Network',
  battery: 'Battery',
  cores: 'Cores',
};

function inferSensorType(unit: string): string {
  switch (unit) {
    case '%':
    case 'MHz':
    case 'MB':
    case 'GB':
    case 'W':
    case 'MB/s':
    case 'bytes':
    case 'cores':
    case 'threads':
    case 'seconds':
      return 'Numeric';
    case 'boolean':
      return 'Boolean';
    case '°C':
      return 'Numeric';
    default:
      return 'Text';
  }
}

function inferDecimalPlaces(unit: string, value: unknown): number {
  if (typeof value === 'string') {
    return getDecimalPlaces(value);
  }
  if (typeof value === 'number') {
    return getDecimalPlaces(String(value));
  }
  return 0;
}

function mapSensors(metrics: PythonMetrics): SensorResult[] {
  const sensors: SensorResult[] = [];

  for (const [categoryKey, categoryData] of Object.entries(metrics)) {
    if (!categoryData || typeof categoryData !== 'object') continue;

    const category = CATEGORY_MAP[categoryKey] || categoryKey;

    for (const [, sensor] of Object.entries(categoryData)) {
      if (!sensor || typeof sensor !== 'object' || !('sensorTag' in sensor))
        continue;

      const s = sensor as PythonSensor;
      const valueStr = String(s.value ?? '');

      sensors.push({
        uniqueSensorKey: s.sensorTag,
        name: s.rawLabel || s.sensorTag,
        value: valueStr,
        unit: s.unit || '',
        category,
        decimalPlaces: inferDecimalPlaces(s.unit, s.value),
        sensorType: inferSensorType(s.unit),
        componentName: category,
        sensorTag: s.sensorTag,
      });
    }
  }

  return sensors;
}

// ============================================================================
// Plugin config export — stateless handlers, no auto-start
// ============================================================================

// Clean up Python on exit
process.on('SIGTERM', () => stopPython());
process.on('exit', () => stopPython());

export default {
  metadata: {
    collectorName: 'junctionrelay.host-windows',
    displayName: 'Host Sensors (Windows)',
    description:
      'CPU, GPU, memory, disk, network, and battery monitoring using psutil',
    category: 'System & Monitoring',
    emoji: '\u{1F5A5}\uFE0F',
    fields: {
      requiresUrl: false,
      requiresAccessToken: false,
    },
    defaults: {
      name: 'Host Sensors',
      pollRate: 2000,
      sendRate: 2000,
    },
    setupInstructions: [
      {
        title: 'Requirements',
        body: 'This plugin requires bundled Python 3.11 with psutil and GPUtil pre-installed. These are included when deploying via the build scripts.',
      },
      {
        title: 'GPU Support',
        body: 'NVIDIA GPUs are detected via GPUtil. AMD/Intel GPUs on Windows use gpu-reader.exe (included in binaries/). On Linux, AMD GPUs are read via sysfs.',
      },
    ],
    setupNote:
      'No configuration needed. The plugin automatically detects available hardware sensors.',
  },

  async configure(_params: ConfigureParams) {
    await startPython();
    return { success: true };
  },

  async testConnection(_params: ConfigureParams) {
    try {
      // Verify Python is available
      const pythonCmd = getPythonPath();
      if (!fs.existsSync(pythonCmd)) {
        return {
          success: false,
          error: `Bundled Python not found at: ${pythonCmd}. Run the build script to copy Python binaries.`,
        };
      }

      // Start Python and try a collect
      await startPython();
      const result = (await sendCommand('collect')) as
        | PythonMetrics
        | { error?: string };

      if ('error' in result && result.error) {
        return { success: false, error: `Python collect failed: ${result.error}` };
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  async fetchSensors(_config: ConfigureParams) {
    const result = (await sendCommand('collect')) as
      | PythonMetrics
      | { error?: string };

    if ('error' in result && result.error) {
      throw new Error(`Python collect failed: ${result.error}`);
    }

    const sensors = mapSensors(result as PythonMetrics);
    return { sensors };
  },
} satisfies CollectorPluginConfig;
