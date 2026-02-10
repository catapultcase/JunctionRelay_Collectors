import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DiscoveredPlugin, PluginManifest } from '@junctionrelay/collector-protocol';

/**
 * Discover collector plugins in a directory.
 *
 * Scans three locations:
 * 1. Direct subdirectories of pluginsDir
 * 2. node_modules/@junctionrelay/plugin-*
 * 3. node_modules/junctionrelay-plugin-*
 *
 * A valid plugin must have a package.json with:
 *   "junctionrelay": { "type": "collector" }
 */
export function discoverPlugins(pluginsDir: string): DiscoveredPlugin[] {
  const resolved = path.resolve(pluginsDir);
  const plugins: DiscoveredPlugin[] = [];

  // 1. Direct subdirectories
  if (fs.existsSync(resolved)) {
    for (const entry of safeReaddir(resolved)) {
      const dirPath = path.join(resolved, entry);
      const plugin = tryLoadPlugin(dirPath);
      if (plugin) plugins.push(plugin);
    }
  }

  // 2. node_modules/@junctionrelay/plugin-*
  const scopedDir = path.join(resolved, 'node_modules', '@junctionrelay');
  if (fs.existsSync(scopedDir)) {
    for (const entry of safeReaddir(scopedDir)) {
      if (entry.startsWith('plugin-')) {
        const dirPath = path.join(scopedDir, entry);
        const plugin = tryLoadPlugin(dirPath);
        if (plugin) plugins.push(plugin);
      }
    }
  }

  // 3. node_modules/junctionrelay-plugin-*
  const nodeModulesDir = path.join(resolved, 'node_modules');
  if (fs.existsSync(nodeModulesDir)) {
    for (const entry of safeReaddir(nodeModulesDir)) {
      if (entry.startsWith('junctionrelay-plugin-')) {
        const dirPath = path.join(nodeModulesDir, entry);
        const plugin = tryLoadPlugin(dirPath);
        if (plugin) plugins.push(plugin);
      }
    }
  }

  return plugins;
}

function safeReaddir(dirPath: string): string[] {
  try {
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) return [];
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

function tryLoadPlugin(dirPath: string): DiscoveredPlugin | null {
  const pkgPath = path.join(dirPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;

  try {
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as {
      name?: string;
      version?: string;
      main?: string;
      junctionrelay?: PluginManifest;
    };

    if (!pkg.junctionrelay || pkg.junctionrelay.type !== 'collector') return null;

    const entry = pkg.junctionrelay.entry ?? pkg.main ?? 'index.ts';

    return {
      name: pkg.name ?? path.basename(dirPath),
      version: pkg.version ?? '0.0.0',
      path: dirPath,
      entry,
      manifest: pkg.junctionrelay,
    };
  } catch {
    return null;
  }
}
