# JunctionRelay Collectors

Plugin-based collector system for JunctionRelay. Each collector is a standalone Node.js process that communicates with the Server over JSON-RPC 2.0 via stdin/stdout.

The Server discovers plugins automatically — no server code changes required. Drop a built plugin into the `plugins/` directory, restart the Server, and it appears in the UI.

## Included Plugins

| Plugin | Category | Description |
|--------|----------|-------------|
| `system-time` | System & Testing | Local system clock |
| `internet-time` | System & Testing | UTC time from internet sources |
| `generic-api` | System & Testing | Any JSON API endpoint |
| `home-assistant` | Home & IoT | Smart home entities |
| `claude` | Cloud Services | Anthropic API usage, costs, and org data |

## Quick Start

```bash
# Install dependencies and build all plugins
npm install
npm run build

# Test a plugin manually
echo '{"jsonrpc":"2.0","method":"getMetadata","params":{},"id":1}' | node plugins/system-time/dist/index.js
```

## Building Your Own Plugin

A collector plugin is a single JavaScript file (`dist/index.js`) that the Server spawns as a subprocess. It reads JSON-RPC requests from stdin and writes responses to stdout.

### Minimal Example

Create a directory under `plugins/` with three files:

#### `plugins/my-plugin/package.json`

```json
{
  "name": "@junctionrelay/plugin-my-plugin",
  "version": "1.0.0",
  "description": "My custom collector plugin",
  "type": "module",
  "main": "dist/index.js",
  "junctionrelay": {
    "type": "collector",
    "entry": "dist/index.js"
  },
  "scripts": {
    "build": "esbuild src/index.ts --bundle --platform=node --format=esm --outfile=dist/index.js"
  },
  "dependencies": {
    "@junctionrelay/collector-sdk": "1.0.0"
  }
}
```

The `junctionrelay` block is required — this is how the Server discovers your plugin:
- `type` must be `"collector"`
- `entry` points to the built JavaScript bundle

#### `plugins/my-plugin/tsconfig.json`

```json
{
  "extends": "../../tsconfig.build.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

#### `plugins/my-plugin/src/index.ts`

```typescript
import { CollectorPlugin } from '@junctionrelay/collector-sdk';
import type { SensorResult, ConfigureParams } from '@junctionrelay/collector-sdk';

let apiUrl = '';
let token = '';

