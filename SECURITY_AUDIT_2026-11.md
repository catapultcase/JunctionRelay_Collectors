# Security Audit — JunctionRelay_Collectors (November 2026)

Read-only security review of the `JunctionRelay_Collectors` repository. This is a
manual, source-level audit; **no code, tests, fixtures, lockfiles or build output
were changed** — this file is the only artifact added. It complements the
2026-11-15 audit, which did not cover this repository.

- Repo: `JunctionRelay_Collectors` (npm workspaces: `packages/protocol`,
  `packages/sdk`, and seven collector plugins under `plugins/`).
- Scope of code: the collector SDK (`packages/sdk`), the protocol types
  (`packages/protocol`), the plugin packaging script (`scripts/pack.mjs`), and
  the seven shipped collector plugins: system-time, internet-time, open-weather,
  generic-api, home-assistant, claude, host-windows.
- Threat model note: a collector plugin runs as a child process spawned by the
  JunctionRelay host and receives `config.url` / `config.accessToken` from the
  collector configuration a user set in the host UI, delivered over the plugin's
  stdin/stdout JSON-RPC channel (see `README.md`). Where a plugin issues outbound
  HTTP, the destination and the attached credential come from that
  user-configured value. The findings below are graded assuming an attacker can
  *influence the collector URL / configuration* (e.g. a hosted or multi-tenant
  JunctionRelay, an imported/shared/auto-provisioned collector, or a tampered
  plugin manifest) without already owning the host. Where the only way to reach a
  code path is full local control of the host or its install tree, that is stated
  as the attacker prerequisite.

## Severity rubric

The 2026-11-15 audit is not part of this repository, so its exact wording is not
available here. The same High/Medium/Low yardstick is applied by impact and the
attacker prerequisite required to reach it:

