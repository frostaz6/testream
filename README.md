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
- No Plex dependency. Default login is Stremio, optionally checked against STREMIO_ALLOWLIST. Optional AUTH_MODE=jellyfin enables Jellyfin username/password with JELLYFIN_ALLOWLIST; Live TV and the benchmark can run under Jellyfin authentication alone, while on-demand Stremio titles still require their separate Stremio login.
- Home (Continue Watching / Recently Added), Movies, Series, Search, show detail pages with seasons and episodes. Every library request and poster is proxied.
- Installed Stremio add-ons supply direct HTTP media choices. The browser receives only opaque source IDs.
- One WebSocket and one ffmpeg subprocess per viewer. MPEG-TS is binary; status and metrics are JSON text frames, filtered before JSMpeg processes data.
- Recreate ffmpeg after pause, seek, resume or quality change, preserving the last decoded canvas picture until the replacement produces an image.
- Native-rate -re and -readrate_initial_burst 0; MPEG-1 video with no B frames, bitrate/peak/VBV controls, source fps capped at 30 without duplicating film frames, fit-and-pad aspect ratio; 44.1 kHz MP2 audio with -pes_payload_size 0 and -flush_packets 1.
- Gentle compression and limiter with gain to improve quiet audio. Target loudness is approximately -16 LUFS; it is not guaranteed without measuring each source.
- Audio-master browser playout clock, 250 ms initial cushion, adaptive rebuffering up to 2 seconds.
- Automatic 360p/480p/720p selection with a 512 KiB speed test and 50% bandwidth headroom, 2-second health checks, underrun/queue/video lateness step-down, conservative step-up; manual override.
- Generated flash/beep benchmark with software-estimated A/V offset, jitter, drift and first-frame startup time.
- Optional paired FastChannels M3U + XMLTV feeds for both clear channels and supported capture bridges; now/next program guide, tuner coordination, server-only stream selection, and JSMpeg Canvas/WebAudio playback.
- Content-hashed JavaScript/CSS assets, immutable cache headers and no-cache HTML.


## Authentication (no Plex needed)

Default .env: AUTH_MODE=stremio. The browser signs in using Stremio credentials over the locally bound HTTP service; the Stremio auth token remains server-side. You can set STREMIO_ALLOWLIST to comma-separated Stremio email addresses for an extra authorization rule. If Stremio does not return a verified email address, the allowlist refuses access rather than trusting the entered username.

Jellyfin is entirely optional. In Jellyfin mode, it authorizes Live TV and the benchmark without a Stremio login, while Stremio on-demand playback requires a Stremio account in addition. For it, configure AUTH_MODE=jellyfin, JELLYFIN_URL=http://host.docker.internal:8096 (if Jellyfin is on the Docker host), and JELLYFIN_ALLOWLIST=username1,username2. The browser then first signs in to Jellyfin and next signs in to Stremio; Jellyfin does not need to serve any media. Jellyfin user IDs can also appear on the allowlist. The optional Jellyfin token is persisted encrypted server-side, never sent to the browser.

**Security:** The default single-account Stremio mode is suitable for localhost-only use. Do not expose it publicly without first deciding on a secure HTTPS reverse proxy and authentication controls. STREMIO_ALLOWLIST does not replace a perimeter for a public service. Jellyfin login over unencrypted HTTP transmits credentials between this container and the Jellyfin server on your local network; prefer HTTPS if they are on different trusted hosts.

## Canvas-only Live TV integration

TeStream uses no HTML video element for Live TV. FastChannels provides M3U channel metadata and XMLTV schedules, while TeStream transcodes any **accessible, unencrypted** stream through ffmpeg to JSMpeg Canvas and WebAudio. Merely importing an encrypted ESPN+/DIRECTV manifest does **not** make protected video playable.

### Start FastChannels locally (optional Docker profile)

An opt-in FastChannels service is in docker-compose.yml, but **it is not started by default**.
To start it alongside TeStream, run `docker compose --profile fastchannels up -d --build`.
Open `http://127.0.0.1:5523/admin/` **on the Docker host** (or through an SSH tunnel).
Switch FastChannels to **Advanced mode** and configure the provider logins inside FastChannels, never inside TeStream.

