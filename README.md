# YouTube Bulk Uploader & Scheduler

Chrome Manifest V3 extension built with React, Vite and TypeScript. Import an Excel publishing schedule and a Word (.docx) metadata document, select the folder containing your videos, connect YouTube, verify the destination channel, then upload videos sequentially using YouTube Data API resumable uploads.

## Requirements

- Google Chrome
- Node.js 20+
- Google Cloud project with YouTube Data API v3 enabled
- OAuth client of type **Chrome Extension**, registered with the extension ID shown at chrome://extensions
- Add your Google account as a test user while the OAuth consent screen is in Testing

## Configure OAuth

Set the Chrome Extension OAuth client ID in both `manifest.json` and `public/manifest.json`. Keep the OAuth client type as Chrome Extension and ensure its Item ID exactly matches the unpacked extension ID. Do not commit OAuth client secrets, access tokens, or private keys.

## Build

```bash
npm install
npm run typecheck
npm run build
```

Load the generated `dist` folder at chrome://extensions with Developer mode enabled.

## Workflow

1. Select the local video folder (for example Downloads).
2. Import the Excel schedule with columns `Video Filename`, `Upload Date`, and `Upload Time`.
3. Import a Word document with metadata blocks:

```text
VIDEO: video001.mp4
TITLE: Example title
DESCRIPTION:
Description text
TAGS: tag one, tag two
```

4. Connect YouTube and verify the channel title and ID.
5. Once the schedule and metadata are matched, the queue uploads videos sequentially and schedules publication.

All schedule dates/times are interpreted as India Standard Time (Asia/Kolkata). Videos are uploaded privately with YouTube's `status.publishAt` timestamp. Keep the dashboard tab open during uploads.

## Important limitations

- The YouTube API must return the intended channel for the authenticated identity. The extension blocks if it cannot verify one unambiguous channel.
- Some Brand Account / newer YouTube Studio delegated-permission configurations may not be supported by YouTube Data API.
- The browser must remain open during active uploads. Already scheduled videos are published by YouTube.
- YouTube API quota and channel upload limits apply.
- Directory access is granted by the browser after the user selects a folder.

## Security

The extension processes Excel, Word and video files locally. Video bytes and metadata are sent to YouTube through Google's API. Chrome Identity manages OAuth tokens; the extension does not store raw access tokens in IndexedDB. Never commit credentials or tokens.