- **High** — reachable by a low-privilege actor (e.g. someone who can set/influence
  a collector's config) and directly yields credential theft, access to internal
  or protected resources, or code execution.
- **Medium** — requires an added precondition (local filesystem write to the
  install tree, a privileged position, log/history access, etc.) but has meaningful
  impact once met.
- **Low** — hardening / defense-in-depth, minimal impact, or advisory that does not
  affect shipped runtime code.

## Findings

| # | Severity | Area | Location |
|---|----------|------|----------|
| 1 | High | SSRF + long-lived bearer token sent to a caller-chosen host (cleartext default) | `plugins/junctionrelay.home-assistant/src/index.ts` |
| 2 | High | SSRF + access token sent to a caller-chosen host; response reflected | `plugins/junctionrelay.generic-api/src/index.ts` |
| 3 | Medium | Execution of bundled native binaries / auto-installed wheels with no integrity check | `plugins/junctionrelay.host-windows/` |
| 4 | Low | API key carried in the URL query string | `plugins/junctionrelay.open-weather/src/index.ts` |
| 5 | Low | Time source fetched over cleartext HTTP | `plugins/junctionrelay.internet-time/src/index.ts` |
| 6 | Low | Dependency advisory in a devDependency (esbuild) | `package-lock.json` |

---

### Finding 1 — Home Assistant: SSRF + long-lived token to a caller-chosen host (High)

- **Location:** `plugins/junctionrelay.home-assistant/src/index.ts:46-51`
  (`extractConfig` — `baseUrl` taken verbatim from `config.url`, no scheme/host
  validation); `:14-27` (`fetchStates` — builds `${baseUrl}/api/states` and attaches
  `Authorization: Bearer <token>`); `:97-99` (`testConnection` fetches
  `${baseUrl}/api/` with the same bearer header); cleartext default
  `url: 'http://192.168.1.100:8123'` at `:70` (and `:64`).
- **Severity:** High.
- **What an attacker needs:** ability to set or influence the collector's URL
  (config write in a hosted/multi-tenant deployment, an imported/shared/auto-filled
  collector, or a tampered plugin manifest default). No other precondition: the value
  is used verbatim as the fetch target.
- **Confirmed in code:** Yes.
- **Issue:** The configured URL is concatenated straight into a `fetch()` target with
  no scheme restriction and no host/allowlist / loopback / link-local check, so the
  plugin (running on the JunctionRelay host, with LAN and localhost reachability) will
  request arbitrary internal endpoints — a classic SSRF (e.g.
  `http://169.254.169.254/...`, internal admin panels). Worse, the HA long-lived
  access token is attached as a `Bearer` header and therefore **disclosed to whatever
  host the URL points at**; a URL pointing at an attacker server exfiltrates the token.
  The default and placeholder use cleartext `http://`, so even in the intended LAN case
  the long-lived bearer token travels unencrypted. Node's `fetch` limits the scheme to
  http/https (no `file://`), which bounds but does not remove the risk.
- **Suggested fix (one line):** validate the URL (require `https:` and an
  operator-approved host / reject loopback, link-local and private ranges — the
  protocol already exposes `urlValidationPattern` for this, see Finding note under
  "Areas checked") and refuse to attach the bearer token on a non-HTTPS request.

### Finding 2 — Generic API: SSRF + access token to a caller-chosen host, response reflected (High)

- **Location:** `plugins/junctionrelay.generic-api/src/index.ts:43-48`
  (`extractConfig`); `:100-103` (`testConnection` `fetch(apiUrl, { headers: { 'X-Collector-Token': accessToken } })`);
  `:127-131` (`fetchSensors` `fetch(apiUrl, ...)`); response body parsed and each
  key/value emitted as a sensor value at `:144-176`.
- **Severity:** High.
- **What an attacker needs:** same as Finding 1 — ability to influence the collector
  URL.
- **Confirmed in code:** Yes.
- **Issue:** Same unvalidated-URL pattern. The plugin fetches the caller-chosen URL
  with no scheme/host validation (SSRF into internal/LAN/cloud-metadata endpoints
  reachable from the host) and unconditionally attaches the configured
  `X-Collector-Token` to it (token disclosure to an attacker-chosen host). The
  response body is parsed and its fields are surfaced back to the UI as sensor values
  (`:144-176`), so SSRF responses are reflected to the caller, aiding internal-network
  probing.
- **Suggested fix (one line):** enforce `https:` + host allowlist / block private &
  link-local addresses on the configured URL and only send the token to approved hosts.

### Finding 3 — host-windows: bundled native code executed with no integrity verification (Medium)

- **Location:** `plugins/junctionrelay.host-windows/src/index.ts:41-43` (fixed path to
  bundled `python.exe`), `:76-79` (`spawn(pythonCmd, [pythonScript], ...)`, sets
  `PLUGIN_BINARIES_PATH`), and the bridge
  `plugins/junctionrelay.host-windows/python/metrics_collector.py:38-49` (auto-`pip
  install` of every `*.whl` found in `python/wheels/` via `subprocess.check_call`),
  `:199-229` (`gpu-reader.exe` located from the `PLUGIN_BINARIES_PATH` env var and
  run via `subprocess.run`).
- **Severity:** Medium.
- **What an attacker needs:** write access to the plugin's install directory (weak
  install permissions, a tampered/redelivered plugin package, or a dropped file in
  `binaries/` or `python/wheels/`), or the ability to set `PLUGIN_BINARIES_PATH`
  before the process starts. This is a local-tamper precondition, not reachable from
  RPC data.
- **Confirmed in code / unconfirmed:** The execution paths are confirmed in code;
  actual exploitability is **unconfirmed** because it depends on the deployed install
  tree's permissions.
- **Issue:** On every collect the plugin executes `python.exe`, `gpu-reader.exe`, and
  (on first import failure) `pip install`s bundled wheels — none of which are
  signature- or hash-verified. Anyone who can place or replace those artifacts gets
  code execution as the JunctionRelay user. The `pip install --user` auto-install turns
  a writable `wheels/` directory into arbitrary code execution.
- **Positive:** argument-vector `spawn`/`subprocess` calls are used (no `shell=True`,
  no RPC-controlled argv), so there is no command-injection path from plugin/RPC data.
