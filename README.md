# JunctionRelay Collectors

Plugin-based collector system for JunctionRelay. Each collector is a standalone Node.js process that communicates with the host (Server or XSD) over JSON-RPC 2.0 via stdin/stdout.

Plugins are discovered automatically — no host code changes required. Place a built plugin folder in the collectors directory, restart the app, and it appears in the UI.

## Repository Structure

```
packages/
  protocol/   @junctionrelay/collector-protocol — types, interfaces, constants
  sdk/        @junctionrelay/collector-sdk — CollectorPluginConfig type + helpers
plugins/
  junctionrelay.system-time/      System & Testing — local system clock
  junctionrelay.internet-time/    System & Testing — UTC time from internet sources
  junctionrelay.generic-api/      System & Testing — any JSON API endpoint
  junctionrelay.home-assistant/   Home & IoT — smart home entities
  junctionrelay.host-windows/     System & Monitoring — CPU, GPU, memory, disk, network, battery
  junctionrelay.claude/           Cloud Services — Anthropic API usage, costs, and org data
```

## Creating a Plugin

### 1. Copy the reference plugin

Copy `plugins/junctionrelay.system-time/` to a new folder. This can be anywhere on your filesystem — plugins do NOT need to live inside this monorepo.

```bash
cp -r plugins/junctionrelay.system-time /path/to/my-plugin
cd /path/to/my-plugin
```

### 2. Edit `package.json`

Update the `junctionrelay` manifest — this is how the host app discovers your plugin:

```json
{
  "name": "@yourname/plugin-my-thing",
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

**Required manifest fields:**
- `junctionrelay.type` must be `"collector"`
- `junctionrelay.entry` points to the built JavaScript bundle

**`collectorName` namespacing:** Plugin collector names must use `<namespace>.<name>` dot-notation where both segments are lowercase kebab-case (e.g. `yourname.my-plugin`, `junctionrelay.system-time`). This prevents collisions between plugins and built-in native collectors (`Cloudflare`, `Host`, `HWiNFO`, etc.), which are un-namespaced. The regex is exported as `PLUGIN_ID_PATTERN` from `@junctionrelay/collector-protocol`.

### 3. Write your plugin

A plugin exports a default config object with metadata and handler functions:

**`src/index.ts`** — simple plugin (no configuration needed):
```typescript
import type { CollectorPluginConfig, SensorResult } from '@junctionrelay/collector-sdk';

export default {
  metadata: {
    collectorName: 'yourname.my-plugin',
    displayName: 'My Plugin',
    description: 'What this collects',
    category: 'System & Testing',
    emoji: '🔧',
    fields: {
      requiresUrl: false,
      requiresAccessToken: false,
    },
    defaults: {
      name: 'My Plugin',
      pollRate: 10000,
      sendRate: 5000,
    },
    setupInstructions: [
      {
        title: 'No configuration needed',
        body: 'This plugin works out of the box.',
      },
    ],
  },

  async fetchSensors() {
    const sensors: SensorResult[] = [
      {
        uniqueSensorKey: 'my_value',
        name: 'My Value',
        value: String(42),
        unit: 'count',
        category: 'Stats',
        decimalPlaces: 0,
        sensorType: 'Numeric',
        componentName: 'MyPlugin',
        sensorTag: 'MyValue',
      },
    ];
    return { sensors };
  },

  async testConnection() {
    return { success: true };
  },
} satisfies CollectorPluginConfig;
```

**`src/index.ts`** — plugin with URL and API key:
```typescript
import type { CollectorPluginConfig, SensorResult, ConfigureParams } from '@junctionrelay/collector-sdk';
import { getDecimalPlaces } from '@junctionrelay/collector-sdk';

