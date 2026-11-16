# Security Audit — JunctionRelay_Collectors — 2026-11

Date: 2026-11-16
Scope: this repository only (`packages/protocol`, `packages/sdk`, `plugins/*`, `scripts/`, package manifests and lockfile).
Method: read-only review of tracked source and manifests, plus local execution of the repository's build and test commands and `npm audit` checks.

This audit changed no production code, lockfiles or build output. A pre-existing test-fixture defect was corrected in test files only so the repository's suite can run (see Test status); no test case or assertion was removed or weakened.

This report contains no secret values. It lists locations, kinds of issue, severity, attacker prerequisites, confirmation status, and suggested fixes.

## Summary

| Severity | Findings |
| --- | --- |
| High | 0 |
| Medium | 2 |
| Low | 6 |
| Total | 8 |

## Findings

### F-01 — Medium — SSRF and access-token exfiltration in Generic API plugin

- Location: `plugins/junctionrelay.generic-api/src/index.ts:43-47`, `:100-102`, `:127-129`
- Kind: outbound HTTP to a caller-chosen URL (SSRF); the configured access token is sent to that URL; redirects are not constrained.
- Attacker would need: the ability to set or influence the collector URL (for example through stored collector configuration, a malicious configuration import, or a compromised management UI). The configured access token is then sent as the `X-Collector-Token` header to that origin.
- Confirmation: confirmed in code. The URL is taken from `config.url` without scheme, host or destination validation, and the same value is passed directly to `fetch` with the token header in both `testConnection` and `fetchSensors`.
- Suggested fix: allowlist `http`/`https`, reject loopback/private/link-local/metadata destinations, validate every redirect target, and never send the token to an origin outside the validated endpoint.

### F-02 — Medium — SSRF and bearer-token exfiltration in Home Assistant plugin

- Location: `plugins/junctionrelay.home-assistant/src/index.ts:14-20`, `:46-50`, `:97-101`, `:116`, `:124`
- Kind: outbound HTTP to a caller-chosen base URL (SSRF); the configured long-lived token is sent to that URL; redirects are not constrained.
- Attacker would need: the ability to set or influence the Home Assistant base URL. The configured token is then sent in the `Authorization: Bearer` header to that origin.
- Confirmation: confirmed in code. The base URL comes from `config.url` without validation and is concatenated with API paths before being passed to `fetch` with the token header.
- Suggested fix: allowlist `http`/`https`, reject loopback/private/link-local/metadata destinations, validate redirect targets, and do not forward the token to an origin outside the validated base URL.

### F-03 — Low — Unvalidated `collectorName` used in pack output path and ZIP entry names

- Location: `scripts/pack.mjs:15`, `:29-31`, `:40-49`, `:138-139`
- Kind: path traversal / ZIP-slip risk; symlinks under `python/` are followed and their targets read into the archive.
- Attacker would need: the ability to supply a malicious plugin `package.json` or plugin tree to a maintainer or CI process that runs `npm run pack`. Whether the consuming host sanitizes ZIP entry names during extraction is unconfirmed because that code is not in this repository.
- Confirmation: confirmed in this repository that `junctionrelay.collectorName` is used without validation in archive entry names and in the output filename, and that non-directory entries (including symlinks) are read into the archive. Downstream extraction behavior is unconfirmed.
- Suggested fix: validate `collectorName` with `PLUGIN_ID_PATTERN`, reject absolute paths and `..` segments, contain the resolved output path inside the plugin directory, and skip symlinks when collecting files.

### F-04 — Low — Plaintext HTTP time source

- Location: `plugins/junctionrelay.internet-time/src/index.ts:74`
- Kind: transport integrity/TLS not used; the WorldClockAPI fallback is fetched over plain `http`.
- Attacker would need: a network position on the path to that host (for example a hostile Wi-Fi access point or proxy) to alter the time returned to the collector.
- Confirmation: confirmed in code.
- Suggested fix: use an HTTPS endpoint for this source or remove the plaintext fallback.

### F-05 — Low — esbuild advisory in a development dependency

