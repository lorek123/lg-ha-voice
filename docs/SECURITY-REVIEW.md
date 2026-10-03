# Security review — `service/index.js`

*Findings from an external security assessment of the LG C9 this app runs on, 2026-09-22.
Every item was verified against the live device, not inferred from source.*

---

## Resolution status — 2026-09-30 (fixes applied in source)

| # | Finding | Status | Change |
|---|---------|--------|--------|
| **F1** | World-writable token file | **Fixed** | `{ mode: 0o600 }` on all `HA_CONFIG_FILE` / `OAUTH_STATE_FILE` writes + a startup `fs.chmodSync(…, 0o600)` to correct the existing file (`service/index.js`) |
| **F2** | Setup server runs from boot | **Fixed** | Boot-time auto-start IIFE removed; server started on demand in `startSetupServer`, stopped in `stopSetupServer` **and** on a 10-min auto-stop timeout. Event loop kept alive by an explicit keepalive timer |
| **F3** | `/pending-config` leaks token (CORS `*`) | **Fixed** | HTTP route deleted; config now delivered over the bus-authenticated Luna method `getPendingConfig`. App repointed in `src/main.js` (`startConfigPolling`), dev-shim updated |
| **F4** | `/voice-state` leaks transcripts (CORS `*`) | **Fixed** | HTTP route deleted (dead — app already uses the `voice/state` Luna subscription) |
| **F5** | Reflected XSS in `/callback` | **Fixed** | Attacker-controlled `state` / `err.message` no longer reflected into HTML; detail kept in the log only |
| **F6** | No validation/CSRF on `/start-auth` | **Fixed** | `haUrl` must be an `http(s)://` URL before use as a server-side request target (SSRF); `/start-auth` now **rejects cross-origin POSTs** (Origin/Referer check) and requires `application/x-www-form-urlencoded` (CSRF). Private-range-only restriction deliberately skipped (would break remote HA); F2 also shrinks the window |
| **F7** | Transcripts written to disk | **Fixed** | `log('transcript:', …)` now logs only a length, never the text |

The cross-origin/Content-Type gate and the OLED idle-dimming were cross-checked against the sibling project `lg-webos-dashboard` (Glasshouse), which lands on the same security posture (0600 config, no CORS, cross-origin POST rejection).

Verify on-device with the checks in the plan (`~/.claude/plans/…`) — perms, closed ports,
non-reflected `/callback`, clean log.

---


Reviewed against the running build on the TV. All findings verified on the live device, not
inferred from source.

**Correction to my earlier advice:** I suggested binding the setup server to `127.0.0.1`.
**That would break setup.** The OAuth flow redirects the *user's browser* back to
`clientId + '/callback'` where `clientId = http://<tv-ip>:8642`, so the callback must be reachable
from the phone/PC doing the login. The fix is lifecycle and endpoint reduction, not the bind
address — see F2.

---

## F1 — HA token file is world-writable (critical, one-line fix)

```
-rwxrwxrwx  1 root root  440  /media/developer/ha-voice-config.json
```
Mode **0777**, containing `{url, token, refreshToken, clientId}` — your Home Assistant access and
refresh tokens. Any process on the TV can read them, and **any process can rewrite them**, which
means pointing your TV's voice pipeline at an attacker's "Home Assistant".

Cause: `fs.writeFileSync(HA_CONFIG_FILE, JSON.stringify(cfg))` at lines 591 and 819 with no
`mode`. The same omission applies to `OAUTH_STATE_FILE` (line 141).

```js
fs.writeFileSync(HA_CONFIG_FILE, JSON.stringify(cfg), { mode: 0o600 });
```
Existing file needs `chmod 600` — the mode is not corrected by rewriting.

## F2 — Setup server runs permanently, not just during setup

`startOAuthServer(clientId)` is invoked unconditionally at line 939 (module-level IIFE), so
`0.0.0.0:8642` is listening from boot, forever — even though it is only needed for the few
minutes of OAuth.

