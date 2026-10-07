# Bad Radio

Underground FM. Hit play on one stream. Requests wait.

**badradio.rocks** is this site. **badradio.com** is the existing WordPress placeholder — this repo does not assume we control that DNS yet.

Licensed radio is coming via **Live365** (they bundle SoundExchange + the PROs). This site keeps the day’s **set playlist** and the listener **request queue**. The ~250GB library and a DIY Icecast / SoundExchange stack are later.

## What this slice is

- A listen page: play/pause, station log (now playing + recently played), request desk, chat shell, soft **Outpost transmissions** signup
- A password-protected **operator desk** (`/admin`) — one `ADMIN_PASSWORD`, no user-account product
- Git catalog + seed day set: [`src/data/catalog.json`](src/data/catalog.json), [`src/data/playlists/day-set.json`](src/data/playlists/day-set.json)
- Queue insert and AutoDJ pick that **refuse** 1-hour-delay and Sound Recording Performance Complement violations
- Operator export: JSON / M3U **checklist** for Live365 (they cannot import M3U). Ready-to-air is the default scope; optional ready+day includes remaining set tracks. Order only — no fake play clocks.
- Auto-mark played: listen traffic hits `GET /api/now-playing`, which proxies public Live365 station JSON and matches current-track / last-played to queued requests.
- **Air log:** every Live365 metadata fetch upserts distinct on-air titles into KV (unique folded artist/title, cap **4000**, oldest `lastSeenAt` dropped). Desk can search, promote into the request catalog, and export CSV/JSON. This is harvested on-air metadata, not a full library sync.
- **Dropbox master library** in **D1** (`MASTER` → database `badradio-master`). Mark uploads `master.csv` from the local scanner. Desk diffs that against the air log (heard / not yet aired / aired but not in the Dropbox scan). The full master is ~27MB — it does **not** go in KV.
- **Outpost signups** in the same D1 (`outpost_signups`). Email list only — no Mailchimp, no KV for signups. Optional X / Facebook handles and a shout-out checkbox.
- Listen-page analytics hooks (Cloudflare Web Analytics preferred; GA4 optional). Pageviews + `play_click` + `signup_submit`. No emails in events.
- Cloudflare **Workers** (Workers Assets + custom domain). Persistence: Workers KV (`STATION`) for desk state; D1 (`MASTER`) for the Dropbox master library and Outpost signups; `.data/station.json` in `astro dev`
- Embeddable **`/widget`** player (iframe + optional `embed.js`) and a **PWA**. The listen page has a visible **listen anywhere** install/download section (not hidden until the browser prompt).

Player, now-playing, request desk, and admin desk stay on the page. Signup never blocks play.

## What this is not

- Not Spotify, Apple MusicKit, or any DSP-embed origin
- Not a 250GB upload, not SoundExchange filings, not a Live365 purchase
- Not an AI DJ voice
- Not an advance timed playlist for listeners (no “this song at 9:00”)
- Not WordPress, not user accounts, not fake listener counts

## Programming rules (encoded)

1. The day starts from a **set playlist** the operator defines.
2. Listener requests go into a **queue**, not on-air immediately.
3. `earliest_play_at = request_time + at least 1 hour`. Not within 1 hour of the request, and not at a time the requester designates.
4. **Sound Recording Performance Complement** — in any rolling 3-hour window:
   - max 3 tracks from one album (max 2 consecutive)
   - max 4 from one featured artist (max 3 consecutive)
5. Queue insert **and** AutoDJ pick refuse violations.
6. Public site: now playing + recently played + “requests play later, not next.” The desk can see up-next and `earliest_play_at`.

Unit tests: `npm test` ([`tests/srpc.test.ts`](tests/srpc.test.ts), [`tests/delay.test.ts`](tests/delay.test.ts), [`tests/autodj.test.ts`](tests/autodj.test.ts), [`tests/live365.test.ts`](tests/live365.test.ts), [`tests/operator.test.ts`](tests/operator.test.ts), [`tests/airlog.test.ts`](tests/airlog.test.ts), [`tests/master.test.ts`](tests/master.test.ts), [`tests/stream-redirect.test.ts`](tests/stream-redirect.test.ts), [`tests/outpost.test.ts`](tests/outpost.test.ts), [`tests/widget.test.ts`](tests/widget.test.ts), [`tests/sw.test.ts`](tests/sw.test.ts), [`tests/player-stream.test.ts`](tests/player-stream.test.ts)).