new CollectorPlugin({
  metadata: {
    collectorName: 'MyPlugin',       // Internal identifier (no spaces)
    displayName: 'My Plugin',        // Shown in the UI
    description: 'What this collects',
    category: 'Cloud Services',      // Groups plugins in the UI
    emoji: '📡',
    fields: {
      requiresUrl: true,             // Show URL input in the UI
      requiresAccessToken: true,     // Show token input in the UI
      urlLabel: 'API Endpoint',
      urlPlaceholder: 'https://api.example.com',
      accessTokenLabel: 'API Key',
      accessTokenPlaceholder: 'key_...',
    },
    defaults: {
      name: 'My Plugin',
      url: 'https://api.example.com',
      pollRate: 30000,               // How often to poll (ms)
      sendRate: 5000,                // How often to push to devices (ms)
    },
    setupInstructions: [
      {
        title: 'Get an API Key',
        body: 'Go to example.com/settings and create an API key.',
      },
    ],
  },

  async configure(params: ConfigureParams) {
    apiUrl = (params.url ?? '').replace(/\/$/, '');
    token = params.accessToken ?? '';
    return { success: true };
  },

  async testConnection() {
    if (!apiUrl || !token) {
      return { success: false, error: 'URL and API key are required' };
    }
    try {
      const resp = await fetch(`${apiUrl}/health`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      return resp.ok
        ? { success: true }
        : { success: false, error: `HTTP ${resp.status}` };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async fetchSensors() {
    if (!apiUrl || !token) throw new Error('Not configured');

    const resp = await fetch(`${apiUrl}/data`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json() as { count: number; status: string };

    const sensors: SensorResult[] = [
      {
        uniqueSensorKey: 'item_count',
        name: 'Item Count',
        value: String(data.count),
        unit: 'count',
        category: 'Stats',
        decimalPlaces: 0,
        sensorType: 'Numeric',
        componentName: 'Stats',
        sensorTag: 'Item Count',
      },
      {
        uniqueSensorKey: 'service_status',
        name: 'Service Status',
        value: data.status,
        unit: 'N/A',
        category: 'Stats',
        decimalPlaces: 0,
        sensorType: 'Text',
        componentName: 'Stats',
        sensorTag: 'Status',
      },
    ];
    return { sensors };
  },
});
```

Build it:

```bash
npm install
npm run build
```

### Deploying to the Server

The Server loads plugins from its configured `PluginsDirectory`. Each plugin is a folder containing a `package.json` and a `dist/index.js`.

**For development** — Point the Server's `PluginsDirectory` at this monorepo's `plugins/` directory in `appsettings.Development.json`. Your plugin is picked up immediately on restart.

**For production / Docker** — Copy your built plugin folder into the Server's plugins directory:

```
plugins/
├── my-plugin/
│   ├── package.json        ← must have junctionrelay.type = "collector"
│   └── dist/
│       └── index.js         ← the esbuild bundle
```

That's it. The Server auto-discovers the `package.json`, spawns `node dist/index.js`, calls `getMetadata()`, and registers your plugin. The UI renders the configuration form, setup instructions, and sensor display automatically from your metadata.

## Plugin API Reference

### Metadata

The `metadata` object defines how your plugin appears in the UI and what configuration fields are shown.

| Field | Type | Description |
|-------|------|-------------|
| `collectorName` | `string` | Internal identifier, no spaces (e.g., `"MyPlugin"`) |
| `displayName` | `string` | Human-readable name shown in the UI |
| `description` | `string` | Short description |
| `category` | `string` | UI grouping (e.g., `"Cloud Services"`, `"Home & IoT"`) |
| `emoji` | `string` | Icon shown next to the plugin name |
| `fields` | `object` | Configuration field requirements (see below) |
| `defaults` | `object` | Default values for name, URL, poll/send rates |
| `setupInstructions` | `array` | Steps shown to the user during setup |

#### `fields`

| Field | Type | Description |
|-------|------|-------------|
| `requiresUrl` | `boolean` | Show a URL input field |
| `requiresAccessToken` | `boolean` | Show a token/key input field |
| `urlLabel` | `string?` | Label for the URL field |
| `urlPlaceholder` | `string?` | Placeholder text for the URL field |
| `accessTokenLabel` | `string?` | Label for the token field |
| `accessTokenPlaceholder` | `string?` | Placeholder text for the token field |

### Handler Methods

All handlers are optional. The SDK provides sensible defaults (return `{ success: true }` or `{ sensors: [] }`).

| Method | Signature | Called When |
|--------|-----------|------------|
| `configure` | `(params: ConfigureParams) => Promise<ConfigureResult>` | User saves collector settings |
| `testConnection` | `(config: ConfigureParams) => Promise<TestConnectionResult>` | User clicks "Test Connection" |
| `fetchSensors` | `(config: ConfigureParams) => Promise<FetchSensorsResult>` | Server polls for data |
| `fetchSelectedSensors` | `(config: ConfigureParams, params: FetchSelectedSensorsParams) => Promise<FetchSensorsResult>` | Server polls for specific sensors only |
| `startSession` | `(config: ConfigureParams) => Promise<SessionResult>` | Persistent connection collectors |
| `stopSession` | `(config: ConfigureParams) => Promise<SessionResult>` | Persistent connection collectors |

If you don't implement `fetchSelectedSensors`, the SDK automatically falls back to calling `fetchSensors` and filtering by the requested sensor IDs.

### `ConfigureParams`

Passed to `configure` and made available to all subsequent handler calls:

```typescript
interface ConfigureParams {
  collectorId: number;
  url?: string;
  accessToken?: string;
  decimalPlaces?: number;
}
```

### `SensorResult`

Each sensor you return from `fetchSensors`:

```typescript
interface SensorResult {
  uniqueSensorKey: string;   // Stable identifier (e.g., "cpu_temp")
  name: string;              // Display name (e.g., "CPU Temperature")
  value: string;             // Always a string — format numbers with toFixed()
  unit: string;              // "count", "USD", "seconds", "N/A", etc.
  category: string;          // Groups sensors in the UI
  decimalPlaces: number;     // Number of decimal places for numeric values
  sensorType: string;        // "Numeric", "Text", "DateTime", "API"
  componentName: string;     // Source component name
  sensorTag: string;         // Tag for the sensor
}
```

### SDK Helpers

The SDK exports helper functions for consistent numeric formatting:

```typescript
import { getDecimalPlaces, sanitizeSensorValue, safeRound } from '@junctionrelay/collector-sdk';

getDecimalPlaces("3.14")          // → 2
safeRound(3.14159, 2)             // → 3.14
sanitizeSensorValue(3.14159, 2)   // → { value: "3.14", decimalPlaces: 2 }
```

## How It Works

```
Server                              Plugin (subprocess)
  │                                     │
  ├── Discovers package.json ───────────┤
  ├── Spawns: node dist/index.js        │
  │                                     ├── Prints "[plugin] ready" to stderr
  ├── stdin: getMetadata ──────────────►│
  │◄──────────────────── stdout: {...} ─┤
  ├── stdin: configure ────────────────►│
  │◄──────────────────── stdout: {...} ─┤
  ├── stdin: fetchSensors ─────────────►│
  │◄──────────────── stdout: {sensors} ─┤
  │         ... (repeats on poll) ...   │
```

- Communication is **JSON-RPC 2.0** over stdin/stdout (one JSON object per line)
- Plugins log to **stderr** (the Server captures these as plugin logs)
- The SDK handles all JSON-RPC parsing, dispatching, and error handling — you just implement the handler functions
- Plugins are auto-restarted up to 3 times on unexpected exit

## Project Structure

```
JunctionRelay_Collectors/
├── packages/
│   ├── protocol/     ← TypeScript types and constants (JSON-RPC, SensorResult, etc.)
│   ├── sdk/          ← CollectorPlugin class + helpers (what plugins import)
│   └── host/         ← PluginHost runtime (used by the Server to manage plugins)
└── plugins/
    ├── system-time/
    ├── internet-time/
    ├── generic-api/
    ├── home-assistant/
    └── claude/
```

## Building Without the Monorepo

You don't have to develop inside this monorepo. You can build a plugin anywhere — the only requirement is that the final output is a folder with a `package.json` and `dist/index.js`.

1. Copy any existing plugin as a starting point
2. Install the SDK: `npm install @junctionrelay/collector-sdk`
3. Write your plugin, bundle with esbuild (or any bundler that outputs a single ESM file)
4. Place the resulting folder in the Server's `PluginsDirectory`

The bundle must be a self-contained ESM file (`--platform=node --format=esm`). No `node_modules` needed at runtime — esbuild bundles the SDK into your output.