export default {
  metadata: {
    collectorName: 'yourname.my-api',
    displayName: 'My API',
    description: 'Collects data from an API',
    category: 'Cloud Services',
    emoji: '📡',
    fields: {
      requiresUrl: true,
      requiresAccessToken: true,
      urlLabel: 'API Endpoint',
      urlPlaceholder: 'https://api.example.com',
      accessTokenLabel: 'API Key',
      accessTokenPlaceholder: 'key_...',
    },
    defaults: {
      name: 'My API',
      url: 'https://api.example.com',
      pollRate: 30000,
      sendRate: 5000,
    },
    setupInstructions: [
      {
        title: 'Get an API Key',
        body: 'Go to example.com/settings and create an API key.',
      },
    ],
  },

  async testConnection(config: ConfigureParams) {
    const url = config.url?.replace(/\/$/, '') ?? '';
    const token = config.accessToken ?? '';
    if (!url || !token) {
      return { success: false, error: 'URL and API key are required' };
    }
    try {
      const resp = await fetch(`${url}/health`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      return resp.ok
        ? { success: true }
        : { success: false, error: `HTTP ${resp.status}` };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async fetchSensors(config: ConfigureParams) {
    const url = config.url?.replace(/\/$/, '') ?? '';
    const token = config.accessToken ?? '';
    if (!url || !token) throw new Error('Not configured');

    const resp = await fetch(`${url}/data`, {
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
        decimalPlaces: getDecimalPlaces(String(data.count)),
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
} satisfies CollectorPluginConfig;
```

**Key points:**
- Plugins are **stateless** — no module-level variables. The host passes `config: ConfigureParams` (with `url`, `accessToken`, etc.) to every handler call.
- The `CollectorPluginConfig` type is the full interface. Use `satisfies` for type checking without wrapping in a class.
- All handlers are optional. The SDK provides defaults (`{ success: true }` or `{ sensors: [] }`).
- `fetchSensors` receives `config` with the URL and token the user configured in the UI.

### Metadata reference

The `metadata` object defines how your plugin appears in the UI and what configuration fields are shown.

| Field | Type | Description |
|-------|------|-------------|
| `collectorName` | `string` | Namespaced identifier in `<namespace>.<name>` dot-notation (e.g., `"yourname.my-plugin"`) |
| `displayName` | `string` | Human-readable name shown in the UI |
| `description` | `string` | Short description |
| `category` | `string` | UI grouping (e.g., `"Cloud Services"`, `"Home & IoT"`, `"System & Testing"`) |
| `emoji` | `string` | Icon shown next to the plugin name |
| `fields` | `object` | Configuration field requirements (see below) |
| `defaults` | `object` | Default values for name, URL, poll/send rates |
| `setupInstructions` | `array` | Steps shown to the user during setup |

**`fields`:**

| Field | Type | Description |
|-------|------|-------------|
| `requiresUrl` | `boolean` | Show a URL input field |
| `requiresAccessToken` | `boolean` | Show a token/key input field |
| `urlLabel` | `string?` | Label for the URL field |
| `urlPlaceholder` | `string?` | Placeholder text for the URL field |
| `accessTokenLabel` | `string?` | Label for the token field |
| `accessTokenPlaceholder` | `string?` | Placeholder text for the token field |

### Handler methods

All handlers are optional. The host passes `config: ConfigureParams` to every call.

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

Passed to every handler by the host runtime:

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

### SDK helpers

The SDK exports helper functions for consistent numeric formatting:

```typescript
import { getDecimalPlaces, sanitizeSensorValue, safeRound } from '@junctionrelay/collector-sdk';

getDecimalPlaces("3.14")          // → 2
safeRound(3.14159, 2)             // → 3.14
sanitizeSensorValue(3.14159, 2)   // → { value: "3.14", decimalPlaces: 2 }
```

### 4. Build

```bash
npm install
npm run build
```

This runs esbuild to produce `dist/index.js` — a single ESM bundle with all npm dependencies inlined. No `node_modules` needed at runtime.

**Using `.js` instead of `.ts`:** Both work. If you use `.js`, change the build script to `esbuild src/index.js --bundle ...` and drop the TypeScript dependency. You lose type checking but the plugin still works identically.

**Standalone plugins** (outside this monorepo): If your plugin is NOT inside this monorepo, the `@junctionrelay/collector-sdk` dependency in `package.json` won't resolve from npm (it's not published). That's fine — esbuild bundles everything, and the SDK types are only needed at build time. You can:
1. Copy `packages/sdk/` and `packages/protocol/` locally and reference them via `file:` deps, or
2. Copy just the type definitions you need (`CollectorPluginConfig`, `SensorResult`, `ConfigureParams`) inline and remove the SDK dependency entirely

### 5. Pack and Deploy

After building, create a distributable `.zip`:

```bash
npm run pack
```

This produces `<name>.zip` containing `<name>/package.json` and `<name>/dist/index.js`. All built-in plugins include this script.

Drop the `.zip` file into the collectors directory:

| App | Path |
|-----|------|
| **Server (Windows)** | `%APPDATA%\JunctionRelay\collectors\` |
| **Server (Docker)** | `/app/data/collectors/` |
| **XSD (Windows)** | `%APPDATA%\JunctionRelay_XSD\collectors\` |

The app automatically extracts the zip on next startup and deletes the zip file. If a folder with the same name already exists, the zip is skipped — delete the existing folder first to re-install.

Restart the app. Your plugin appears in the collector list with the emoji, name, and description from the metadata. The UI renders the configuration form, setup instructions, and sensor display automatically.

## Pre-bundled Runtimes

Server and XSD ship with these runtimes — plugins can rely on them without bundling their own:

| Runtime | Version | Included Libraries |
|---------|---------|-------------------|
| Node.js | 20 LTS | (plugin host — always available) |
| Python | 3.11 | psutil, GPUtil |

Native binaries shipped with the platform: `gpu-reader.exe` (Windows, AMD/Intel GPU).

**Runtime resolution chain:** When a plugin needs Python (or another runtime), it resolves using this priority:

1. **Plugin-bundled** — `<plugin>/binaries/python/` (if present, takes priority — allows version override)
2. **Server-bundled** — shared runtimes shipped with the Server/XSD install
3. **System-installed** — falls back to system `python` on PATH

If your plugin needs a specific runtime version or a dependency not included in the server bundle, bundle it in your plugin's `binaries/` directory and it will take priority.

## How It Works

```
Host (Server or XSD)                Plugin (subprocess)
  │                                     │
  ├── Discovers package.json ───────────┤
  ├── Spawns: node rpc-host.mjs dist/index.js
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
- The SDK handles all JSON-RPC parsing, dispatching, and error handling — you just export a config object with handler functions
- Plugins are auto-restarted up to 3 times on unexpected exit

## Using Third-Party Libraries

Any npm package can be used — esbuild bundles it into your `dist/index.js` automatically. Just install it and import it:

```bash
npm install node-fetch
```

```typescript
import fetch from 'node-fetch';  // Bundled into dist/index.js
```

Since plugins run as Node.js subprocesses (not in a browser), there are no shared dependencies to externalize. Everything gets bundled.

## Quick Start (Testing)

```bash
# Install dependencies and build all plugins
npm install
npm run build

# Test a plugin manually via JSON-RPC
echo '{"jsonrpc":"2.0","method":"getMetadata","params":{},"id":1}' | node packages/sdk/bin/rpc-host.mjs plugins/junctionrelay.system-time/dist/index.js
```

## License

MIT
