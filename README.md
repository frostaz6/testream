# TeStream

Self-hosted, Dockerized Stremio library + MPEG-TS player using **Express, ws, ffmpeg 7+ and @cycjimmy/jsmpeg-player**. The browser has **no HTML video element**: MPEG-1 frames are rendered on a canvas and MP2 audio plays through WebAudio. Separate viewers get separate ffmpeg processes.

> **Status:** early implementation; integration testing required. Synthetic encoder checks passed locally. Actual Stremio playback on the owner's Plex host has not yet been tested.

## Install on the machine running Plex

1. Clone the repository and check out the feature branch while its pull request is open.
2. Copy the example environment: `cp .env.example .env`.
3. Run `openssl rand -hex 32` and paste the output into SESSION_SECRET. Set PLEX_ALLOWLIST to your approved Plex usernames and/or account emails. Never commit .env.
4. Start: `docker compose up -d --build`.
5. Open http://127.0.0.1:3000 on your Plex host. Complete Plex verification and then Stremio sign-in.

Docker publishes port 3000 only to **127.0.0.1**. To view on a different computer while keeping it private, use an SSH port forward, for example `ssh -L 3000:127.0.0.1:3000 user@plex-host` and browse http://127.0.0.1:3000.

**Do not publish this service on the Internet yet.** Choose authentication, HTTPS, trusted proxy and rate limits before changing the bind address.

## Features

- Stremio sign-in via Stremio's account login API. Its authKey is stored only in the AES-256-GCM encrypted server-side session store. The browser receives only an opaque HttpOnly cookie.
- Plex PIN login via Plex, checked server-side against PLEX_ALLOWLIST by username or email.
- Home (Continue Watching / Recently Added), Movies, Series, Search, show detail pages with seasons and episodes. Every library request and poster is proxied.
- Installed Stremio add-ons supply direct HTTP media choices. The browser receives only opaque source IDs.
- One WebSocket and one ffmpeg subprocess per viewer. MPEG-TS is binary; status and metrics are JSON text frames, filtered before JSMpeg processes data.
- Recreate ffmpeg after pause, seek, resume or quality change, preserving the last decoded canvas picture until the replacement produces an image.
- Native-rate -re and -readrate_initial_burst 0; MPEG-1 video with no B frames, bitrate/peak/VBV controls, source fps capped at 30 without duplicating film frames, fit-and-pad aspect ratio; 44.1 kHz MP2 audio with -pes_payload_size 0 and -flush_packets 1.
- Gentle compression and limiter with gain to improve quiet audio. Target loudness is approximately -16 LUFS; it is not guaranteed without measuring each source.
- Audio-master browser playout clock, 250 ms initial cushion, adaptive rebuffering up to 2 seconds.
- Automatic 360p/480p/720p selection with a 512 KiB speed test and 50% bandwidth headroom, 2-second health checks, underrun/queue/video lateness step-down, conservative step-up; manual override.
- Generated flash/beep benchmark with software-estimated A/V offset, jitter, drift and first-frame startup time.
- Content-hashed JavaScript/CSS assets, immutable cache headers and no-cache HTML.

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

- SESSION_SECRET of at least 32 characters encrypts the server-side store in ./data. Keep the secret and volume private; losing the secret invalidates all sessions.
- Plex account allowlist is mandatory. Plex PIN sign-in is verified with Plex. Passwords are never persisted.
- Cookie is HttpOnly + SameSite=Lax. Secure is set only when HTTPS is correctly detected through configured TRUST_PROXY=true. Reverse-proxy exposure requires a separate security review.
- ffmpeg and ffprobe use spawn with argv; no shell.
- safeUrl blocks private/local IPs unless trusted. This is not complete protection from DNS rebinding/redirect races in untrusted media endpoints: use trusted add-ons, stay localhost-bound and harden before public exposure.
- No open port-forwarding, public HTTPS, or reverse proxy is configured by default.

## Code layout

- server/app.js: Express + WebSocket relay
- server/stremio.js: account, catalog, metadata, library, stream choices and progress
- server/plex.js: Plex login, allowlist
- server/ffmpeg.js: ffmpeg 7+ arguments and process lifecycle
- server/net.js: source URL validation
- server/sessions.js: encrypted sessions
- client/player.js: JSMpeg canvas, A/V clock, auto quality and buffering
- client/app.js: Stremio-style application navigation
- client/benchmark.js: timing calculations
- scripts/build.mjs: content-hashed asset build
