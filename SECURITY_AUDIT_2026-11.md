# Security Audit — JunctionRelay_Collectors

- **Report date:** 2026-11-16
- **Audit yardstick:** 2026-11-15 severity definitions
- **Commit audited:** `5abb650` (`origin/main`)
- **Scope:** tracked source, manifests, lockfile, tests, packaging script, and bundled Python in this repository. Read-only: no source, test, fixture, or build files were changed by this audit.
- **Result:** 0 High, 2 Medium, 3 Low.

## Severity yardstick used

- **High:** an unauthenticated or remote attacker gets code execution, credentials, or an auth bypass.
- **Medium:** the attacker needs some access or a user action, or the impact is limited.
- **Low:** hardening, or the attacker needs local or admin access.

## Findings

### F-01 — Medium — Generic API collector forwards credentials to a caller-chosen URL (SSRF / credential exfiltration)

- **Files/lines:** `plugins/junctionrelay.generic-api/src/index.ts:43-48`, `:100-103`, `:127-130`
- **Confirmed:** yes, in code.
- **What goes wrong:** `extractConfig()` accepts `config.url` verbatim; both `testConnection()` and `fetchSensors()` call `fetch(apiUrl, ...)` and send the configured access token in the `X-Collector-Token` header. There is no scheme, host, private-address, or redirect check. An attacker who can influence collector configuration (for example, a lower-privileged UI user or a compromised server-side config path) can make the host issue GET requests to internal or attacker-controlled endpoints and can receive the token at an attacker-controlled origin. Plain `http://` URLs are also accepted, exposing the token in transit. Node/undici follows redirects by default, so an allowed-looking first URL can redirect to another origin.
- **What an attacker would need:** the ability to set or alter this collector's URL (authenticated configuration access, or control of the server/config store).
- **One-line fix:** validate the URL on every hop (https-only by default, block private/link-local/metadata ranges unless explicitly allowlisted) and never forward the token to an origin that was not explicitly trusted.

### F-02 — Medium — Home Assistant collector sends a bearer token to a caller-chosen URL

- **Files/lines:** `plugins/junctionrelay.home-assistant/src/index.ts:46-51`, `:14-20`, `:97-102`, `:116`
- **Confirmed:** yes, in code.
- **What goes wrong:** `extractConfig()` accepts `config.url` verbatim as `baseUrl`, and `fetchStates()`/`testConnection()` send the long-lived access token as `Authorization: Bearer ...` to that URL. There is no validation of scheme, host, or redirect target. The default manifest URL is `http://192.168.1.100:8123`, so the token can be sent in cleartext. An attacker who can change the collector URL can redirect the stored token to their own endpoint, or use the host as an SSRF pivot. Redirects are followed by default.
- **What an attacker would need:** the ability to set or alter this collector's URL (authenticated configuration access, or control of the server/config store).
- **One-line fix:** validate the base URL and redirect targets, require https or an explicit local-network opt-in, and do not send the token to a host that was not explicitly trusted by the user.

### F-03 — Low — Internet Time fallback uses cleartext HTTP

- **File/line:** `plugins/junctionrelay.internet-time/src/index.ts:74`
- **Confirmed:** yes, in code.
- **What goes wrong:** the `WorldClockAPI` fallback fetches `http://worldclockapi.com/api/json/utc/now` without TLS. A network-position attacker can modify the returned time and influence the collector's time sensors. This does not change the host system clock, so impact is limited to reported data.
- **What an attacker would need:** a man-in-the-middle position on the network path to that endpoint.
- **One-line fix:** remove the cleartext fallback or use an HTTPS-only time source.

### F-04 — Low — Pack script trusts `collectorName` and can write outside the plugin directory

- **Files/lines:** `scripts/pack.mjs:15`, `:30-31`, `:138`
- **Confirmed:** yes, in code.
- **What goes wrong:** `pluginName` is read from `package.json` (`junctionrelay.collectorName`) without validation. It is interpolated into ZIP entry names and into the output path `join(pluginDir, \`${pluginName}.zip\`)`. A malicious or malformed `collectorName` containing `../` or path separators can cause `writeFileSync` to write outside the plugin directory and can create unsafe ZIP entry names for consumers that extract without normalizing paths. `PLUGIN_ID_PATTERN` already exists in `packages/protocol/src/index.ts:16` but is not used here.
- **What an attacker would need:** the ability to supply a malicious plugin manifest and get a maintainer or build job to run the pack script (local user action).
- **One-line fix:** reject any `collectorName` that does not match `PLUGIN_ID_PATTERN`, and verify the resolved output path stays inside `pluginDir`.

### F-05 — Low — Vulnerable development dependency: esbuild 0.27.3

- **Files/lines:** `package-lock.json:81`, `:83`; declared in `package.json:17`
- **Confirmed:** yes, via `npm audit --json` from the lockfile.
- **What goes wrong:** `npm audit` reports one low-severity advisory, `GHSA-g7r4-m6w7-qqqr` (CWE-22), affecting `esbuild >=0.27.3 <0.28.1`: arbitrary file read when running the development server on Windows. CVSS is 2.5 (local, high complexity). The installed version is 0.27.3; the suggested fix is 0.28.2 (semver-major). This is a development-only dependency, not shipped in plugin bundles.
- **What an attacker would need:** local access to a Windows development environment running the esbuild development server.
- **One-line fix:** upgrade esbuild to `>=0.28.1` and regenerate the lockfile.

