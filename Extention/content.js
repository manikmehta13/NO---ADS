const BASE = "https://no-ads.pages.dev";
let lastUrl = location.href;
let enabled = true;

try {
  chrome.storage.local.get(["enabled"], (res) => {
    enabled = res.enabled !== false;
  });
} catch (_) {}

try {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "toggle") {
      enabled = msg.enabled;
    }
  });
} catch (_) {}

function isExcludedPage(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname === "/feed/playlists";
  } catch (_) {
    return false;
  }
}

function openInNoAds(href) {
  if (!href || isExcludedPage(href)) return;

  window.open(
    BASE.replace(/\/$/, "") +
      "/?url=" +
      encodeURIComponent(href),
    "_blank",
    "noopener,noreferrer"
  );
}

function redirectToNoAds(url) {
  if (isExcludedPage(url)) return;

  window.location.replace(
    BASE.replace(/\/$/, "") +
      "/?url=" +
      encodeURIComponent(url)
  );
}

function checkAndRedirect(url) {
  if (!enabled || url === lastUrl) return;

  lastUrl = url;

  const parsed = new URL(url);

  // NEVER redirect the Playlists page
  if (parsed.pathname === "/feed/playlists") return;

  if (
    (parsed.pathname === "/watch" ||
      parsed.pathname === "/playlist") &&
    !parsed.pathname.startsWith("/shorts/")
  ) {
    redirectToNoAds(url);
  }
}

/*
 * Handle normal left-clicks.
 */
document.addEventListener(
  "click",
  (e) => {
    if (!enabled) return;

    const link = e.target.closest("a");

    if (!link) return;

    const href = link.href;

    if (!href) return;

    const parsed = new URL(href);

    // Never interfere with YouTube's Playlists page
    if (parsed.pathname === "/feed/playlists") return;

    // Only redirect actual video / playlist URLs
    const isWatch = parsed.pathname === "/watch";
    const isPlaylist = parsed.pathname === "/playlist";

    if (!isWatch && !isPlaylist) return;

    if (parsed.pathname.startsWith("/shorts/")) return;

    e.preventDefault();
    e.stopPropagation();

    openInNoAds(href);
  },
  true
);

/*
 * Handle middle-clicks.
 */
document.addEventListener(
  "auxclick",
  (e) => {
    if (!enabled || e.button !== 1) return;

    const link = e.target.closest("a");

    if (!link) return;

    const href = link.href;

    if (!href) return;

    const parsed = new URL(href);

    // Never interfere with YouTube's Playlists page
    if (parsed.pathname === "/feed/playlists") return;

    const isWatch = parsed.pathname === "/watch";
    const isPlaylist = parsed.pathname === "/playlist";

    if (!isWatch && !isPlaylist) return;

    if (parsed.pathname.startsWith("/shorts/")) return;

    e.preventDefault();
    e.stopPropagation();

    openInNoAds(href);
  },
  true
);

/*
 * YouTube SPA navigation.
 */
document.addEventListener("yt-navigate-finish", () => {
  checkAndRedirect(location.href);
});

window.addEventListener("popstate", () => {
  checkAndRedirect(location.href);
});

/*
 * Backup check for navigation that YouTube performs
 * without firing the expected event.
 */
setInterval(() => {
  checkAndRedirect(location.href);
}, 2000);