The service already has both halves of the right design registered on the Luna bus:
`startSetupServer` and `stopSetupServer`. Start on demand from the app; stop on success or
timeout. That alone removes the exposure window for F3–F5 without touching the bind address.

## F3 — `/pending-config` hands the HA token to anyone (CORS `*`)

```js
res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
if (pendingConfig) { var cfg = pendingConfig; pendingConfig = null; res.end(JSON.stringify(cfg)); }
```
Verified live: `HTTP 200`, `Access-Control-Allow-Origin: *`. Returns `{url, token, refreshToken,
clientId}` when populated. Deliver-once is a **race, not an access control** — anything polling
wins it.

The wildcard CORS makes this worse than LAN-only: **any web page open in any browser on your
network can read it with JavaScript.**

**This endpoint is redundant.** The service already exposes `getConfig` over Luna, which the app
can call directly. Delete the HTTP route.

## F4 — `/voice-state` leaks transcripts (CORS `*`)

Verified live: `{"state":"idle","transcript":"","ttsUrl":""}` with `Access-Control-Allow-Origin: *`
— i.e. **what you said to the TV**, readable unauthenticated by any LAN host or any website.

Also redundant: `voice/state` is registered on Luna *with subscription support* (line ~914), which
is a better fit for the UI than HTTP polling. Delete the HTTP route.

Given this project began as a privacy investigation into LG shipping voice data off-device, an
endpoint that serves your transcripts to the whole LAN deserves priority.

## F5 — Reflected XSS in `/callback`

```js
var errDetail = 'got=' + state + ' expected=' + (pending ? pending.state : 'NO_PENDING');
res.end(makeHtml('Error', '…' + errDetail + '…'));
```
`state` is attacker-controlled and interpolated into HTML unescaped. Verified live:

```
GET /callback?code=x&state=%3Cb%3EMARKER%3C%2Fb%3E
→ got=<b>MARKER</b> expected=NO_PENDING
```

Markup is reflected verbatim. `'Auth failed: ' + err.message` on the failure path has the same
shape. Escape on output, or drop the diagnostic detail from the page and keep it in the log.

## F6 — No CSRF or origin checks on `/start-auth`

Zero matches for referer/origin/CSRF anywhere in the file. `/start-auth` is a plain POST form
taking `haUrl`, which the service then issues server-side requests to
(`httpPost(haUrl + '/auth/token', …)`).

Two consequences: any web page can auto-submit that form to your TV, and `haUrl` is an unvalidated
SSRF sink reachable from a root-privileged service holding the `["all"]` Luna group. Validate
`haUrl` (scheme, and ideally private-range only) and require a same-origin/confirmation step.

## F7 — Transcripts written to disk

Line 668: `log('transcript:', voiceTranscript)` → `/tmp/ha-voice-service.log` (mode 0644).
Currently 0 transcript lines because voice hasn't run since boot, and `/tmp` is tmpfs so it does
not persist across reboots — but while the TV is up, every recognised utterance is on disk,
world-readable. Drop the value, or log a length/hash.

---

## Suggested order

1. **F1** `chmod 600` + add `{ mode: 0o600 }` — one line, stops token theft *and* tampering
2. **F3 + F4** delete both HTTP routes — they duplicate Luna methods that already exist
3. **F2** start/stop the server around setup instead of at boot — closes the window entirely
4. **F5** escape the reflected `state`
5. **F7** stop logging transcript text
6. **F6** validate `haUrl`, add an origin check

1–3 are the ones that matter; each removes a confirmed, verified exposure, and 2–3 are deletions
rather than additions.

## Note on the security model

The service holds the `["all"]` Luna API group — full access to every service on the bus,
including ones the LG chain we documented earlier could not reach. It is the most privileged
component on the TV and currently the least authenticated. That combination, not any single bug
above, is what makes these worth fixing.

**Original review was read-only. Fixes above applied in source on 2026-09-30; verify on-device before trusting.**