## Coverage and areas with no finding

### Plugin code loading and execution

Checked `packages/sdk/src/index.ts`, `packages/sdk/src/CollectorPlugin.ts`, every plugin entry point, the README runtime description, and `scripts/pack.mjs`.

- No `eval`, `new Function`, dynamic `require()`, or runtime `import()` of a path or module name chosen at runtime exists in tracked source. The only `import()` in the repository is in a README manual test command with a fixed path.
- The SDK's child side reads one JSON object per line from stdin and dispatches through a fixed `switch` of known method names (`CollectorPlugin.ts:109-172`); it does not invoke methods by caller-supplied name.
- The host-side RPC runner referenced by the documentation and by `package-lock.json:186-188` (`packages/sdk/bin/rpc-host.mjs`) is **not present in this repository**. Host-side plugin discovery, entry-path resolution, and signature/integrity checks therefore could not be audited here. This is an audit limitation, not a finding.
- Shipped plugins export plain config objects; the `CollectorPlugin` constructor's `collectorName` validation (`CollectorPlugin.ts:32-41`) only runs for callers that instantiate the class (the test fixture does). Host-side manifest validation is external to this repository.

### Input from the server and the network

Checked RPC parsing/dispatch in `CollectorPlugin.ts:73-172`, all `ConfigureParams` consumers, and every URL/file path passed to `fetch`, `spawn`, `subprocess`, or filesystem APIs.

- RPC messages are parsed with `JSON.parse` and the method is a fixed switch. `params` are cast rather than schema-validated, but the only writer to the plugin's stdin is the parent host process, so this is not a separate privilege boundary. A malformed `sensorIds` or missing `id` can produce an error response, not code execution.
- Plugin IDs and names: `PLUGIN_ID_PATTERN` (`packages/protocol/src/index.ts:16`) enforces the namespaced lowercase-kebab-case format, and the SDK constructor enforces it. `isPluginCollectorName()` only checks for a dot (`:22-24`) and is not used as a security check in this repository. The pack script does not validate the name (see F-04). Host discovery validation is not in this repository.
- URLs: the Generic API and Home Assistant findings above cover the caller-chosen URL cases. OpenWeather uses a fixed `https://api.openweathermap.org` base and URL-encodes the city and key; Claude uses a fixed `https://api.anthropic.com` base. Internet Time uses fixed endpoints, with the cleartext issue in F-03.

### Process spawning and file writes

Checked `plugins/junctionrelay.host-windows/src/index.ts`, `plugins/junctionrelay.host-windows/python/metrics_collector.py`, and `scripts/pack.mjs`.

- `host-windows` spawns a fixed plugin-relative path, `binaries/python/python.exe`, with a fixed script argument array and no shell (`index.ts:41-47`, `:76-79`). The path is not derived from server or network input.
- The Python bridge runs `sys.executable -m pip install --user` only for wheels found in its own fixed `python/wheels` directory (`metrics_collector.py:32-46`), and runs `gpu-reader.exe` from the plugin-set `PLUGIN_BINARIES_PATH` (`:199-229`). There is no network-controlled command or path. Installing local wheels without a hash requires pre-existing write access to the plugin directory, which already permits modifying plugin code, so this is not counted as an additional finding.
- The only tracked file write is `scripts/pack.mjs:139`; its path traversal issue is F-04. No plugin writes files from server or network input.

### Outbound HTTP, SSRF, and TLS

Checked every `fetch` call, the Python subprocess/network usage, and configuration for certificate checks.

- Caller-chosen URLs: F-01 and F-02.
- Cleartext HTTP: F-03.
- No `rejectUnauthorized`, `NODE_TLS_REJECT_UNAUTHORIZED`, `strictSSL`, custom `Agent`, or certificate-validation bypass exists in tracked source.

### Tokens or keys written to logs

Checked all `process.stderr`, `console`, Python `print`/`stderr`, and error-return paths.

- No access token, API key, password, or authorization header is logged. Plugin errors returned to the host can include HTTP status text or fetch error messages, but no credential value is included. Placeholder strings in manifests are not credentials.

### Dependencies

- A lockfile is present: `package-lock.json` (`lockfileVersion: 3`).
- `npm audit` ran successfully from the lockfile. It reports one low-severity advisory, described in F-05. There are no moderate, high, or critical advisories.
- `preinstall`, `install`, and `postinstall` scripts: none are declared in the root or workspace `package.json` files. The lockfile marks `esbuild` with `hasInstallScript: true` (`package-lock.json:83`); it is the only install-script entry in the lockfile. No other dependency lifecycle scripts were found.

### Secrets committed in the tree

Checked all tracked files for API-key, token, password, private-key, cloud-key, and JWT patterns.

- No committed secret value was found. The only matching strings are manifest placeholders such as access-token placeholder text, not real credentials. No file, line, or value is reported because there is no secret.

## Test status

Command used on both branches:

```bash
set -e; npm ci; npm run build; npm test
```

- **Branch `cs/t62-a3`** (one report-only commit on top of `5abb650`), 2026-11-16: `npm ci` completed, build completed, tests **27/27 passing**, 0 failing. `npm ci` also reported the one low-severity esbuild advisory described in F-05.
- **`main`** (commit `5abb650`), 2026-11-16: `npm ci` completed, build completed, tests **27/27 passing**, 0 failing.

No test files, test configuration, fixtures, or source were changed by this audit.