- **Suggested fix (one line):** install native helpers to a non-user-writable location
  and verify a signature/hash of `python.exe` / `gpu-reader.exe` (and vendored wheels)
  before execution; remove the runtime `pip install` of loose wheels.

### Finding 4 — OpenWeather: API key in the URL query string (Low)

- **Location:** `plugins/junctionrelay.open-weather/src/index.ts:76` and `:98`
  (`...&appid=${encodeURIComponent(apiKey)}&units=metric`); fixed base host
  `API_BASE` at `:4`.
- **Severity:** Low.
- **What an attacker needs:** access to something that records the request URL — the
  upstream provider's access logs, a logging proxy, browser-style history, or a leaked
  error/trace that includes the full URL.
- **Confirmed in code:** Yes.
- **Issue:** The OpenWeather key is transmitted as a query-string parameter. The
  transport is HTTPS and the base host is hardcoded (not SSRF), and the user-supplied
  `city` is correctly `encodeURIComponent`-escaped (no parameter/URL injection), but a
  credential in the path/query is more likely to be persisted in logs than one in a
  header, and OpenWeather can place `appid` in a header-style query only under their
  scheme. Impact is bounded (single provider, HTTPS).
- **Suggested fix (one line):** move the key out of the URL (e.g. to a header where the
  provider supports it, or document the exposure), and ensure any error/telemetry path
  redacts the query string.

### Finding 5 — Internet Time: time source fetched over cleartext HTTP (Low)

- **Location:** `plugins/junctionrelay.internet-time/src/index.ts:74`
  (`fetchWithTimeout('http://worldclockapi.com/api/json/utc/now', ...)`) — one of four
  fallback time sources; the other three use `https://`.
- **Severity:** Low.
- **What an attacker needs:** a network-position on the plugin's egress path (on-path /
  DNS / ARP) to the cleartext fallback so it answers the request.
- **Confirmed in code:** Yes.
- **Issue:** Time is fetched over plaintext HTTP, so an on-path attacker can spoof the
  reported "Internet time" (integrity), and the request is trivially observable. The
  host is hardcoded (not SSRF) and no credential is involved, so impact is limited to
  the integrity of one displayed sensor.
- **Suggested fix (one line):** use `https://` for the worldclockapi.com fallback (or
  drop it in favor of the HTTPS sources).

### Finding 6 — Dependency: esbuild devDependency advisory (Low)

- **Location:** `package-lock.json` (`node_modules/esbuild`, `version 0.27.3`,
  `hasInstallScript: true`); devDependency declared in the root
  `package.json`.
