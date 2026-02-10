import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { discoverPlugins } from '../discovery.js';

let tmpDir: string;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-test-'));

  // Valid plugin — direct subdirectory
  const validPlugin = path.join(tmpDir, 'my-plugin');
  fs.mkdirSync(validPlugin, { recursive: true });
  fs.writeFileSync(path.join(validPlugin, 'package.json'), JSON.stringify({
    name: '@junctionrelay/plugin-valid',
    version: '1.0.0',
    main: 'index.js',
    junctionrelay: { type: 'collector', entry: 'index.js' },
  }));

  // Invalid plugin — missing junctionrelay field
  const invalidPlugin = path.join(tmpDir, 'not-a-plugin');
  fs.mkdirSync(invalidPlugin, { recursive: true });
  fs.writeFileSync(path.join(invalidPlugin, 'package.json'), JSON.stringify({
    name: 'not-a-plugin',
    version: '1.0.0',
  }));

  // Invalid plugin — wrong type
  const wrongType = path.join(tmpDir, 'wrong-type');
  fs.mkdirSync(wrongType, { recursive: true });
  fs.writeFileSync(path.join(wrongType, 'package.json'), JSON.stringify({
    name: 'wrong-type',
    version: '1.0.0',
    junctionrelay: { type: 'other' },
  }));

  // Valid scoped plugin — node_modules/@junctionrelay/plugin-*
  const scopedPlugin = path.join(tmpDir, 'node_modules', '@junctionrelay', 'plugin-weather');
  fs.mkdirSync(scopedPlugin, { recursive: true });
  fs.writeFileSync(path.join(scopedPlugin, 'package.json'), JSON.stringify({
    name: '@junctionrelay/plugin-weather',
    version: '2.0.0',
    junctionrelay: { type: 'collector' },
  }));

  // Valid unscoped plugin — node_modules/junctionrelay-plugin-*
  const unscopedPlugin = path.join(tmpDir, 'node_modules', 'junctionrelay-plugin-cpu');
  fs.mkdirSync(unscopedPlugin, { recursive: true });
  fs.writeFileSync(path.join(unscopedPlugin, 'package.json'), JSON.stringify({
    name: 'junctionrelay-plugin-cpu',
    version: '0.5.0',
    main: 'dist/index.js',
    junctionrelay: { type: 'collector', entry: 'dist/index.js' },
  }));

  // Non-matching node_modules entry
  const nonMatching = path.join(tmpDir, 'node_modules', 'some-other-package');
  fs.mkdirSync(nonMatching, { recursive: true });
  fs.writeFileSync(path.join(nonMatching, 'package.json'), JSON.stringify({
    name: 'some-other-package',
    version: '1.0.0',
    junctionrelay: { type: 'collector' },
  }));
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('discoverPlugins', () => {
  it('discovers valid direct subdirectory plugins', () => {
    const plugins = discoverPlugins(tmpDir);
    const valid = plugins.find(p => p.name === '@junctionrelay/plugin-valid');
    assert.ok(valid, 'Should find the valid direct subdirectory plugin');
    assert.equal(valid.version, '1.0.0');
    assert.equal(valid.entry, 'index.js');
    assert.deepEqual(valid.manifest, { type: 'collector', entry: 'index.js' });
  });

  it('skips plugins without junctionrelay field', () => {
    const plugins = discoverPlugins(tmpDir);
    const invalid = plugins.find(p => p.name === 'not-a-plugin');
    assert.equal(invalid, undefined, 'Should not find plugin without junctionrelay field');
  });

  it('skips plugins with wrong type', () => {
    const plugins = discoverPlugins(tmpDir);
    const wrong = plugins.find(p => p.name === 'wrong-type');
    assert.equal(wrong, undefined, 'Should not find plugin with wrong type');
  });

  it('discovers scoped @junctionrelay/plugin-* packages', () => {
    const plugins = discoverPlugins(tmpDir);
    const scoped = plugins.find(p => p.name === '@junctionrelay/plugin-weather');
    assert.ok(scoped, 'Should find scoped plugin');
    assert.equal(scoped.version, '2.0.0');
    assert.equal(scoped.entry, 'index.ts');  // default entry
  });

  it('discovers unscoped junctionrelay-plugin-* packages', () => {
    const plugins = discoverPlugins(tmpDir);
    const unscoped = plugins.find(p => p.name === 'junctionrelay-plugin-cpu');
    assert.ok(unscoped, 'Should find unscoped plugin');
    assert.equal(unscoped.version, '0.5.0');
    assert.equal(unscoped.entry, 'dist/index.js');
  });

  it('does not discover non-matching node_modules packages', () => {
    const plugins = discoverPlugins(tmpDir);
    const nonMatching = plugins.find(p => p.name === 'some-other-package');
    assert.equal(nonMatching, undefined, 'Should not find non-matching package');
  });

  it('returns empty array for non-existent directory', () => {
    const plugins = discoverPlugins('/tmp/does-not-exist-abc123');
    assert.deepEqual(plugins, []);
  });

  it('returns total of 3 valid plugins', () => {
    const plugins = discoverPlugins(tmpDir);
    assert.equal(plugins.length, 3);
  });
});
