import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packScript = join(repoRoot, 'scripts', 'pack.mjs');

function createPluginDir(collectorName) {
  const dir = mkdtempSync(join(tmpdir(), 'junctionrelay-pack-test-'));
  mkdirSync(join(dir, 'dist'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'test-plugin', junctionrelay: { collectorName } }, null, 2)
  );
  writeFileSync(join(dir, 'dist', 'index.js'), 'export default {};\n');
  return dir;
}

function findZips(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findZips(fullPath));
    } else if (entry.name.endsWith('.zip')) {
      found.push(fullPath);
    }
  }
  return found;
}

function assertNoZipAtOrAbove(dir, expectedZipName) {
  assert.deepEqual(findZips(dir), [], `unexpected .zip file under ${dir}`);

  const zipBasename = expectedZipName.split(/[\\/]/).pop();
  let current = dirname(dir);
  while (true) {
    const candidate = join(current, zipBasename);
    assert.equal(existsSync(candidate), false, `unexpected .zip file at ${candidate}`);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

test('rejects invalid collectorName without writing a zip', (t) => {
  for (const collectorName of ['Bad.Name', '../evil.x', 'noDot']) {
    const pluginDir = createPluginDir(collectorName);
    t.after(() => rmSync(pluginDir, { recursive: true, force: true }));

    const result = spawnSync(process.execPath, [packScript], {
      cwd: pluginDir,
      encoding: 'utf8',
    });

    assert.notEqual(result.status, 0, `expected non-zero exit for ${collectorName}`);
    assertNoZipAtOrAbove(pluginDir, `${collectorName}.zip`);
  }
});

test('packs a valid collectorName', (t) => {
  const collectorName = 'test.valid-name';
  const pluginDir = createPluginDir(collectorName);
  t.after(() => rmSync(pluginDir, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [packScript], {
    cwd: pluginDir,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(pluginDir, `${collectorName}.zip`)), true);
});

test('package scripts are cross-platform and plugins declare esbuild', () => {
  const packageDirs = [
    ...readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(repoRoot, 'packages', entry.name)),
    ...readdirSync(join(repoRoot, 'plugins'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(repoRoot, 'plugins', entry.name)),
  ];

  for (const packageDir of packageDirs) {
    const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));

    for (const [name, value] of Object.entries(pkg.scripts ?? {})) {
      assert.equal(
        typeof value === 'string' && value.includes('rm -rf'),
        false,
        `${packageDir} script "${name}" uses rm -rf`
      );
    }

    if (packageDir.startsWith(join(repoRoot, 'plugins'))) {
      assert.equal(
        typeof pkg.devDependencies?.esbuild,
        'string',
        `${packageDir} does not declare esbuild in devDependencies`
      );
    }
  }
});
