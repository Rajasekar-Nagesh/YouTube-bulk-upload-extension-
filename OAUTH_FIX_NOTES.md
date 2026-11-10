# OAuth and channel verification notes (v1.1.2)

## Google Cloud setup

1. Enable **YouTube Data API v3** in the same Google Cloud project as the OAuth client.
2. Configure Google Auth Platform audience as External when using a personal Gmail account.
3. Add the personal Gmail account as a Test user while the consent screen is in Testing.
4. Create an OAuth client of type **Chrome Extension**.
5. Set its Item ID to the exact extension ID shown at chrome://extensions.
6. Copy the resulting client ID into both root manifest.json and public/manifest.json.
7. Keep the client ID suffix `.apps.googleusercontent.com` exactly once.

## Chrome sign-in

Sign in to the Chrome browser profile itself with the Google account used for the channel. Being signed in only to youtube.com does not necessarily sign the Chrome profile into the identity API. Reload the extension after changing OAuth configuration.

## Destination channel safety

The extension calls YouTube Data API `channels.list(mine=true)` and requires exactly one returned channel. It checks the channel ID again before starting the upload queue and checks the channel ID returned by each completed upload. It intentionally stops rather than guessing if no channel or multiple channels are returned.

## Brand Account caveat

A personal Google account may manage more than one YouTube channel. The Data API authorizes uploads as the channel identity associated with the OAuth token; the upload request cannot safely override the destination with an arbitrary channel ID. If the intended Brand Account does not appear in `channels.list(mine=true)`, reconnect and choose the intended identity if Google offers a channel chooser. Some newer YouTube Studio delegated-permission arrangements may not be supported by the YouTube Data API. Do not upload until the expected channel ID is shown.

## Upload behavior

Videos are uploaded with resumable upload sessions, private visibility and `status.publishAt` set from the Excel schedule. All schedule values are interpreted in Asia/Kolkata (UTC+05:30). YouTube publishes the scheduled video; the extension/browser only needs to remain open during the active upload.

## Validation

Run locally before loading the extension:

```bash
npm install
npm run typecheck
npm run build
```

Load the generated `dist` folder at chrome://extensions. The OAuth Chrome Extension client must be registered against the extension ID that Chrome displays for that unpacked extension.
