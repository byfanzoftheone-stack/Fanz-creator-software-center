# Creator Center

A local-first creator software center inspired by the supplied neon/mobile creator specifications.

## What works in this build

- Dashboard and project management
- Creator Studio with editable headline, caption, CTA, colors, featured media, notes, progress, and phone preview
- PNG preview export
- Project JSON export
- Media Library with drag/drop image, video, and audio uploads
- Media persistence in browser IndexedDB
- Template library and template-to-project workflow
- Offline Idea Lab that creates structured content ideas without an API
- Wireframe Station with component adding, reordering, inspector editing, list/grid layout, and local save
- Prototype Dynamics with slide, push, fade, and spring previews plus optional vibration cue
- Voice Lab with microphone recording, upload, waveform rendering, playback controls, download, and save-to-library
- Local scheduling queue
- Local workspace analytics and activity log
- JSON workspace backup/import
- Theme accents
- PWA/service-worker support when served over localhost/HTTPS
- Responsive desktop/mobile UI

## Run it locally

The easiest reliable way is to serve the folder locally:

```bash
cd creator-software-center
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

You can also open `index.html` directly for most features, but microphone access and PWA installation normally require `localhost` or HTTPS.

## Important limits

This package is intentionally dependency-free and has no cloud backend. Because of that:

- **Real social publishing is not included.** YouTube, TikTok, Instagram, X, podcast hosts, etc. require their own APIs, OAuth credentials, platform review/permissions, and server-side token handling. The included scheduler is local planning state only.
- **Neural voice cloning is not included.** The Voice Lab records, visualizes, plays back, and stores audio. A real voice-cloning system needs a consent-aware voice model/backend and compute service.
- **Media is local to the browser.** Uploaded media blobs live in IndexedDB. Workspace JSON backup exports metadata, not the large binary media blobs.
- **Local scheduling does not run while the app is closed.** A production scheduler requires a backend worker/queue.

## File structure

- `index.html` — app shell
- `styles.css` — full responsive neon creator UI
- `app.js` — all application logic and local persistence
- `manifest.webmanifest` — installable app metadata
- `sw.js` — offline cache/service worker

## Production next steps

For a production SaaS version, connect the front end to a backend for authentication, team workspaces, object storage, render/export jobs, social OAuth/publishing, background scheduling, analytics ingestion, and optional AI services.
