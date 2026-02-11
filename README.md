# JunctionRelay Collectors

Plugin-based collector system for JunctionRelay. Each collector is a standalone Node.js process that communicates with the host (Server or XSD) over JSON-RPC 2.0 via stdin/stdout.

Plugins are discovered automatically — no host code changes required. Place a built plugin folder in the collectors directory, restart the app, and it appears in the UI.

## Included Plugins

| Plugin | Category | Description | Bundled Dependencies |
|--------|----------|-------------|----------------------|
| `system-time` | System & Testing | Local system clock | None |
| `internet-time` | System & Testing | UTC time from internet sources | None |
| `generic-api` | System & Testing | Any JSON API endpoint | None |
| `home-assistant` | Home & IoT | Smart home entities | None |
| `host-windows` | System & Monitoring | CPU, GPU, memory, disk, network, battery | Python 3.11, psutil, GPUtil, gpu-reader.exe |
| `claude` | Cloud Services | Anthropic API usage, costs, and org data | None |

## Quick Start

```bash
# Install dependencies and build all plugins
npm install
npm run build

# Test a plugin manually
echo '{"jsonrpc":"2.0","method":"getMetadata","params":{},"id":1}' | node plugins/system-time/dist/index.js
```

## Building Your Own Plugin

A collector plugin is a single JavaScript file (`dist/index.js`) that the host spawns as a subprocess. It reads JSON-RPC requests from stdin and writes responses to stdout.

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

The `junctionrelay` block is required — this is how the host discovers your plugin:
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

### Deploying a Plugin

Place your built plugin folder in the collectors directory. Each plugin is a self-contained folder — everything it needs to run must be inside it:

```
collectors/
├── my-plugin/
│   ├── package.json        ← must have junctionrelay.type = "collector"
│   ├── dist/
│   │   └── index.js         ← the esbuild bundle
│   ├── python/              ← (optional) bundled Python scripts
│   └── binaries/            ← (optional) bundled runtimes or native binaries
```

**Plugins must be self-contained.** The user should be able to drop your plugin folder into the collectors directory and have it work immediately.

**Pre-bundled runtimes:** Server and XSD ship with Node.js and Python 3.11 (with psutil and GPUtil). Your plugin can rely on these — no need to re-bundle them. npm dependencies are inlined by esbuild into `dist/index.js` at build time.

**Runtime resolution chain:** When a plugin needs Python (or another runtime), it resolves using this priority:

1. **Plugin-bundled** — `<plugin>/binaries/python/` (if present, takes priority — allows version override)
2. **Server-bundled** — shared runtimes shipped with the Server/XSD install
3. **System-installed** — falls back to system `python` on PATH

If your plugin needs a specific runtime version or a dependency not included in the server bundle, bundle it in your plugin's `binaries/` directory and it will take priority.

**Plugin locations:**
- **Server (Windows):** `%APPDATA%/JunctionRelay/collectors/`
- **Server (Docker):** `/app/data/collectors/` (bundled plugins are pre-populated on first start)
- **XSD (Windows):** `%APPDATA%/JunctionRelay_XSD/collectors/`

The host auto-discovers the `package.json`, spawns `node dist/index.js`, calls `getMetadata()`, and registers your plugin. The UI renders the configuration form, setup instructions, and sensor display automatically from your metadata.

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
| `fetchSensors` | `(config: ConfigureParams) => Promise<FetchSensorsResult>` | Host polls for data |
| `fetchSelectedSensors` | `(config: ConfigureParams, params: FetchSelectedSensorsParams) => Promise<FetchSensorsResult>` | Host polls for specific sensors only |
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

Each sensor you return from `fetchSensors`. These fields map directly to the host's `Model_Sensor` — every sensor in the system (from devices, collectors, or plugins) uses the same model. The host fills in relationship fields (`CollectorId`, `DeviceName`, etc.) automatically — your plugin only provides the sensor data fields below.

```typescript
interface SensorResult {
  uniqueSensorKey: string;   // Stable identifier, stored as ExternalId in the DB (e.g., "cpu_temp")
  name: string;              // Display name (e.g., "CPU Temperature")
  value: string;             // Always a string — format numbers with toFixed()
  unit: string;              // Unit label: "%", "°C", "MB", "count", "N/A", etc.
  category: string;          // Groups sensors in the UI (e.g., "CPU", "Memory", "Stats")
  decimalPlaces: number;     // Number of decimal places for numeric values
  sensorType: string;        // "Numeric", "Text", "DateTime", "API"
  componentName: string;     // Source grouping (e.g., "homeassistant/192.168.1.100", "CPU")
  sensorTag: string;         // Tag for dictionary mapping (e.g., "cpu_usage_total")
}
```

**Field details:**

| Field | Maps to `Model_Sensor` | Purpose |
|-------|----------------------|---------|
| `uniqueSensorKey` | `ExternalId` | Stable key that persists across restarts. Must be unique within your plugin. Used for sensor selection and DB identity. |
| `name` | `Name` | Human-readable label shown in the UI |
| `value` | `Value` | Current reading as a string. Numbers should use consistent decimal formatting. |
| `unit` | `Unit` | Display unit. Use `"N/A"` for dimensionless text values. |
| `category` | `Category` | UI grouping. Sensors with the same category appear together. |
| `decimalPlaces` | `DecimalPlaces` | Precision hint for numeric display |
| `sensorType` | `SensorType` | Value type: `"Numeric"` (numbers), `"Text"` (strings), `"DateTime"` (timestamps), `"API"` (general API data) |
| `componentName` | `ComponentName` | Source component — helps distinguish sensors when a collector has multiple sub-sources |
| `sensorTag` | `SensorTag` | Tag for sensor dictionary matching. Dictionary-mapped plugins use standard tags (e.g., `cpu_usage_total`). Generic plugins can use any string. |

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
Host (Server or XSD)                Plugin (subprocess)
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
- Plugins log to **stderr** (the host captures these as plugin logs)
- The SDK handles all JSON-RPC parsing, dispatching, and error handling — you just implement the handler functions
- Plugins are auto-restarted up to 3 times on unexpected exit

## Project Structure

```
JunctionRelay_Collectors/
├── packages/
│   ├── protocol/     ← TypeScript types and constants (JSON-RPC, SensorResult, etc.)
│   └── sdk/          ← CollectorPlugin class + helpers (what plugins import)
└── plugins/
    ├── system-time/
    ├── internet-time/
    ├── generic-api/
    ├── home-assistant/
    ├── host-windows/
    └── claude/
```

## Building Without the Monorepo

You don't have to develop inside this monorepo. You can build a plugin anywhere — the only requirement is that the final output is a fully self-contained folder.

1. Copy any existing plugin as a starting point
2. Install the SDK: `npm install @junctionrelay/collector-sdk`
3. Write your plugin, bundle with esbuild (or any bundler that outputs a single ESM file)
4. Place the resulting folder in the collectors directory

The bundle must be a self-contained ESM file (`--platform=node --format=esm`). esbuild inlines all npm dependencies into your output — no `node_modules` needed at runtime. If your plugin uses non-Node.js dependencies (Python, native binaries, etc.), bundle them inside your plugin folder.
