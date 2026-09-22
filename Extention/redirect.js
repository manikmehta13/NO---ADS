(function () {
  const url = new URL(window.location.href);

  // Never redirect the YouTube Playlists page
  if (url.pathname === "/feed/playlists") return;

  // Only redirect videos and individual playlists
  if (
    url.pathname !== "/watch" &&
    url.pathname !== "/playlist"
  ) {
    return;
  }

  chrome.storage.local.get(["enabled"], (res) => {
    if (res.enabled === false) return;

    // Check again in case the URL changed before the callback ran
    if (window.location.pathname === "/feed/playlists") return;

    const target =
      "https://no-ads.pages.dev/?url=" +
      encodeURIComponent(window.location.href);

    window.location.replace(target);
  });
})();