## Run locally

Needs Node 22.12+.

```sh
cp .env.example .env
# set ADMIN_PASSWORD in .env — there is no default
npm install
npm test
npm run dev
```

Dev server: `http://127.0.0.1:43123`

- Listen: `/`
- Widget: `/widget` (iframe embed)
- Desk: `/admin` (same `ADMIN_PASSWORD`)
- Leave `PUBLIC_STREAM_URL` empty to see the **stream not connected** state. That is intentional. We do not claim a live origin until the Live365 mount exists.

Optional local audio test — **not** the Bad Radio origin:

```sh
PUBLIC_STREAM_URL=https://ice1.somafm.com/groovesalad-128-mp3
```

The player uses the native `<audio>` element (Icecast MP3/AAC). HLS is not wired up yet.

### Env

| Variable | Where it is read | Notes |
| --- | --- | --- |
| `PUBLIC_STREAM_URL` | Worker runtime env first, then `import.meta.env` | Public Live365 mount. Set as a Worker **plaintext** variable in the dashboard (not a secret). Gates the play button (empty = disconnected). The player itself picks **AAC 96k** (`a58480_2`) or **MP3 192k** (`a58480`) in the browser — the Worker does not proxy the stream. Station id for now-playing is derived from `https://streaming.live365.com/<id>`. |
| `LIVE365_STATION_ID` | Worker runtime env (optional) | Override if the mount URL is not a standard Live365 streaming URL. |
| `ADMIN_PASSWORD` | Server only | Shared desk password. Set in `.env` / `.dev.vars` locally. Production: `wrangler secret put ADMIN_PASSWORD`. Never commit it. |
| `PUBLIC_CF_BEACON_TOKEN` | Worker runtime env first (`env.PUBLIC_CF_BEACON_TOKEN`), then `import.meta.env` | **Token-only hex** from the zone Web Analytics snippet (`data-cf-beacon`). Set as a Worker **plaintext** variable on Worker **`badradio`** (not mark-fyi). If the whole `<script>` blob is pasted, runtime extracts the hex. Leave empty to skip the beacon. Never commit it. `npm run deploy` uses `--keep-vars`. |
| `PUBLIC_GA_MEASUREMENT_ID` | Worker runtime env first, then `import.meta.env` | Optional GA4 fallback (`G-…` only). Not needed if Web Analytics is on. |
| `RESEND_API_KEY` | Worker **secret** only | Optional. If set, first-time Outpost inserts email `NOTIFY_TO`. Signup still succeeds if mail fails or the secret is missing. Secret name must be exactly `RESEND_API_KEY`. |
| `NOTIFY_TO` | Worker **plaintext** var | Recipient. Default `support@badradio.com`. |
| `NOTIFY_FROM` | Worker **plaintext** var | Sender. Default `onboarding@resend.dev` (Resend sandbox — only delivers to the Resend account owner's email). After domain verify, set this to an address on the verified domain. |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Astro dev server on port 43123 (file-backed desk state) |
| `npm test` | SRPC + delay + AutoDJ + Live365 + operator + air-log + master-library + stream-redirect + outpost signup + widget/embed + service worker + player reconnect tests |
| `npm run d1:create` | `wrangler d1 create badradio-master` — already created; id is in wrangler.jsonc |
| `npm run d1:migrate` | Apply SQL migrations to the **local** D1 |
| `npm run d1:migrate:remote` | Apply SQL migrations to production D1 |
| `npm run build` | Production build to `./dist` |
| `npm run preview` | Preview the production build locally (same port) |
| `npm run deploy` | `astro build` then `wrangler deploy --keep-vars` (keeps dashboard plaintext vars such as `PUBLIC_STREAM_URL` and `PUBLIC_CF_BEACON_TOKEN`) |
| `npm run cf:preview` | Build, then `wrangler dev` (uses local KV) |
| `npm run check` | `astro check` |

## Deploy (Cloudflare Workers)

Worker name: `badradio`. Custom domains: `badradio.rocks`, `www.badradio.rocks`, `stream-aac.badradio.rocks`. `stream.badradio.rocks/*` is a Worker route over proxied A+AAAA (IPv4 clients). **badradio.com is not attached**.

No Cloudflare token or desk password belongs in this repo.

```sh
npx wrangler kv namespace create STATION
# put the id on the STATION binding in wrangler.jsonc if Wrangler did not write it
echo "$ADMIN_PASSWORD" | npx wrangler secret put ADMIN_PASSWORD
npm run deploy
```

Set **`PUBLIC_STREAM_URL`** as a Worker plaintext variable once the Live365 mount exists (exact name — a typo such as `STRESM` will leave play dark). Leave it unset to ship the disconnected play state. `npm run deploy` uses `--keep-vars` so dashboard plaintext vars (`PUBLIC_STREAM_URL`, `PUBLIC_CF_BEACON_TOKEN`, …) are not wiped.

### Short stream URLs (external players)

These hostnames are **302 redirects only** (ticket 184530). The Worker does not fetch or pipe Live365 audio. Royalties stay on their mount.

| Short URL | Goes to |
| --- | --- |
| `https://stream.badradio.rocks` | `https://streaming.live365.com/a58480` (MP3 / HTML5) |
| `https://stream-aac.badradio.rocks` | `https://streaming.live365.com/a58480_2` (AAC) |

Point Poweramp / VLC / car stereos at the short URL. `stream.badradio.rocks` has proxied **A `192.0.2.0` + AAAA `100::`** (originless Workers placeholders) so IPv4-only phones resolve. `stream-aac` stays a Worker custom domain. Do not use these as a Worker audio proxy.

Do not put origin URLs, API tokens, or `ADMIN_PASSWORD` in `wrangler.jsonc`.

## Embeddable player widget

`/widget` is a low-chrome player: play/pause, now playing (art, artist, title), last **10** tracks with relative times. It polls `GET /api/now-playing` every 12s and **stops polling while the tab is hidden**.

Live365’s public station JSON (`last-played`) only returns **5** rows. The Worker merges that snapshot with a short unique rolling history in KV (`widget:recent:v1` on `STATION`) so the widget can show 10. Air-log bookkeeping still uses the Live365 snapshot only — the extra history is display, not extra plays.

**Junk filter** (safe, conservative): drop a row when the folded title is `newstop` / `newstart` (Live365 `j02 | new-stop` cues); when the artist is `j` + 1–3 digits and the title is a stop/start cue; when the artist is `id` and the title looks like a numbered liner (`07-panther`); or when the title is an obvious ad-break / advertisement / commercial. Live365 `blankart.jpg` (and `/static/assets/img/blank…`) is stripped from `art` but the track stays if artist/title look real (e.g. Triumph).

Framing is allowed only from:

- `https://badradio.com`
- `https://www.badradio.com`
- `https://badradio.rocks`
- `https://www.badradio.rocks`

(`/widget` sends `Content-Security-Policy: frame-ancestors …` and does **not** send blocking `X-Frame-Options`. Other routes are unchanged.)

`GET` + `OPTIONS /api/now-playing` send CORS for those same origins (script embeds). Other origins get no `Access-Control-Allow-Origin`.

### Copy-paste iframe

```html
<iframe
  src="https://badradio.rocks/widget"
  title="badradio live player"
  loading="lazy"
  allow="autoplay"
  style="width:100%;height:580px;border:0;overflow:hidden;background:#080705"
></iframe>
```

Works at ~320px (stacked) and as a wide 100% strip (now playing + recent side by side from 640px).

### Optional `embed.js`

```html
<script src="https://badradio.rocks/embed.js" async data-height="580"></script>
```

Injects the same iframe. Leave this snippet on **badradio.com** (WordPress / `badradio-com` Worker is out of this repo).

## PWA (home screen)

Listen page (`/`): web app manifest name/short_name **badradio**, amber `#e6a23c`, dark `#080705`. Icons 192/512 + maskable from the station radio-wave mark. Service worker `/sw.js` (`badradio-shell-v3`) is **network-first for `/` and `/widget`** so a deploy cannot leave visitors on HTML that points at a deleted hashed stylesheet. Cached HTML is only an offline fallback. Hashed `/_astro/*` files are not intercepted (they go to the network; Cloudflare already marks them immutable). Icons / manifest / `embed.js` stay on the shell cache. `/sw.js` is served `Cache-Control: no-cache`. Never the Live365 stream and never `/api/*`.

The listen and widget players share [`src/lib/player-stream.ts`](src/lib/player-stream.ts): AAC 96k by default (MP3 192k as the other choice, remembered in `localStorage` `br_stream`), `preload=none`, no `src` until play, cache-busted reconnects, backoff 1–30s, stall watchdog (8s frozen `currentTime`). Status while retrying is **Reconnecting…** — not a dead-end error. The Worker still does not proxy audio.

Chromium: **Install badradio** when the browser fires `beforeinstallprompt`. iPhone Safari: **Add to Home Screen** hint (Share sheet). Media Session API updates lock screen / car play with artist, title, art, and play/pause.

Native apps are out of scope.

### Mark — paste the widget on badradio.com

This Worker is **`badradio`** (badradio.rocks) only. It does not touch badradio.com DNS or Worker `badradio-com`. After deploy, paste the iframe (or `embed.js`) into the WordPress/placeholder site when you want the player on `.com`.

## Live365 — how this desk is meant to feed the stream

Live365 AutoDJ is **manual**. This desk tracks legality and requests. There is **no official public Live365 broadcaster API** to push tracks into AutoDJ, and Live365 does **not** import M3U. This repo does not scrape the Live365 dashboard and does not invent a private write API.

We **do** read the public station JSON (`GET https://api.live365.com/station/<id>`) for listener now-playing: `current-track` and `last-played`. The Worker proxies that on `GET /api/now-playing` (and on listen / admin loads). When that metadata matches a queued request (folded artist/title), the desk marks it played. That is bookkeeping, not a playlist push.

The same fetch **upserts an air log** in station KV: unique folded artist/title, first/last seen, play count (idempotent inside a 12-minute window so 18s polls and lingering last-played do not explode counts). Cap: **4000** unique keys; oldest `lastSeenAt` is dropped. Live365 has no library export and `/library` is not a public API — this harvest is **not** a full Live365 library. Diff it against the Dropbox master in D1.

## Dropbox master library (D1)

The local scanner on Mark’s machine writes `~/badradio-library/out/master.csv` (~34k tracks). **Do not** put that JSON/CSV in KV (25 MiB limit). It lives in D1.

Binding name: **`MASTER`**. Database name: **`badradio-master`**. Database id is in [`wrangler.jsonc`](wrangler.jsonc). Schema: [`migrations/0001_master_tracks.sql`](migrations/0001_master_tracks.sql). Primary key `id` is the folded `artist::title` match key (same folding as the air log). `content_hash` is indexed for duplicate-file queries.

Do **not** add a dashboard plaintext variable named `MASTER`. That name is the D1 binding; a string var with the same name replaces the database handle and used to 500 `/admin`. The desk now ignores a non-D1 `MASTER` and still loads.

New environments: `npm run d1:migrate:remote` then `npm run deploy`. The Worker already lists this binding; do not recreate the database.

### Re-scan and upload

The scanner lives on Mark’s machine (`sniper7`), not in this Worker. Last run: **34,475** tracks → `~/badradio-library/out/master.csv` and `master.json` (~27MB). Folder counts from that pass: `45000_Songs` 28038, Concert Vault 2479, Shared Music 1787, Amazon MP3 1171, `Tonys_Boat_Jams` 1000.

```sh
# on sniper7 — re-run the same local scan that wrote those files
# expected output:
#   ~/badradio-library/out/master.csv
#   ~/badradio-library/out/master.json
```

CSV columns the importer understands: `artist`, `title`, `album`, `duration_sec`, `format`, `size_bytes`, `relative_path`, `folder_root`, `content_hash`, `tag_source`, `scanned_at` (aliases like `path`, `hash`, `folder` also work). Rows without artist+title are skipped. Duplicate `artist::title` keys in one file keep the last row.

Desk → **Dropbox master vs Live365 air log** → choose `master.csv` → Import master.

Prefer CSV over `master.json` (~27MB). NDJSON is also accepted. The Worker does **not** fetch Dropbox.

- `POST /api/admin/master-import` — multipart `file` (or raw CSV/NDJSON body)
- `GET /api/admin/master-diff?bucket=master-only&format=csv` — master titles not yet in the air log (Live365 upload candidates)
- `GET /api/admin/master-diff?bucket=air-only&format=csv` — aired titles not in the Dropbox scan (tag mismatch or outside the scanned folders)
- `GET /api/admin/master-diff?bucket=intersection&format=csv`
- `POST /api/admin/master-diff` — `{ keys }` or `{ bucket: "intersection" }` to promote into the request catalog

## Outpost transmissions (D1 signups)

Soft email capture on the listen page. Copy: **Outpost transmissions**. Email required, name optional. Play is never gated.

Binding: **`MASTER`** → database **`badradio-master`** (same D1 as `master_tracks`). No KV for signups. No Mailchimp / Buttondown.

Schema: [`migrations/0002_outpost_signups.sql`](migrations/0002_outpost_signups.sql) plus optional social columns in [`migrations/0003_outpost_social.sql`](migrations/0003_outpost_social.sql).

| Column | Purpose |
| --- | --- |
| `id` | UUID primary key |
| `email` | Address as entered (trimmed) |
| `email_norm` | Lowercased unique key for idempotent upsert |
| `name` | Optional |
| `source` | Default `listen` |
| `status` | `subscribed` / `unsubscribed` |
| `consent_at` | Last consent timestamp |
| `created_at` / `updated_at` | ISO timestamps |
| `unsub_token` | UUID, not derived from email; public unsubscribe key |
| `x_handle` | Optional (0003). Bare handle after stripping `@` / profile URLs |
| `facebook_handle` | Optional (0003). Same normalization |
| `shoutout_ok` | Optional (0003). `INTEGER NOT NULL DEFAULT 0` |

Upsert is `INSERT … ON CONFLICT(email_norm) DO UPDATE`. Re-submitting after unsubscribe sets `status` back to `subscribed` and refreshes consent. `id`, `created_at`, and `unsub_token` stay put. If the 0003 columns are missing, the Worker **falls back to the old insert** and does not 503. API responses are `{ ok, action }` or a generic message — **emails are not logged** and not echoed on error.

Unsubscribe: `GET /outpost/unsubscribe?token=<unsub_token>` updates D1 status. The listen form includes a privacy one-liner. The form POSTs to `/api/outpost/signup`. With JS it stays on the listen page; without JS it **303s to `/?outpost=ok`** (or `offline` / `invalid` / `handle`) — never an email in the query string.

Export: desk → **Signup CSV** (`GET /api/admin/outpost-export`, same admin session). Columns: `created_at,updated_at,status,source,email,name,x_handle,facebook_handle,shoutout_ok`. The token stays in D1 only.

### Mark — apply 0003 in the D1 Console

This token often gets Cloudflare **7403** on `d1:migrate:remote`. Paste this exact SQL on database **`badradio-master`**:

```sql
ALTER TABLE outpost_signups ADD COLUMN x_handle TEXT;
ALTER TABLE outpost_signups ADD COLUMN facebook_handle TEXT;
ALTER TABLE outpost_signups ADD COLUMN shoutout_ok INTEGER NOT NULL DEFAULT 0;
```

If a column already exists, skip that line. The Worker already has the `MASTER` binding; do not create a second database or a plaintext var named `MASTER`.

List latest signups:

```sql
SELECT created_at, email, name, x_handle, facebook_handle, shoutout_ok, status, source
FROM outpost_signups
ORDER BY created_at DESC
LIMIT 50;
```

If 0003 is not applied yet, drop the three new columns from that SELECT.

### Earlier signups (were they stored?)

No. Signups were never written to KV, logs, or any older table. The only store is D1 `outpost_signups` (migration 0002). Until that table existed, `POST /api/outpost/signup` returned **503** (`Outpost is offline`) and did not persist the row. Submissions from before Mark created the table are gone.

### Signup email to support@

Mail runs **only** on a first-time D1 insert (`action: insert`). It is **awaited on the request** so the Worker isolate cannot drop the Resend fetch after the 200 (the old `void` + late `waitUntil` import could). The 0003 column-missing fallback still returns that planned insert and does **not** skip mail. A second submit of the same email is a resubscribe `update` and sends nothing. Missing / blank `RESEND_API_KEY` skips mail (`outpost-mail skipped-no-secret` in Workers logs). Mail failure never fails the signup.

Secret name must be exactly **`RESEND_API_KEY`** on Worker **`badradio`**. Recipient / sender are Worker **plaintext** vars (`npm run deploy` uses `--keep-vars`):

| Var | Default |
| --- | --- |
| `NOTIFY_TO` | `support@badradio.com` |
| `NOTIFY_FROM` | `onboarding@resend.dev` |

Failed (and successful) Resend replies are logged as `console.error('outpost-mail', status, body)` — never the API key.

**Sandbox restriction:** `onboarding@resend.dev` can only deliver to the email on the Resend account. A send to `support@badradio.com` returns **403** (`You can only send testing emails to your own email address… verify a domain at resend.com/domains, and change the from address`). That is the expected live failure until Mark verifies a domain.

### Mark — verify badradio.com in Resend (leave Zoho MX alone)

Do **not** turn on Resend inbound / Email Routing on the apex. Zoho already owns `badradio.com` MX. Verify a **send subdomain** so Resend never touches inbound mail.

1. Resend → [Domains](https://resend.com/domains) → **Add Domain** → `send.badradio.com` (recommended). Region as shown. **Do not** enable Receiving.
2. In **Cloudflare → zone `badradio.com` → DNS**, add **exactly** the records Resend shows. Typical older-style set (copy the live values from the dashboard; they must match):

| Type | Name (Cloudflare) | Content (example — use Resend’s value) | Proxy |
| --- | --- | --- | --- |
| MX | `send` | `feedback-smtp.<region>.amazonses.com` | n/a — priority **10** |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | n/a |
| TXT | `resend._domainkey` | Resend’s DKIM `p=…` value | n/a |

Domains created after August 2026 may show **CNAMEs** instead of MX+TXT. If so, paste those CNAMEs and set each to **DNS only (grey cloud)**, never proxied.

3. **Leave Zoho MX on the apex untouched.** Do not add a Resend MX on `@` / `badradio.com`. Do not enable Resend Receiving.
4. **SPF:** Resend’s SPF lives on the `send` hostname (`send.badradio.com`). Do **not** add `include:amazonses.com` or `include:_spf.resend.com` to the apex Zoho SPF — that is redundant, burns the 10-lookup budget, and is not needed for a subdomain send domain. If you instead verify the **apex** `badradio.com` (not recommended), merge one include into the existing Zoho TXT (`v=spf1 include:zoho.com include:amazonses.com ~all` or whatever Zoho already has) and still leave Zoho MX alone.
5. Wait until Resend shows the domain **Verified** (often minutes; up to 72h).
6. On Worker **`badradio`**, set plaintext **`NOTIFY_FROM`** to an address on that exact verified domain, then redeploy is not required (`--keep-vars` already keeps vars; changing a dashboard var is enough). Examples:

   - verified `send.badradio.com` → `outpost@send.badradio.com` (or `badradio outpost <outpost@send.badradio.com>`)
   - verified apex `badradio.com` → `outpost@badradio.com`

   `from` must match the verified domain **exactly**, including the subdomain. `NOTIFY_TO` can stay `support@badradio.com`.

7. Submit a **new** email (not one already in `outpost_signups`) on badradio.rocks. Check Workers logs for `outpost-mail` status/body. A 200/`id` from Resend means the send was accepted; look in support@ (and spam).

Quick test before DNS: temporarily set `NOTIFY_TO` to the Resend account owner’s email and keep `NOTIFY_FROM=onboarding@resend.dev`. That should deliver. Then switch `NOTIFY_TO` back and verify the domain for support@.

## listen anywhere (install / embed)

The listen page (`/#listen-anywhere`) always shows **Install app**, **iPhone / iPad**, **Android**, **Desktop**, **Open the widget**, and a **copy iframe** box. The matching OS is highlighted. Chromium `beforeinstallprompt` drives Install app when the browser offers it; otherwise the button opens the right short steps. Copy: installs from your browser, no app store.

Reusable fragment for badradio.com (do not change `.com` DNS from this repo): [`public/listen-anywhere-snippet.html`](public/listen-anywhere-snippet.html).

## Analytics (listen page)

Prefer **Cloudflare Web Analytics** on zone `badradio.rocks`. Pageviews come from the beacon. Custom events (no PII):

| Event | When |
| --- | --- |
| pageview | Beacon (and GA `config` if GA is on) |
| `play_click` | Listen play button (play, not pause) |
| `signup_submit` | Successful Outpost POST only |

`window.__badradioTrack` allowlists those two names and forwards to `zaraz.track` / `gtag('event')` with **no properties**. Emails, names, and tokens never go in events.

### Mark — Web Analytics token

On Worker **`badradio`** (not mark-fyi):

1. Dash → `badradio.rocks` → Analytics & logs → Web Analytics.
2. From the JS snippet, copy **only** the hex token inside `data-cf-beacon` — not the `<script>` tag.
3. Set Worker plaintext var **`PUBLIC_CF_BEACON_TOKEN`** to that hex. Listen is SSR (`env.PUBLIC_CF_BEACON_TOKEN` at request time, same path as `PUBLIC_STREAM_URL`). `npm run deploy` uses `--keep-vars`.
4. If the full snippet was pasted earlier, this Worker extracts the hex and still injects `static.cloudflareinsights.com/beacon.min.js`. Token-only is still the correct stored value.
5. Optional fallback only: **`PUBLIC_GA_MEASUREMENT_ID`** (`G-…`). Skip if Web Analytics is on.

## Panther (station mascot)

Official mascot is Mark’s black cat **Panther**. Silhouettes only — not heroes. Official SVGs from `/badradio/social/panther/` live in [`src/assets/panther/`](src/assets/panther/) (inline) and [`public/panther/`](public/panther/). Body fill **`#2c2c32`**, gold outline **`#e8b030`** (`stroke-width` 18, `paint-order: stroke fill`); amber eyes **`#e8b030`** stay on.

| Pose | File | Placement |
| --- | --- | --- |
| Lounge | `panther-lounge.svg` | Footer ledge; About; empty recently-played |
| Peek | `panther-peek.svg` | Top edge of recently played |
| Loaf | `panther-loaf.svg` | Outpost signup corner; 404 |

CSS: ~64–128px, opacity ~0.45 (dark) / ~0.28 (light), `pointer-events: none`. Eyes stay on. Fill is charcoal `#2c2c32` with amber stroke `#e8b030`. Alt text (also in the SVG `<title>`):

- Lounge: Panther, the station’s black cat, lounging along the ledge
- Peek: Panther peeking over the ledge
- Loaf: Panther loafed in the corner

## Live365 AutoDJ paths

Documented Live365 paths, from their own help and marketing:

1. **Library + playlist + Event (usual AutoDJ path).** Upload MP3/M4A/AAC into the Live365 media library, build a playlist in their dashboard, save so their DMCA check runs, schedule an Event. They do **not** import M3U (that is a long-standing feature request). Use **Desk → Ready JSON / M3U** as a checklist and rebuild the order in their UI.
2. **Icecast-compatible encoder (LiveDJ).** Encode from a studio/laptop to the credentials Live365 shows in the LiveDJ panel. A later slice can be a real Icecast source; this repo is not that encoder.
3. **Stream relay.** Live365 can relay an existing Icecast/HTTP mount. When `badradio.rocks` (or a future origin) has a mount, ask them if they will relay it so licensing and their directory still wrap the stream.

Once Mark has an account, put the **public** listener mount in `PUBLIC_STREAM_URL`. Typical Live365 listener URLs look like `https://streaming.live365.com/aXXXXX` — we will not invent a station id here.

This catalog’s `audio_url` fields are empty on purpose. We are not hosting the 250GB library in this Worker.

### Questions to ask Live365

- Will you **relay** a mount we originate (Icecast on our side, or later `badradio.rocks`), or do you require the library-upload + Event path for licensing to apply?
- Does blanket licensing still apply if we LiveDJ / relay our own encoder, as long as real-time metadata is correct?
- **AI DJ / voice tracks:** can we upload spoken liners as media, or is there a policy problem with synthesized DJ voice?
- **Studio chat** on badradio.rocks: any restriction on running our own chat next to your player/widget?
- **Off-site players:** may we point our own `<audio>` element at the public mount (`PUBLIC_STREAM_URL`), or do you require the Live365 embed/widget for directory / analytics?
- Metadata: what is the supported way to push now-playing if we are the encoder (Icecast headers vs dashboard)?
- Territory: confirm US (SoundExchange + PROs) coverage for our listener mix; Mexico/Canada if that matters.
- Storage: which Broadcast package fits a library that will grow toward ~250GB (their published tiers include 50–750 GB)?

## Station copy (git)

- [`src/content/station/about.mdx`](src/content/station/about.mdx)
- [`src/content/station/schedule.mdx`](src/content/station/schedule.mdx)
- Catalog and seed set as JSON above

## Later (not this slice)

1. Live365 account + `PUBLIC_STREAM_URL` on the Worker
2. Chat Worker
3. AI DJ voice
4. Full library ingest / DIY Icecast / filing SoundExchange ourselves

## License

Station project. Source in this repository is for Bad Radio.