For testing clear channels entirely inside Docker, the default `FASTCHANNELS_PUBLIC_BASE_URL=http://fastchannels:5523` lets TeStream resolve playback endpoints through the private Compose network. Set `STREAM_HOST_ALLOWLIST=fastchannels` for this trusted container name. The `fastchannels` hostname is **not** reachable from your separate TV device.

By default, the FastChannels admin interface is localhost-only. For an Android TV bridge, its player app must reach FastChannels over your private network: choose your specific LAN interface address for `FASTCHANNELS_BIND_IP` and a reachable `FASTCHANNELS_PUBLIC_BASE_URL` only when you're ready, and restrict access with the host firewall. The default localhost URL cannot be reached from a separate Android TV box.

FastChannels needs to pair ADB with the device and an **authorized working capture source** (HDMI Capture or ah4c) before the bridge feeds become functional. FastChannels documentation calls out onn. Android TV devices as possible player targets, but actual model, DRM, HDCP and encoder compatibility require testing.

### Feed configuration

Install and configure FastChannels separately. Its newest documentation lists ESPN and DIRECTV STREAM account integrations and explains how a verified Android/Fire TV device + external capture hardware may provide a bridge output. You must use only provider-authorized playback and respect HDCP restrictions. FastChannels is not automatically deployed by TeStream.

1. In FastChannels → Feeds, copy the **actual M3U and EPG URLs** for your ordinary (clear) channels. Example default feed: `http://fastchannels:5523/feeds/default/m3u` and `http://fastchannels:5523/feeds/default/epg.xml`.
2. If a working capture bridge is available, use FastChannels → Feeds → **Bridge outputs** and copy its **separate, actual M3U and XMLTV URLs**. Do not infer bridge endpoint names from examples.
3. Enter URLs in TeStream's `.env` using `FASTCHANNELS_M3U_URL`, `FASTCHANNELS_EPG_URL`, `FASTCHANNELS_BRIDGE_M3U_URL`, and `FASTCHANNELS_BRIDGE_EPG_URL`. Each pair is optional.
4. Add the FastChannels hostname to `STREAM_HOST_ALLOWLIST` **only if that hostname resolves to your trusted FastChannels instance**. TeStream's container must share a Docker network or otherwise reach that service.
5. Leave `FASTCHANNELS_BRIDGE_TUNERS=1` for a single HDMI capture device. Increase only if your bridge truly provides multiple independent tuners. TeStream blocks competing sessions and allows same-session quality restarts without retuning another viewer.
6. Run `docker compose up -d --build` and open Live TV. It merges the feeds, displays channel numbers plus XMLTV now/next program entries, and supports search and feed filtering. Guide failures are reported without hiding otherwise playable channels.

**No HTML `<video>` fallback:** When a feed is DRM-only or capture fails, show a stream error rather than silently opening a different player. Live pause/resume and quality changes reconnect at the current live point, with no seek bar.

**Important provider caveats:** FastChannels' Android/Fire TV player uses the device's native DRM engine. HDCP or service restrictions may prohibit capture or redistribution. TeStream does not remove HDCP, extract license keys, decrypt protected manifests, automate unauthorized capture, or claim that a capture feed is guaranteed to work. FastChannels' normal and bridge playlists are different. The HDMI capture workflow can require Channels DVR or ah4c plus hardware; it is not a software-only switch. Keep FastChannels and bridge endpoints private, as documented playback routes may not require its admin password.

Documentation: https://github.com/kineticman/FastChannels/blob/main/docs/fc-player-setup.md

### Known gaps

- XMLTV now/next entries are implemented; a full multi-hour grid and per-channel event recording are not yet included.
- Actual ESPN+ or DIRECTV playback has not been validated, and no provider account credentials belong in TeStream.
- For true display/speaker A/V latency measurements, record flash and beep externally using a camera and microphone.

## ESPN+ and DIRECTV STREAM

