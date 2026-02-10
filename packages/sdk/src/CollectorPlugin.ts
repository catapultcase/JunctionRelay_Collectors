import * as readline from 'node:readline';
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
import { JSON_RPC_ERRORS } from '@junctionrelay/collector-protocol';

export interface CollectorPluginConfig {
  metadata: CollectorMetadata;

  configure?(params: ConfigureParams): Promise<ConfigureResult>;
  fetchSensors?(config: ConfigureParams): Promise<FetchSensorsResult>;
  fetchSelectedSensors?(config: ConfigureParams, params: FetchSelectedSensorsParams): Promise<FetchSensorsResult>;
  testConnection?(config: ConfigureParams): Promise<TestConnectionResult>;
  startSession?(config: ConfigureParams): Promise<SessionResult>;
  stopSession?(config: ConfigureParams): Promise<SessionResult>;
}

export class CollectorPlugin {
  private config: CollectorPluginConfig;
  private startTime: number;
  private currentConfig: ConfigureParams = { collectorId: 0 };

  constructor(config: CollectorPluginConfig) {
    this.config = config;
    this.startTime = Date.now();
    this.start();
  }

  private start(): void {
    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    rl.on('line', (line: string) => {
      this.handleLine(line).catch((err) => {
        process.stderr.write(`[plugin] Unhandled error: ${err}\n`);
      });
    });

    rl.on('close', () => {
      process.stderr.write(`[plugin] stdin closed, shutting down\n`);
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      process.stderr.write(`[plugin] SIGTERM received, shutting down\n`);
      process.exit(0);
    });

    process.stderr.write(`[plugin] ${this.config.metadata.displayName} ready\n`);
  }

  private async handleLine(line: string): Promise<void> {
    let request: JsonRpcRequest;

    try {
      request = JSON.parse(line);
    } catch {
      this.writeResponse({
        jsonrpc: '2.0',
        id: 0,
        error: { code: JSON_RPC_ERRORS.PARSE_ERROR, message: 'Parse error' },
      });
      return;
    }

    try {
      const result = await this.dispatch(request.method, request.params ?? {});
      this.writeResponse({
        jsonrpc: '2.0',
        id: request.id,
        result,
      });
    } catch (err) {
      const code = typeof (err as { code?: unknown }).code === 'number'
        ? (err as { code: number }).code
        : JSON_RPC_ERRORS.SERVER_ERROR;
      this.writeResponse({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code,
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  private async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'getMetadata':
        return this.config.metadata;

      case 'configure': {
        const configParams = params as unknown as ConfigureParams;
        this.currentConfig = configParams;
        if (this.config.configure) {
          return this.config.configure(configParams);
        }
        return { success: true };
      }

      case 'fetchSensors':
        if (this.config.fetchSensors) {
          return this.config.fetchSensors(this.currentConfig);
        }
        return { sensors: [] };

      case 'fetchSelectedSensors': {
        const selectedParams = params as unknown as FetchSelectedSensorsParams;
        if (this.config.fetchSelectedSensors) {
          return this.config.fetchSelectedSensors(this.currentConfig, selectedParams);
        }
        if (this.config.fetchSensors) {
          const all = await this.config.fetchSensors(this.currentConfig);
          return {
            sensors: all.sensors.filter((s) => selectedParams.sensorIds.includes(s.externalId)),
          };
        }
        return { sensors: [] };
      }

      case 'testConnection':
        if (this.config.testConnection) {
          return this.config.testConnection(this.currentConfig);
        }
        return { success: true };

      case 'startSession':
        if (this.config.startSession) {
          return this.config.startSession(this.currentConfig);
        }
        return { success: true };

      case 'stopSession':
        if (this.config.stopSession) {
          return this.config.stopSession(this.currentConfig);
        }
        return { success: true };

      case 'healthCheck':
        return {
          healthy: true,
          uptime: Math.floor((Date.now() - this.startTime) / 1000),
        } satisfies HealthCheckResult;

      default:
        throw Object.assign(new Error(`Method not found: ${method}`), {
          code: JSON_RPC_ERRORS.METHOD_NOT_FOUND,
        });
    }
  }

  private writeResponse(response: JsonRpcResponse): void {
    process.stdout.write(JSON.stringify(response) + '\n');
  }
}
