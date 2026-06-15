# YouTube → No-Ads Opener (Chrome Extension)

Hover over any YouTube video or playlist thumbnail and a small **"No Ads"**
button appears in the corner. Clicking it opens that video/playlist in your
**No-Ads PWA** in a new tab.

It works by sending the YouTube link to your app's share-target URL:
`https://your-app.example/?url=<youtube-link>` — the same mechanism your
PWA already uses (`window.onload` reads the `url`/`text` query param and
calls `embedVideo()` or `embedPlaylist()` depending on whether the link
contains `list=`).

## 1. Install the extension

1. Open `chrome://extensions` (or `edge://extensions` for Edge).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select this folder (`noads-extension/`).

## 2. Point it at your No-Ads app

1. Click the extension's icon in the toolbar.
2. Enter the URL where your No-Ads PWA is hosted, e.g.
   `https://noads.yourdomain.com`.
3. Click **Save**.

(You can change this any time — it's stored in `chrome.storage.sync`, so it
syncs across your signed-in Chrome browsers.)

## 3. Use it

Go to `youtube.com`, hover over any video or playlist thumbnail (home page,
search results, sidebar, channel pages, playlist pages, etc.) — a gradient
**"No Ads"** button fades in over the top-right corner. Click it to open that
video/playlist ad-free in a new tab, powered by your PWA.

## Notes & limitations

- The button is injected via a content script that watches the page for new
  thumbnails (YouTube is a single-page app, so content loads dynamically).
- Works for both single videos (`/watch?v=...`) and playlists
  (`?list=...`) — your PWA already detects which one it is.
- If you haven't set an app URL yet, clicking the button shows a reminder
  toast instead of opening a blank/broken tab.
- YouTube periodically changes its page markup. If buttons stop appearing
  after a YouTube redesign, the CSS selectors in `content.js` /
  `content.css` (`ytd-thumbnail`, `yt-thumbnail-view-model`, etc.) may need
  updating.
- Only `youtube.com` / `m.youtube.com` are matched — `youtu.be` short links
  aren't pages you browse, so there's nothing to hover over there.

## Files

- `manifest.json` — extension configuration (Manifest V3)
- `content.js` — finds thumbnails, injects the button, opens your app
- `content.css` — styling for the button and toast
- `popup.html` / `popup.js` — settings popup to set your app's URL
