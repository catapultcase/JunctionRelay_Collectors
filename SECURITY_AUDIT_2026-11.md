# Security Audit — JunctionRelay_Collectors — 2026-11

Date: 2026-11-16
Scope: this repository only (packages/protocol, packages/sdk, plugins/*, scripts/, package manifests/lockfile).
Method: read-only review of tracked source and manifests, plus local execution of the built plugins against a loopback HTTP server and offline/online npm audit checks.

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

- Location: `plugins/junctionrelay.generic-api/src/index.ts:43-47`, `:100-103`, `:127-130`
- Kind: outbound HTTP to caller-chosen URL (SSRF); credential sent to that URL; redirects not constrained.
- Attacker would need: the ability to set or influence the collector URL (for example via stored collector configuration, a malicious configuration import, or a compromised management UI). The configured access token is then sent as `X-Collector-Token` to that origin.
- Confirmation: confirmed in code, and confirmed at runtime by pointing the built plugin at a loopback HTTP server, which received the token header and the request.
- Suggested fix: allowlist `http`/`https`, reject loopback/private/link-local/metadata destinations, validate every redirect target, and never send the token to an origin outside the configured/validated endpoint.

### F-02 — Medium — SSRF and bearer-token exfiltration in Home Assistant plugin

- Location: `plugins/junctionrelay.home-assistant/src/index.ts:14-20`, `:46-51`, `:97-102`, `:116`, `:124`
- Kind: outbound HTTP to caller-chosen base URL (SSRF); bearer token sent to that URL; redirects not constrained.
- Attacker would need: the ability to set or influence the Home Assistant base URL. The configured long-lived token is then sent in the `Authorization` header to that origin.
- Confirmation: confirmed in code, and confirmed at runtime by pointing the built plugin at a loopback HTTP server, which received the bearer token and the request.
- Suggested fix: allowlist `http`/`https`, reject loopback/private/link-local/metadata destinations, validate redirect targets, and do not forward the token to an origin outside the validated base URL.

### F-03 — Low — Unvalidated `collectorName` used in pack output path and ZIP entry names

- Location: `scripts/pack.mjs:15`, `:29-31`, `:43`, `:47`, `:138-139`
- Kind: path traversal / ZIP-slip risk; symlinks under `python/` are followed and their targets read into the archive.
- Attacker would need: the ability to supply a malicious plugin `package.json`/plugin tree to a maintainer or CI process that runs `npm run pack`. Whether the consuming host sanitizes ZIP entry names during extraction is unconfirmed because that code is not in this repository.
- Confirmation: confirmed in this repository that `junctionrelay.collectorName` is used without validation in archive entry names and in the output filename, and that non-directory entries (including symlinks) are read into the archive.
- Suggested fix: validate `collectorName` with `PLUGIN_ID_PATTERN`, reject absolute paths and `..` segments, contain the resolved output path inside the plugin directory, and skip symlinks when collecting files.

### F-04 — Low — Plaintext HTTP time source

- Location: `plugins/junctionrelay.internet-time/src/index.ts:74`
- Kind: transport integrity/TLS not used; the WorldClockAPI fallback is fetched over plain `http`.
- Attacker would need: a network position on the path to that host (for example a hostile Wi-Fi access point or proxy) to alter the time returned to the collector.
- Confirmation: confirmed in code.
- Suggested fix: use an HTTPS endpoint for this source or remove the plaintext fallback.

### F-05 — Low — esbuild advisory in development dependency

- Location: `package.json:16`; `package-lock.json:80-83`
- Kind: dependency risk. `npm audit` reports GHSA-g7r4-m6w7-qqqr (low): esbuild development server allows arbitrary file read on Windows. esbuild is a devDependency and has an install script; it is not bundled into runtime plugin code.
- Attacker would need: local use of the affected esbuild development server on Windows, not a remote plugin consumer.
- Confirmation: confirmed by npm audit against the installed dependency tree.
- Suggested fix: upgrade esbuild to at least 0.28.1 (0.28.2 is the audit's proposed fix) and rebuild.

### F-06 — Low — Registry lockfile entries lack resolved URLs and integrity hashes

- Location: `package-lock.json:72-79`, `:80-90`, and the other third-party registry entries
- Kind: dependency integrity. Workspace entries are linked locally, but third-party packages are pinned only by version, without `resolved` or `integrity` fields.
- Attacker would need: control of the registry response or the network path during `npm ci`/`npm install`.
- Confirmation: confirmed by inspection of the committed lockfile.
- Suggested fix: regenerate the lockfile with a normal `npm install` so registry packages include `resolved` and `integrity`, then commit it.

### F-07 — Low — SDK does not validate the JSON-RPC envelope before use

- Location: `packages/sdk/src/CollectorPlugin.ts:73-100`
- Kind: untrusted input handling / robustness. After `JSON.parse`, the SDK assumes the value is an object with `method`, `params`, and `id`. Inputs such as `null`, an array, or a primitive cause an uncaught exception while constructing the error response, so no JSON-RPC error is returned.
- Attacker would need: the ability to write lines to a plugin's stdin (the parent host or another local process with access to the pipe).
- Confirmation: confirmed in code.
- Suggested fix: validate that the parsed value is an object, `method` is a string, `params` is an object, and `id` is a string/number/null; otherwise return JSON-RPC `INVALID_REQUEST` (`-32600`).

### F-08 — Low — Test helper spawns a shell with a path-derived argument

- Location: `packages/sdk/src/__tests__/CollectorPlugin.test.ts:12-16`
- Kind: command injection, test-only. `spawn('npx', ['tsx', fixturePath], { shell: true })` passes the fixture path through a shell.
- Attacker would need: control of the checkout or fixture path such that it contains shell metacharacters.
- Confirmation: confirmed in code.
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
- Dependency risk: a lockfile is present. `npm audit --offline` from the lockfile reported no advisories because the offline advisory database was unavailable; online `npm audit` reported the single low esbuild advisory in F-05. Only esbuild declares an install script among the dependencies; workspace packages have none.
- Shaders `serve.py`/`test.html`: not part of this repository; covered by the JunctionRelay_Shaders run.

## Test status

The base branch test failure was caused by the SDK fixture plugin using the non-namespaced `collectorName` `TestPlugin`, which the namespaced `PLUGIN_ID_PATTERN` rejects before the spawned process can answer. The fixture was corrected to a valid namespaced identifier and the matching assertion updated; no production code was changed. `npm ci`, `npm run build`, and `npm test` now pass (27 tests, 0 failures).
