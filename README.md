# TeStream

Self-hosted, Dockerized Stremio library + MPEG-TS player using **Express, ws, ffmpeg 7+ and @cycjimmy/jsmpeg-player**. The browser has **no HTML video element**: MPEG-1 frames are rendered on a canvas and MP2 audio plays through WebAudio. Separate viewers get separate ffmpeg processes.

> **Status:** early implementation; integration testing required. Synthetic encoder checks passed locally. Actual Stremio playback on the intended Docker host has not yet been tested.

## Install on any Docker host

1. Clone the repository and check out the feature branch while its pull request is open.
2. Copy the example environment: `cp .env.example .env`.
3. Run `openssl rand -hex 32` and paste the output into SESSION_SECRET. The default AUTH_MODE=stremio requires no Plex or Jellyfin installation. Optionally set STREMIO_ALLOWLIST to limit which Stremio email addresses may sign in. Never commit .env.
4. Start: `docker compose up -d --build`.
5. Open http://127.0.0.1:3000 on your Docker host and sign in to Stremio.

Docker publishes port 3000 only to **127.0.0.1**. To view on a different computer while keeping it private, use an SSH port forward, for example `ssh -L 3000:127.0.0.1:3000 user@plex-host` and browse http://127.0.0.1:3000.

**Do not publish this service on the Internet yet.** Choose authentication, HTTPS, trusted proxy and rate limits before changing the bind address.

## Features

- Stremio sign-in via Stremio's account login API. Its authKey is stored only in the AES-256-GCM encrypted server-side session store. The browser receives only an opaque HttpOnly cookie.
- No Plex dependency. Default login is Stremio, optionally checked against STREMIO_ALLOWLIST. Optional AUTH_MODE=jellyfin adds a Jellyfin username/password login and server-enforced JELLYFIN_ALLOWLIST before Stremio login.
- Home (Continue Watching / Recently Added), Movies, Series, Search, show detail pages with seasons and episodes. Every library request and poster is proxied.
- Installed Stremio add-ons supply direct HTTP media choices. The browser receives only opaque source IDs.
- One WebSocket and one ffmpeg subprocess per viewer. MPEG-TS is binary; status and metrics are JSON text frames, filtered before JSMpeg processes data.
- Recreate ffmpeg after pause, seek, resume or quality change, preserving the last decoded canvas picture until the replacement produces an image.
- Native-rate -re and -readrate_initial_burst 0; MPEG-1 video with no B frames, bitrate/peak/VBV controls, source fps capped at 30 without duplicating film frames, fit-and-pad aspect ratio; 44.1 kHz MP2 audio with -pes_payload_size 0 and -flush_packets 1.
- Gentle compression and limiter with gain to improve quiet audio. Target loudness is approximately -16 LUFS; it is not guaranteed without measuring each source.
- Audio-master browser playout clock, 250 ms initial cushion, adaptive rebuffering up to 2 seconds.
- Automatic 360p/480p/720p selection with a 512 KiB speed test and 50% bandwidth headroom, 2-second health checks, underrun/queue/video lateness step-down, conservative step-up; manual override.
- Generated flash/beep benchmark with software-estimated A/V offset, jitter, drift and first-frame startup time.
- Optional FastChannels-compatible M3U channel lineup in Live TV, including temporary ESPN sports-event channels when present; server-side channel selection, ffmpeg MPEG-TS relay, and JSMpeg Canvas only.
- Content-hashed JavaScript/CSS assets, immutable cache headers and no-cache HTML.


## Authentication (no Plex needed)

Default .env: AUTH_MODE=stremio. The browser signs in using Stremio credentials over the locally bound HTTP service; the Stremio auth token remains server-side. You can set STREMIO_ALLOWLIST to comma-separated Stremio email addresses for an extra authorization rule. If Stremio does not return a verified email address, the allowlist refuses access rather than trusting the entered username.

Jellyfin is entirely optional, and only acts as a second authentication gate. For it, configure AUTH_MODE=jellyfin, JELLYFIN_URL=http://host.docker.internal:8096 (if Jellyfin is on the Docker host), and JELLYFIN_ALLOWLIST=username1,username2. The browser then first signs in to Jellyfin and next signs in to Stremio; Jellyfin does not need to serve any media. Jellyfin user IDs can also appear on the allowlist. The optional Jellyfin token is persisted encrypted server-side, never sent to the browser.

**Security:** The default single-account Stremio mode is suitable for localhost-only use. Do not expose it publicly without first deciding on a secure HTTPS reverse proxy and authentication controls. STREMIO_ALLOWLIST does not replace a perimeter for a public service. Jellyfin login over unencrypted HTTP transmits credentials between this container and the Jellyfin server on your local network; prefer HTTPS if they are on different trusted hosts.

## Canvas-only Live TV integration

**The TeStream browser does not use an HTML video element for Live TV.** The Live TV tab reads the configured M3U feed server-side, lists channels/event names, and tunes a selected source through the existing ffmpeg → MPEG-TS → WebSocket → JSMpeg Canvas/WebAudio engine. Channel URLs do not appear in the API responses, only temporary opaque source IDs.

