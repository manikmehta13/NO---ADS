const BASE = "https://no-ads.pages.dev";
let lastUrl = location.href;
let enabled = true;

try {
  chrome.storage.local.get(["enabled"], (res) => { enabled = res.enabled !== false; });
} catch (_) {}
try {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "toggle") enabled = msg.enabled;
  });
} catch (_) {}

function openInNoAds(href) {
  if (!href) return;
  window.open(BASE.replace(/\/+$/, "") + "/?url=" + encodeURIComponent(href), "_blank", "noopener,noreferrer");
}

function redirectToNoAds(url) {
  window.location.replace(BASE.replace(/\/+$/, "") + "/?url=" + encodeURIComponent(url));
}

function checkAndRedirect(url) {
  if (!enabled || url === lastUrl) return;
  lastUrl = url;
  const parsed = new URL(url);
  if ((parsed.pathname === "/watch" || parsed.pathname === "/playlist") && !url.includes("/shorts/")) {
    redirectToNoAds(url);
  }
}

document.addEventListener("click", (e) => {
  if (!enabled) return;
  const link = e.target.closest('a[href*="/watch"], a[href*="/playlist"]');
  if (!link) return;
  const href = link.href;
  if (!href || href.includes("/shorts/")) return;
  e.preventDefault();
  e.stopPropagation();
  openInNoAds(href);
}, true);

document.addEventListener("auxclick", (e) => {
  if (!enabled || e.button !== 1) return;
  const link = e.target.closest('a[href*="/watch"], a[href*="/playlist"]');
  if (!link) return;
  const href = link.href;
  if (!href || href.includes("/shorts/")) return;
  e.preventDefault();
  e.stopPropagation();
  openInNoAds(href);
}, true);

document.addEventListener("yt-navigate-finish", () => checkAndRedirect(location.href));
window.addEventListener("popstate", () => checkAndRedirect(location.href));
setInterval(() => checkAndRedirect(location.href), 2000);
