(function () {
  const url = new URL(window.location.href);
  if (url.pathname !== "/watch" && url.pathname !== "/playlist") return;

  chrome.storage.local.get(["enabled"], (res) => {
    if (res.enabled === false) return;
    const target = "https://no-ads.pages.dev/?url=" + encodeURIComponent(window.location.href);
    window.location.replace(target);
  });
})();