To connect a trusted FastChannels feed:

1. Install and configure FastChannels separately. Use its own official/provider sign-ins and enable only the channels you are authorized to view.
2. Under FastChannels → Feeds, copy an M3U URL, e.g. `http://fastchannels:5523/feeds/default/m3u`. Ensure TeStream's container can reach it.
3. Set `FASTCHANNELS_M3U_URL=http://fastchannels:5523/feeds/default/m3u` and add exactly `fastchannels` to `STREAM_HOST_ALLOWLIST` (only when that hostname resolves to a service you control).
4. Recreate TeStream and open Live TV.

**A playlist is not a decryption mechanism.** DIRECTV STREAM and ESPN premium feeds generally carry Widevine-protected content. If FastChannels returns an encrypted manifest, ffmpeg cannot process it; no Canvas picture will be produced. FastChannels documents an Android/Fire TV capture workflow, but usable output depends on the device, capture hardware, HDCP enforcement, authorization, and provider restrictions. TeStream does not retrieve DRM keys, remove HDCP, or bypass licensing. Only feed accessible, unencrypted media sources into ffmpeg.

This first integration imports M3U channel names and groups, not XMLTV guide data. Live streams have no seek bar; pause/resume or quality changes reconnect at the current live point. No ESPN or DIRECTV account credentials are entered into TeStream. Do not expose FastChannels endpoints to untrusted networks; its documentation says some playback feeds remain open even with admin authentication enabled.

## ESPN+ and DIRECTV STREAM

TeStream displays **official-provider sign-in/watch links** for ESPN+ and DIRECTV STREAM. These are launchers, not native TeStream logins or embedded players. Both services use proprietary account authentication and protected playback, and do not offer a general authorized decoded stream URL for ffmpeg/JSMpeg. TeStream does not obtain, export, spoof or decrypt DRM keys or request these passwords.

An official approved integration can be implemented separately if the services permit it.

## Supported Stremio sources

This player accepts direct http(s) URLs returned by Stremio add-ons. It cannot decode magnet/torrent info hashes, external player links, or DRM-protected sources. A torrent source requires a separate authorized Stremio streaming server that provides an HTTP media URL. Private media hosts need to be specifically listed in STREAM_HOST_ALLOWLIST.

Stremio resume points are updated via datastoreGet/datastorePut every 15 seconds and on playback changes. Some streams lack a probe-able duration; the seek bar is unavailable if the server cannot learn its duration.

## Test

Requires Node 22+, ffmpeg 7+, ffprobe and npm:

1. `npm install`
2. `npm test`
3. `npm run build`
4. `npm run test:media`

The media test encodes a generated flash/beep MPEG-TS, checks codecs, transport timestamps and frame cadence, and verifies 23.976 fps material stays 23.976 fps. It does **not** prove actual network streaming, hardware A/V synchronization or integration with the owner's Stremio account. The real-stream validation procedure is to authenticate, select an HTTP source, play each quality, seek/pause/resume, inspect the player Stats and Docker logs, and run the benchmark page.

Benchmark measurements use callbacks from Canvas and an AnalyserNode in WebAudio. These are **software timing estimates**, not true acoustic/display latency readings. A microphone and high-speed camera are needed to measure the physical output.

Troubleshooting: `docker compose logs -f testream`. Source IDs are transient; refresh the sources list if one expires.

## Security boundaries

- SESSION_SECRET of at least 32 characters encrypts the server-side store in the Docker volume testream-data. Keep the secret and volume private; losing the secret invalidates all sessions.
- Default mode requires a valid Stremio login; STREMIO_ALLOWLIST is optional. If AUTH_MODE=jellyfin, JELLYFIN_URL and a nonempty JELLYFIN_ALLOWLIST are mandatory; Jellyfin passwords are never persisted. Jellyfin session tokens are stored only in the encrypted server-side store.
- Cookie is HttpOnly + SameSite=Lax. Secure is set only when HTTPS is correctly detected through configured TRUST_PROXY=true. Reverse-proxy exposure requires a separate security review.
- ffmpeg and ffprobe use spawn with argv; no shell.
- safeUrl blocks private/local IPs unless trusted. This is not complete protection from DNS rebinding/redirect races in untrusted media endpoints: use trusted add-ons, stay localhost-bound and harden before public exposure.
- No open port-forwarding, public HTTPS, or reverse proxy is configured by default.

## Code layout

- server/app.js: Express + WebSocket relay
- server/stremio.js: account, catalog, metadata, library, stream choices and progress
- server/access.js: selectable authentication mode and allowlist checks
- server/jellyfin.js: optional Jellyfin login
- server/ffmpeg.js: ffmpeg 7+ arguments and process lifecycle
- server/net.js: source URL validation
- server/sessions.js: encrypted sessions
- client/player.js: JSMpeg canvas, A/V clock, auto quality and buffering
- client/app.js: Stremio-style application navigation
- client/benchmark.js: timing calculations
- scripts/build.mjs: content-hashed asset build
