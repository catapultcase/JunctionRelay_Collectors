#!/usr/bin/env node

/**
 * RPC Host — wraps a stateless collector plugin in JSON-RPC framing.
 *
 * Usage: node rpc-host.mjs /path/to/plugin/dist/index.js
 *
 * Server spawns this as a child process. The plugin exports a pure config
 * object (metadata + handlers). This script loads it and starts the RPC
 * listener via CollectorPlugin.startRpc().
 */

import { CollectorPlugin } from '../dist/index.js';
import { resolve } from 'node:path';

const pluginPath = process.argv[2];
if (!pluginPath) {
  process.stderr.write('Usage: rpc-host.mjs <plugin-entry>\n');
  process.exit(1);
}

const absolutePath = resolve(pluginPath);
const mod = await import(absolutePath);
const config = mod.default;

if (!config || !config.metadata) {
  process.stderr.write(`Error: Plugin at ${absolutePath} has no default export with metadata\n`);
  process.exit(1);
}

const plugin = new CollectorPlugin(config);
plugin.startRpc();