TeStream displays **official-provider sign-in/watch links** for ESPN+ and DIRECTV STREAM. These are launchers, not native TeStream logins or embedded players. Both services use proprietary account authentication and protected playback, and do not offer a general authorized decoded stream URL for ffmpeg/JSMpeg. TeStream does not obtain, export, spoof or decrypt DRM keys or request these passwords.

An official approved integration can be implemented separately if the services permit it.

## Supported Stremio sources

This player accepts direct http(s) URLs returned by Stremio add-ons. It cannot decode magnet/torrent info hashes, external player links, or DRM-protected sources. A torrent source requires a separate authorized Stremio streaming server that provides an HTTP media URL. Private media hosts need to be specifically listed in STREAM_HOST_ALLOWLIST.

Stremio resume points are updated via datastoreGet/datastorePut every 15 seconds and on playback changes. Some streams lack a probe-able duration; the seek bar is unavailable if the server cannot learn its duration.

## DIRECTV STREAM acceptance test — required before calling it working

The repository and CI do not hold a DIRECTV account or HDMI capture device. We have **not observed real DIRECTV playback**. To consider this functional, verify each stage below:

1. **Login:** Start FastChannels and open its Admin UI. In Advanced mode, enable **DirecTV Stream**, select **Sign in with a code**, approve on DIRECTV's website, then run its channel scrape. Confirm the account is authorized and the chosen channel is in your subscription.
2. **Hardware:** FastChannels → Bridge: configure its Android TV/Fire TV companion app and a working, permitted HDMI Capture or ah4c source. A compatible onn. Android TV device is a possible player. The device must reach FastChannels on your private LAN; its Docker hostname alone is insufficient. HDCP restrictions may prevent output and must not be bypassed.
3. **Healthcheck:** In Bridge → Post-install Healthcheck, run the healthcheck and then Live bridge test on an entitled DIRECTV channel. Observe **moving picture and actual audible sound** from the capture output. A successful channel scrape, ADB launch or HTTP 200 alone is not proof.
4. **Bridge feed:** From FastChannels → Feeds → Bridge outputs copy the exact HDMI Capture/ah4c M3U and EPG URLs into FASTCHANNELS_BRIDGE_M3U_URL and FASTCHANNELS_BRIDGE_EPG_URL. Add only trusted endpoint hosts/IPs to STREAM_HOST_ALLOWLIST. Use the hardware-specific feed, not ordinary HLS or PrismCast output. Prefer FastChannels' **Guide Mode: One mixed playlist** for TeStream, so both Gracenote and XMLTV-partitioned bridge channels are present; copying only a standard/Gracenote partition can silently omit DIRECTV channels.
5. **Canvas tune:** TeStream → Live TV → Show DIRECTV channels. Tune an entitled channel and enable Stats. Verify (a) first encoder packet, (b) nonzero encoded video frames, (c) first Canvas picture, and (d) WebAudio activity. Capture bridge URLs may end in .m3u8 but redirect to HTTP MPEG-TS, so TeStream forces the bridge input demuxer to MPEG-TS.
6. **Soak test:** Watch at least five minutes, change quality, reconnect and monitor frame jitter, audio queue and underruns. A black or silent feed is a failure. For physical display-to-speaker A/V sync, use an external microphone/camera test; callback timing is not sufficient.

Single HDMI capture means **one tuned channel at a time**. TeStream uses a local tuner-lease count, not a distributed lock; it does not coordinate with external Channels DVR viewers or multiple TeStream replicas. Use tuner limits at the capture/bridge layer when other clients share the device.

### Synthetic bridge regression

Run: npm run test:bridge. It generates video/audio MPEG-TS, serves a fake FastChannels-like .m3u8 redirect to an MPEG-TS encoder endpoint, runs the real ffmpeg pipeline and verifies MPEG-1/MP2 output with ffprobe. This verifies the transport path, **not** DIRECTV credentials, DRM, HDMI/HDCP, entitlement or physical A/V sync.

## Test

Requires Node 22+, ffmpeg 7+, ffprobe and npm:

1. `npm install`
2. `npm test`
3. `npm run build`
4. `npm run test:media`
5. `npm run test:bridge`

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