- Location: `package.json:16`; `package-lock.json:80-83`
- Kind: dependency risk. Online `npm audit` reports GHSA-g7r4-m6w7-qqqr (low): the esbuild development server allows arbitrary file read on Windows. The installed version is 0.27.3. esbuild is a devDependency and has an install script; it is not bundled into runtime plugin code.
- Attacker would need: local use of the affected esbuild development server on Windows, not a remote plugin consumer.
- Confirmation: confirmed by online `npm audit` against the installed dependency tree. `npm audit --offline` reported no advisories because the offline advisory database was unavailable.
- Suggested fix: upgrade esbuild to at least 0.28.1 (0.28.2 is the audit's proposed fix) and rebuild.

### F-06 — Low — Registry lockfile entries lack resolved URLs and integrity hashes

- Location: `package-lock.json:72-173` (the third-party registry entries, including `@types/node`, `esbuild`, `get-tsconfig`, `resolve-pkg-maps`, `tsx`, `typescript` and `undici-types`)
- Kind: dependency integrity. Workspace entries are linked locally, but third-party packages are pinned only by version, without `resolved` or `integrity` fields.
- Attacker would need: control of the registry response or the network path during `npm ci`/`npm install`.
- Confirmation: confirmed by inspection of the committed lockfile.
- Suggested fix: regenerate the lockfile with a normal `npm install` so registry packages include `resolved` and `integrity`, then commit it.

### F-07 — Low — SDK does not validate the JSON-RPC envelope before use

- Location: `packages/sdk/src/CollectorPlugin.ts:73-106` (notably `:77`, `:88`, `:100`)
- Kind: untrusted input handling / robustness. After `JSON.parse`, the SDK assumes the value is an object with `method`, `params` and `id`. A `null` request causes an uncaught exception while reading `request.method` and again while constructing the error response from `request.id`, so no JSON-RPC error is returned. Arrays and primitives can also produce malformed responses.
- Attacker would need: the ability to write lines to a plugin's stdin (the parent host or another local process with access to the pipe).
- Confirmation: confirmed in code.
- Suggested fix: validate that the parsed value is an object, `method` is a string, `params` is an object, and `id` is a string/number/null; otherwise return JSON-RPC `INVALID_REQUEST` (`-32600`).

### F-08 — Low — Test helper spawns a shell with a path-derived argument

- Location: `packages/sdk/src/__tests__/CollectorPlugin.test.ts:12-16`
- Kind: command injection, test-only. `spawn('npx', ['tsx', fixturePath], { shell: true })` passes the fixture path through a shell.
- Attacker would need: control of the checkout or fixture path such that it contains shell metacharacters.
- Confirmation: confirmed in test code. The spawn helper itself was not changed; only the fixture name and its matching assertion were corrected (see Test status).
- Suggested fix: spawn with `shell: false` (or use `execFile`/the local `tsx` binary directly) and pass the path as a separate argument.

## Areas checked with no findings

- Committed secrets or credentials: none found in tracked files. The token-related strings present are documentation placeholders and configuration field names, not live credentials. No values are reproduced here.
- Fixed outbound HTTP destinations: Claude uses a fixed HTTPS API origin; OpenWeather uses a fixed HTTPS origin and encodes the city and key; Internet Time uses fixed sources (the plaintext source is F-04); System Time performs no network I/O.
- TLS/certificate verification: no code disables certificate validation (`rejectUnauthorized`, `NODE_TLS_REJECT_UNAUTHORIZED`, or equivalent).
- Unsafe deserialization or eval: no `eval`, `new Function`, `pickle`, unsafe YAML load, or dynamic code execution. Parsing is limited to JSON (`JSON.parse` in TypeScript and `json.loads` in Python).
- Command/process execution: `host-windows` spawns a fixed bundled Python path with an argument array and no shell; the Python collector uses `subprocess.run`/`subprocess.check_call` with argument arrays and no shell. No user-controlled command strings are constructed. (The test-only shell use is F-08.)
- Path traversal: `host-windows` uses fixed plugin-relative paths and fixed sysfs paths; no configuration-derived filesystem paths. The pack script is covered by F-03.
- Logging of tokens or keys: no explicit token/key logging found. Plugin error paths return HTTP status messages rather than credentials, and the SDK writes only handler error messages to stderr.
- Untrusted network response parsing: plugin responses are parsed as JSON without eval; malformed shapes throw and are surfaced as JSON-RPC errors rather than executing code.
- Protocol package: constants and TypeScript types only; no I/O or security-sensitive runtime behavior.
- SDK numeric helpers: decimal-place detection, clamping, rounding, and formatting only; no security-sensitive behavior.
- Dependency risk: a lockfile is present. `npm audit --offline` from the lockfile reported no advisories because the offline advisory database was unavailable; online `npm audit` reported the single low esbuild advisory in F-05. Only esbuild declares an install script among the dependencies; workspace packages have none. F-06 covers missing integrity metadata.
- Shaders `serve.py`/`test.html`: not part of this repository; covered by the JunctionRelay_Shaders run.

## Test status

The security review changed no production code. The repository's own test command does **not** pass on the base branch; that pre-existing failure was corrected with a minimal test-only change so the suite can run.

- On `main`, `set -e; npm ci; npm run build; npm test` completes `npm ci` and `npm run build` successfully, then `npm test` fails with exit code 1: 27 tests, 20 pass, 7 fail. All 7 failures are in the `CollectorPlugin integration` suite.
- Root cause (confirmed by running the base-branch command): the test fixture `packages/sdk/src/__tests__/fixture-plugin.ts:7` sets `collectorName: 'TestPlugin'`, which does not match `PLUGIN_ID_PATTERN` in `packages/protocol/src/index.ts:16`. The `CollectorPlugin` constructor (`packages/sdk/src/CollectorPlugin.ts:34`) therefore throws, the spawned fixture process exits before becoming ready, and the JSON-RPC round-trip tests time out.
- Correction: the fixture's `collectorName` was changed to the valid namespaced id `test.test-plugin`, and the one `getMetadata` assertion that echoed the old value (`packages/sdk/src/__tests__/CollectorPlugin.test.ts:79`) was updated to match. No test case, assertion strength, production code, lockfile or build output was removed or weakened. This was a pre-existing test-harness defect, not a security finding, and no security finding was fixed.
- On this PR branch, `set -e; npm ci; npm run build; npm test` passes: 27 tests, 27 pass, 0 fail.

## Pull request description

- Findings: High 0, Medium 2, Low 6.
- Test result: `set -e; npm ci; npm run build; npm test` passes (27 tests: 27 pass, 0 fail). On `main` the same command fails with 7 pre-existing SDK fixture failures; this PR corrects the fixture name and its matching assertion in test code only, without weakening any test.