- **Severity:** Low.
- **What an attacker needs:** the advisory
  [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) ("esbuild
  allows arbitrary file read when running the development server") applies only when
  the esbuild **dev server is run on Windows**; this repo uses esbuild only as a
  build-time tool (`devDependency`, via `tsx`/build), and it is not bundled into the
  shipped plugin `dist/`.
- **Confirmed in code:** Confirmed by `npm audit --package-lock-only` (offline from the
  lockfile: 0; network audit reports this single advisory). `npm audit fix` would bump
  to `esbuild@0.28.2`, flagged as a breaking change.
- **Suggested fix (one line):** upgrade `esbuild` to `>=0.28.2` when the breaking change
  is accepted.

## Areas checked with no finding

- **Secrets / credentials committed in the tree:** none. No `.env`, `.npmrc`, private
  keys, or credential files are tracked; scans for `sk-ant-…`, `ghp_…`, `AKIA…`,
  `Bearer eyJ…`, and password patterns returned no real values. The only token-like
  strings are **non-secret placeholders** in plugin metadata (e.g. the `accessToken`
  example strings shown in the config forms and the private-IP example URL used as the
  Home Assistant default) — none are usable credentials. (No secret values are
  reproduced in this report.)
- **Unsafe deserialization / eval:** none. All parsing is `JSON.parse`
  (`packages/sdk/src/CollectorPlugin.ts:77`) or Python `json.loads`; no `eval`,
  `new Function`, `vm`, `node-serialize`, or object `__proto__` handling. The SDK
  dispatches only a fixed method allow-list and returns `METHOD_NOT_FOUND` otherwise
  (`packages/sdk/src/CollectorPlugin.ts:109-172`).
- **TLS / certificate checks turned off:** none. No `rejectUnauthorized: false`,
  `NODE_TLS_REJECT_UNAUTHORIZED`, custom CA, or identity-check overrides anywhere. The
  only plaintext-transport concern is Finding 5 (and the cleartext default in Finding 1).
- **Command / process execution (injection):** no injection surface. Production spawns
  use argument arrays with fixed argv and no shell
  (`plugins/junctionrelay.host-windows/src/index.ts:76`,
  `metrics_collector.py:41`, `:217`); no RPC/config value reaches an argv or shell
  string. The only `shell: true` is in the SDK test harness
  (`packages/sdk/src/__tests__/CollectorPlugin.test.ts:13-15`) with hard-coded
  arguments — not production code. The `node -e "…fs.rmSync('dist'…)"` `clean` scripts
  are static, developer-run, and take no input.
- **Path traversal:** no traversal from untrusted input. `scripts/pack.mjs` stages files
  using fixed `path.join`/`relative` under the plugin cwd; the Python bridge reads fixed
  `/sys`, `/proc`, and registry paths. Collector identifiers are validated by
  `PLUGIN_ID_PATTERN` in the SDK constructor (`CollectorPlugin.ts:34-38`), so a
  plugin-supplied id cannot smuggle path separators; how the host maps an id to an
  install path lives in JunctionRelay_Server, outside this repo.
- **Logging of tokens / keys:** none in this repo. No plugin or the SDK writes the
  `accessToken`/`Authorization`/`X-Collector-Token` value to stdout/stderr or to a log.
  Handler exceptions are returned as JSON-RPC error `message` strings
  (`CollectorPlugin.ts:94-106`) but do not include the credential. (Recording the full
  RPC `configure` params — which carry `accessToken` — would be a host-side concern in
  JunctionRelay_Server, not this repo.)
- **Network egress in the SDK/protocol:** none. `packages/sdk` and `packages/protocol`
  make no outbound calls and touch no filesystem; the JSON-RPC transport is stdin/stdout
  only.
- **Unused mitigation hook (informational, not a separate finding):** the protocol
  declares `urlValidationPattern` / `accessTokenValidationPattern`
  (`packages/protocol/src/index.ts:72-73`) for exactly the URL-validation gap in
  Findings 1-2, but no plugin sets them.

## Dependency & supply-chain posture

- **Lockfile present:** yes — a single root `package-lock.json`, used by `npm ci`.
- **Third-party install scripts:** one — `esbuild` (`hasInstallScript`, its platform
  postinstall). No plugin `package.json` declares a `preinstall`/`postinstall`/`install`
  hook.
- **Runtime dependency surface:** effectively none shipped. Every plugin depends only on
  the workspace `@junctionrelay/collector-protocol`/`@junctionrelay/collector-sdk`; the
  only third-party packages (`esbuild`, `tsx`, `typescript`, `@types/node` and their
  transitive deps) are `devDependencies` and are not part of a plugin's `dist/` output.
- **Advisories:** `npm audit --package-lock-only` reports one **Low** advisory
  (esbuild, Finding 6); `npm audit --offline` (empty cached DB) reports 0.

## Test status

Test command for this repository:

```
npm ci && npm run build && npm test
```

(The workspace `test` script runs `npx tsx --test src/__tests__/*.test.ts` for the SDK.)

- **Result on the PR branch:** pass — build OK, **27 of 27 tests pass** (7 SDK
  integration tests + 20 unit tests), command exit 0.
- **Result on `main`:** pass — build OK, **27 of 27 tests pass**, command exit 0.

This report adds only this file and changes no code, so it does not affect the test
result. The seven SDK integration tests depend on the `collectorName` in
`packages/sdk/src/__tests__/fixture-plugin.ts` satisfying `PLUGIN_ID_PATTERN`
(`packages/protocol/src/index.ts:16`); that dot-notation fixture id is a `main`-branch
change delivered by the separate prerequisite ticket this branch is based on — not by
this report — and is unchanged by it.
