# JunctionRelay Collectors - Security Audit 2026-11

Date: 2026-11-16
Repository: `JunctionRelay_Collectors`
Scope: `packages/protocol`, `packages/sdk`, all `plugins/*`, `scripts/pack.mjs`, and the dependency lockfile.

## Summary

| Severity | Count |
|---|---:|
| High | 0 |
| Medium | 3 |
| Low | 4 |

## Findings

| ID | Sev | Finding (file:line) | Attacker needs | Confirmed | Suggested fix |
|---|---|---|---|---|---|
| C1 | Medium | SSRF: `config.url` is fetched directly in `testConnection` and `fetchSensors`, with the stored access token attached, and there is no scheme/host/address validation. `plugins/junctionrelay.generic-api/src/index.ts:43-48`, `100-101`, `127-128` | Ability to set or import the collector URL (UI/API, cloud-synced config, or a malicious marketplace entry) and a reachable internal service; the plugin then sends the configured token to that host. | Confirmed | Parse the URL with `new URL`, allow only http/https, and reject loopback, link-local, metadata, and private ranges (or enforce a host allowlist) before fetching. |
| C2 | Medium | SSRF: the Home Assistant URL is fetched directly in `testConnection` and `fetchStates`, and the long-lived bearer token is sent to whatever host is configured. `plugins/junctionrelay.home-assistant/src/index.ts:14-20`, `46-51`, `97-102` | Ability to set or import the collector URL; can direct the request and the bearer token to an internal or metadata endpoint. | Confirmed | Validate scheme/host and block internal/metadata ranges; optionally restrict to the configured Home Assistant host and require HTTPS. |
| C3 | Medium | Home Assistant defaults to plain HTTP and accepts HTTP URLs, so the long-lived bearer token can cross the LAN in clear text. `plugins/junctionrelay.home-assistant/package.json:35`, `plugins/junctionrelay.home-assistant/src/index.ts:70` (fetches at lines 15 and 97) | Network position on the same LAN/Wi-Fi, or control of the configured URL, to capture the bearer token. | Confirmed | Default to HTTPS and refuse or warn when a token would be sent over `http://`, unless the user explicitly opts in for local-only use. |
| C4 | Low | Internet Time uses the plaintext `http://worldclockapi.com/api/json/utc/now` endpoint and trusts its response. `plugins/junctionrelay.internet-time/src/index.ts:72-84` (line 74) | Man-in-the-middle or DNS spoofing on the path to that host; can spoof the reported UTC time. | Confirmed | Drop the plaintext source or require HTTPS-only time sources. |
| C5 | Low | The OpenWeather API key is placed in the request URL query string (`appid`), where proxies, server logs, or URL history can record it. `plugins/junctionrelay.open-weather/src/index.ts:75-78`, `97-99` | Access to a proxy/server log or URL history that records the request; HTTPS protects only the transit path. | Confirmed | Prefer an auth header if available; otherwise never log request URLs and document the query-string exposure. |
| C6 | Low | `junctionrelay.collectorName` from `package.json` is used unvalidated in zip entry names and the output filename, so a crafted value containing `../` can escape the plugin directory or create zip-slip entries. `scripts/pack.mjs:15`, `29-32`, `138` | Control of a plugin's `package.json` plus a victim who runs `npm run pack` on it. | Confirmed | Validate `collectorName` against `PLUGIN_ID_PATTERN` and reject path separators before building the zip. |
| C7 | Low | `npm audit` reports one low advisory for the dev-only `esbuild` 0.27.3 dependency (GHSA-g7r4-m6w7-qqqr: arbitrary file read when running the development server on Windows). `npm audit --offline` reports 0; the online audit reports the advisory. `package.json:16`, `package-lock.json:16`, `80-83` | Ability to reach an esbuild dev server running on Windows; not part of the normal build path and not shipped in plugin bundles. | Confirmed dependency advisory; runtime exploitation unconfirmed | Upgrade esbuild to >= 0.28.2 when convenient, or avoid exposing the dev server on untrusted interfaces. |

## Areas checked with no finding

| Area | Result |
|---|---|
| Secrets or credentials committed in the tree | None found. Tracked files contain type names, UI placeholders, and documentation examples only; no secret value is reproduced here. |
| Unsafe deserialization or eval | No `eval`, `new Function`, or unsafe deserializer. The SDK uses `JSON.parse` on stdin and the host-windows bridge uses `JSON.parse`/`json.loads` on child-process output; parse failures are handled. |
| TLS or certificate checks turned off | No `NODE_TLS_REJECT_UNAUTHORIZED`, `rejectUnauthorized: false`, or custom agent that disables certificate verification. The plaintext-HTTP issues are listed above. |
| Logging of tokens or keys | No code logs tokens, keys, or request URLs. Error paths report HTTP status/status text or the exception message only. |
| Command or process execution | `host-windows` spawns bundled Python and `gpu-reader.exe` with fixed paths and argv arrays, never a shell; no caller-controlled command or arguments. Write access to the plugin directory already implies code execution. |
| Path traversal | Protocol, SDK, and plugin runtime code use no caller-controlled filesystem paths. The packaging-script issue is C6. |
| Network and plugin-config input handling | The SDK rejects non-namespaced `collectorName` values and handles malformed JSON-RPC lines and unknown methods. Plugin config is treated as user-owned; the URL-handling weaknesses are C1-C3. |
| Outbound HTTP to fixed destinations | Claude uses a fixed `https://api.anthropic.com` base, OpenWeather a fixed HTTPS API base, and Internet Time fixed public endpoints. Only Generic API and Home Assistant fetch caller-chosen URLs. |
| Dependency risk | `package-lock.json` is present. No production npm dependencies beyond workspace links. `npm audit --offline` reports 0; the online audit reports the dev-only low advisory in C7. `esbuild` has an install script that downloads its platform binary and is used only for builds. |
| Shaders `serve.py` and `test.html` | Not present in this repository; out of scope for the Collectors run. |
| Git history | The repository has a single commit; no secret patterns were found in tracked files. |

## Repository test status

On the base branch, the SDK integration tests failed because the fixture used the invalid non-namespaced `collectorName` `TestPlugin`, so `CollectorPlugin` construction threw and every RPC test timed out. This run corrected the fixture to a valid namespaced name and updated the matching assertion; no test was removed, skipped, or weakened. `npm ci && npm run build && npm test` now passes all 27 tests.
