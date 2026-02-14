import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  CollectorMetadata,
  ConfigureParams,
  ConfigureResult,
  FetchSensorsResult,
  FetchSelectedSensorsParams,
  TestConnectionResult,
  HealthCheckResult,
  SessionResult,
  JsonRpcRequest,
  JsonRpcResponse,
} from '@junctionrelay/collector-protocol';

export interface PluginHostOptions {
  timeout?: number;
  maxRestarts?: number;
  restartDelayMs?: number;
  onLog?: (message: string) => void;
  onExit?: (code: number | null) => void;
  onRestart?: (attempt: number) => void;
  onMaxRestartsExceeded?: () => void;
}

export class PluginHost {
  private pluginPath: string;
  private options: Required<Pick<PluginHostOptions, 'timeout' | 'maxRestarts' | 'restartDelayMs'>> & PluginHostOptions;
  private process: ChildProcess | null = null;
  private responseReader: readline.Interface | null = null;
  private stderrReader: readline.Interface | null = null;
  private nextId = 1;
  private pending = new Map<number | string, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private logs: string[] = [];
  private restartCount = 0;
  private lastConfigureParams: ConfigureParams | null = null;
  private entry: string = '';
  private stopped = false;

  constructor(pluginPath: string, options: PluginHostOptions = {}) {
    this.pluginPath = path.resolve(pluginPath);
    this.options = {
      timeout: options.timeout ?? 30000,
      maxRestarts: options.maxRestarts ?? 3,
      restartDelayMs: options.restartDelayMs ?? 1000,
      ...options,
    };
  }

  get isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  private findRpcHost(): string | null {
    const rpcRelative = path.join('node_modules', '@junctionrelay', 'collector-sdk', 'bin', 'rpc-host.mjs');
    let dir = this.pluginPath;
    const root = path.parse(dir).root;
    while (dir !== root) {
      const candidate = path.join(dir, rpcRelative);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      dir = path.dirname(dir);
    }
    return null;
  }

  async start(): Promise<void> {
    this.stopped = false;
    const pkgPath = path.join(this.pluginPath, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    this.entry = pkg.junctionrelay?.entry ?? pkg.main ?? 'index.ts';
    const entryPath = path.join(this.pluginPath, this.entry);

    await this.spawnProcess(entryPath);
  }

  private async spawnProcess(entryPath: string): Promise<void> {
    const isTs = entryPath.endsWith('.ts');

    let command: string;
    let args: string[];

    if (isTs) {
      // For TypeScript source (dev mode), run directly via tsx
      command = 'npx';
      args = ['tsx', entryPath];
    } else {
      // For built plugins, spawn via rpc-host.mjs from collector-sdk
      // Walk up from pluginPath checking node_modules at each level (handles npm workspace hoisting)
      const rpcHostPath = this.findRpcHost();
      if (rpcHostPath) {
        command = 'node';
        args = [rpcHostPath, entryPath];
      } else {
        // Fallback: try running entry directly (legacy plugins)
        command = 'node';
        args = [entryPath];
      }
    }

    this.process = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.pluginPath,
    });

    this.responseReader = readline.createInterface({
      input: this.process.stdout!,
      terminal: false,
    });

    this.responseReader.on('line', (line: string) => {
      try {
        const response: JsonRpcResponse = JSON.parse(line);
        const pending = this.pending.get(response.id);
        if (pending) {
          this.pending.delete(response.id);
          clearTimeout(pending.timer);
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch {
        this.log(`[host] Failed to parse plugin stdout: ${line}`);
      }
    });

    this.stderrReader = readline.createInterface({
      input: this.process.stderr!,
      terminal: false,
    });

    this.stderrReader.on('line', (line: string) => {
      this.log(line);
    });

    this.process.on('exit', (code) => {
      this.options.onExit?.(code);

      // Reject all pending requests
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Plugin process exited with code ${code}`));
        this.pending.delete(id);
      }

      // Auto-restart on unexpected exit
      if (!this.stopped && this.restartCount < this.options.maxRestarts) {
        this.restartCount++;
        this.options.onRestart?.(this.restartCount);
        this.log(`[host] Plugin exited unexpectedly (code ${code}), restarting (attempt ${this.restartCount}/${this.options.maxRestarts})...`);

        setTimeout(async () => {
          try {
            const fullEntryPath = path.join(this.pluginPath, this.entry);
            await this.spawnProcess(fullEntryPath);
            // Re-send last configure params if available
            if (this.lastConfigureParams) {
              await this.configure(this.lastConfigureParams);
            }
          } catch (err) {
            this.log(`[host] Restart failed: ${err}`);
          }
        }, this.options.restartDelayMs);
      } else if (!this.stopped && this.restartCount >= this.options.maxRestarts) {
        this.options.onMaxRestartsExceeded?.();
        this.log(`[host] Max restarts (${this.options.maxRestarts}) exceeded`);
      }
    });

    // Wait for the plugin to signal readiness (first stderr line)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for plugin ready'));
      }, this.options.timeout);

      const onLine = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.stderrReader!.once('line', onLine);
    });
  }

  private send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.process?.stdin?.writable) {
      return Promise.reject(new Error('Plugin process not running'));
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out after ${this.options.timeout}ms: ${method}`));
      }, this.options.timeout);

      this.pending.set(id, { resolve, reject, timer });
      this.process!.stdin!.write(JSON.stringify(request) + '\n');
    });
  }

  private log(message: string): void {
    this.logs.push(message);
    this.options.onLog?.(message);
  }

  async getMetadata(): Promise<CollectorMetadata> {
    return this.send('getMetadata') as Promise<CollectorMetadata>;
  }

  async configure(params: ConfigureParams): Promise<ConfigureResult> {
    this.lastConfigureParams = params;
    return this.send('configure', params as unknown as Record<string, unknown>) as Promise<ConfigureResult>;
  }

  async fetchSensors(): Promise<FetchSensorsResult> {
    return this.send('fetchSensors') as Promise<FetchSensorsResult>;
  }

  async fetchSelectedSensors(params: FetchSelectedSensorsParams): Promise<FetchSensorsResult> {
    return this.send('fetchSelectedSensors', params as unknown as Record<string, unknown>) as Promise<FetchSensorsResult>;
  }

  async testConnection(): Promise<TestConnectionResult> {
    return this.send('testConnection') as Promise<TestConnectionResult>;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return this.send('healthCheck') as Promise<HealthCheckResult>;
  }

  async startSession(): Promise<SessionResult> {
    return this.send('startSession') as Promise<SessionResult>;
  }

  async stopSession(): Promise<SessionResult> {
    return this.send('stopSession') as Promise<SessionResult>;
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  async stop(): Promise<void> {
    this.stopped = true;

    // Clear all pending timers
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
    }

    if (this.process) {
      this.process.stdin?.end();
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.responseReader?.close();
    this.responseReader = null;
    this.stderrReader?.close();
    this.stderrReader = null;
  }
}
