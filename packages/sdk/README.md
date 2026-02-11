# @junctionrelay/collector-sdk

SDK for building JunctionRelay collector plugins. Handles all JSON-RPC communication — you just write the business logic.

## Install

```bash
npm install @junctionrelay/collector-sdk
```

## Usage

```typescript
import { CollectorPlugin } from '@junctionrelay/collector-sdk';

new CollectorPlugin({
  metadata: {
    collectorName: 'MyPlugin',
    displayName: 'My Plugin',
    description: 'What this collects',
    category: 'Cloud Services',
    emoji: '📡',
    fields: { requiresUrl: true, requiresAccessToken: false },
    defaults: { name: 'My Plugin', pollRate: 5000 },
    setupInstructions: [],
  },

  async fetchSensors(config) {
    const resp = await fetch(config.url!);
    const data = await resp.json();
    return {
      sensors: [{
        uniqueSensorKey: 'my_value',
        name: 'My Value',
        value: String(data.value),
        unit: '',
        category: 'Stats',
        decimalPlaces: 0,
        sensorType: 'Numeric',
        componentName: 'MyPlugin',
        sensorTag: 'my_value',
      }],
    };
  },
});
```

## What the SDK Handles

- stdin/stdout JSON-RPC 2.0 framing
- Method routing (`getMetadata`, `configure`, `fetchSensors`, etc.)
- Config storage from `configure()` — passed to all handler methods
- Auto-implementation of `fetchSelectedSensors` (filters by `uniqueSensorKey`)
- Health check responses
- Error serialization
- Graceful shutdown on SIGTERM
- Logging via `process.stderr` (keeps stdout clean for protocol)

## Exports

```typescript
// Base class
import { CollectorPlugin } from '@junctionrelay/collector-sdk';

// Helpers
import { getDecimalPlaces, sanitizeSensorValue, safeRound } from '@junctionrelay/collector-sdk';

// Types (re-exported from @junctionrelay/collector-protocol)
import type { SensorResult, ConfigureParams, CollectorMetadata } from '@junctionrelay/collector-sdk';
```

## Bundle All Dependencies

**Plugins must be fully self-contained.** Do not assume anything is installed on the user's machine beyond Node.js.

- **npm dependencies** — Use esbuild to inline all npm packages into a single `dist/index.js`. No `node_modules` at runtime.
- **Python, native binaries, runtimes** — Bundle them inside your plugin folder (e.g., `binaries/python/`, `binaries/gpu-reader.exe`). The user should be able to drop your plugin folder into the collectors directory and have it work immediately.

```
my-plugin/
├── package.json
├── dist/index.js          ← esbuild bundle (SDK + deps inlined)
├── python/                ← (if needed) Python scripts
└── binaries/              ← (if needed) portable runtimes, native binaries
```

Build command:

```bash
esbuild src/index.ts --bundle --platform=node --format=esm --outfile=dist/index.js
```

## License

MIT
