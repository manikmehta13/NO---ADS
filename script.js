// ── State ─────────────────────────────────────────────────
let shuffleEnabled        = false;
let ytPlayer              = null;
let ytApiReady            = false;
let pendingPlaylistId     = null;
let pendingVideoId        = null;
let singleVideoAutoPlay   = false;
let isPlaylistMode        = false;
let playlistVideoIds      = [];
let currentlyPlayingIndex = 0;
let playlistTitles        = [];
let titleFetchAbort       = null;
let recFetchAbort         = null;

// ── Service Worker ─────────────────────────────────────────
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js")
    .then(() => console.log("SW registered"))
    .catch((e) => console.log("SW failed", e));
}

// ── Background / screen-off playback ──────────────────────
// Strategy:
//   1. Wake Lock API  — prevents screen sleep on Android Chrome
//   2. Silent AudioContext — keeps iOS audio session alive so the
//      YouTube iframe audio isn't suspended when screen turns off
//   3. visibilitychange resume — re-triggers play on return if iOS
//      paused the iframe while backgrounded

let _wakeLock   = null;
let _audioCtx   = null;
let _silentNode = null;

async function _acquireWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    _wakeLock = await navigator.wakeLock.request("screen");
    _wakeLock.addEventListener("release", () => { _wakeLock = null; });
  } catch (_) {}
}

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible") {
    // Re-acquire wake lock if it was released (happens on tab switch)
    if (!_wakeLock) await _acquireWakeLock();

    // Resume if iOS paused the iframe while backgrounded
    if (ytPlayer && typeof ytPlayer.getPlayerState === "function") {
      try {
        const state = ytPlayer.getPlayerState();
        if (state === 2 || state === -1) ytPlayer.playVideo();
      } catch (_) {}
    }
  }
});

// A near-silent oscillator keeps the iOS WebAudio session open, which
// prevents the OS from suspending the YouTube iframe's audio track.
function _startSilentAudio() {
  if (_audioCtx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    _audioCtx   = new AC();
    _silentNode = _audioCtx.createOscillator();
    const gain  = _audioCtx.createGain();
    gain.gain.setValueAtTime(0.00001, _audioCtx.currentTime); // inaudible
    _silentNode.connect(gain);
    gain.connect(_audioCtx.destination);
    _silentNode.start();
  } catch (_) {}
}

function _initBackgroundPlayback() {
  _startSilentAudio();
  _acquireWakeLock();
}

// Must be triggered from a user gesture to satisfy autoplay policy
["touchstart", "mousedown", "keydown"].forEach(evt =>
  document.addEventListener(evt, _initBackgroundPlayback, { once: true, passive: true })
);

// ── YouTube IFrame API bootstrap ───────────────────────────
function loadYouTubeAPI() {
  if (document.getElementById("yt-api-script")) return;
  const s = document.createElement("script");
  s.id  = "yt-api-script";
  s.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(s);
}

window.onYouTubeIframeAPIReady = function () {
  ytApiReady = true;
  if (pendingPlaylistId) {
    _initYTPlayer(pendingPlaylistId);
    pendingPlaylistId = null;
  }
  if (pendingVideoId) {
    _initSinglePlayer(pendingVideoId);
    pendingVideoId = null;
  }
};

// ── PWA share-target entry ─────────────────────────────────
window.onload = function () {
  const params    = new URLSearchParams(window.location.search);
  let   sharedUrl = params.get("url") || params.get("text");

  if (sharedUrl) {
    sharedUrl = decodeURIComponent(sharedUrl.trim());
    document.getElementById("videoLink").value = sharedUrl;

    const cb = document.getElementById("clearBtn");
    if (cb) { cb.style.opacity = "1"; cb.style.pointerEvents = "auto"; }

    if (sharedUrl.includes("youtube.com") || sharedUrl.includes("youtu.be")) {
      sharedUrl.includes("list=") ? embedPlaylist() : embedVideo();
    }
  }

  // Load feed on page load — "For You" if OAuth, trending otherwise
  if (ytApiKey) loadCategory("trending");
};

// ── Shuffle toggle ─────────────────────────────────────────
function toggleShuffle() {
  shuffleEnabled = !shuffleEnabled;

  const btn = document.getElementById("shuffleToggle");
  const ind = document.getElementById("shuffleIndicator");
  const lbl = document.getElementById("shuffleLabel");

  btn.classList.toggle("shuffle-on", shuffleEnabled);
  ind.classList.toggle("on",         shuffleEnabled);
  lbl.textContent = shuffleEnabled ? "Shuffle On" : "Shuffle Off";

  showToast(shuffleEnabled
    ? "Shuffle enabled — next playlist will play in random order."
    : "Shuffle disabled."
  );
}

// ── Video embed (single video) ─────────────────────────────
function embedVideo() {
  const link    = document.getElementById("videoLink").value;
  const videoId = extractVideoID(link);
  const vc      = document.getElementById("videoContainer");

  _resetPlayer();
  _setPlaylistMode(false);
  vc.innerHTML = "";

  if (videoId) {
    const host = document.createElement("div");
    host.id = "yt-player-host";
    host.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
    vc.appendChild(host);
    loadYouTubeAPI();
    if (ytApiReady) {
      _initSinglePlayer(videoId);
    } else {
      pendingVideoId = videoId;
    }
    singleVideoAutoPlay = true;
    fetchRecommendations(videoId);
  } else {
    showToast("Please enter a valid YouTube link.");
  }
}

// ── Playlist embed — always via YT IFrame API ─────────────
function embedPlaylist() {
  const link       = document.getElementById("videoLink").value;
  const playlistId = extractPlaylistID(link);
  const vc         = document.getElementById("videoContainer");

  if (!playlistId) {
    showToast("Please enter a valid YouTube playlist link.");
    return;
  }

  _resetPlayer();
  _setPlaylistMode(false);
  vc.innerHTML = "";

  const host    = document.createElement("div");
  host.id       = "yt-player-host";
  host.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  vc.appendChild(host);

  loadYouTubeAPI();

  if (ytApiReady) {
    _initYTPlayer(playlistId);
  } else {
    pendingPlaylistId = playlistId;
  }
}

// ── Internal: create YT Player instance ───────────────────
function _initYTPlayer(playlistId) {
  ytPlayer = new YT.Player("yt-player-host", {
    width  : "100%",
    height : "100%",
    playerVars: {
      listType       : "playlist",
      list           : playlistId,
      autoplay       : 1,
      rel            : 0,
      modestbranding : 1,
    },
    events: {
      onReady      : _onPlayerReady,
      onStateChange: _onPlayerStateChange,
      onError      : () => showToast("Couldn't load the playlist. Check the link and try again."),
    },
  });
}

// ── Internal: create YT Player for a single video ─────────
function _initSinglePlayer(videoId) {
  ytPlayer = new YT.Player("yt-player-host", {
    width  : "100%",
    height : "100%",
    videoId: videoId,
    playerVars: {
      autoplay       : 1,
      rel            : 0,
      modestbranding : 1,
    },
    events: {
      onReady      : _onSinglePlayerReady,
      onStateChange: _onSinglePlayerStateChange,
      onError      : () => showToast("Couldn't load the video."),
    },
  });
}

function _onSinglePlayerReady(event) {
  _acquireWakeLock();
  singleVideoAutoPlay = true;
}

function _onSinglePlayerStateChange(event) {
  // 0 = ENDED
  if (event.data === 0 && singleVideoAutoPlay) {
    singleVideoAutoPlay = false;
    _playFirstRec();
  }
}

function _playFirstRec() {
  const first = document.querySelector("#recItems .rec-item");
  if (first) {
    first.click();
    showToast("▶ Auto-playing next recommendation");
  }
}

function _onPlayerReady(event) {
  // Acquire/re-acquire wake lock now that media is active
  _acquireWakeLock();

  if (shuffleEnabled) {
    event.target.setShuffle(true);
    event.target.playVideo();
  }

  const ids = event.target.getPlaylist();
  if (ids && ids.length) {
    playlistVideoIds = ids;
    _setPlaylistMode(true);
    fetchPlaylistTitles(ids);
  }

  currentlyPlayingIndex = event.target.getPlaylistIndex() || 0;
}

function _onPlayerStateChange(event) {
  // 1 = PLAYING
  if (event.data === 1 && ytPlayer) {
    const prevIndex = currentlyPlayingIndex;
    currentlyPlayingIndex = ytPlayer.getPlaylistIndex();
    _refreshCurrentCard();

    // Fetch recommendations for the current video in playlist mode
    if (isPlaylistMode && currentlyPlayingIndex >= 0) {
      const vidId = playlistVideoIds[currentlyPlayingIndex];
      if (vidId) fetchRecommendations(vidId);
    }
  }
}

// ── Playlist browser: open ─────────────────────────────────
function openPlaylistPanel() {
  if (!playlistVideoIds.length) {
    showToast("Playlist data isn't ready yet — try again in a moment.");
    return;
  }

  _buildPanelItems();

  document.getElementById("ppPanel").classList.add("open");
  document.getElementById("ppBackdrop").classList.add("open");
  document.body.classList.add("panel-open");
}

// ── Playlist browser: close ────────────────────────────────
function closePlaylistPanel() {
  document.getElementById("ppPanel")?.classList.remove("open");
  document.getElementById("ppBackdrop")?.classList.remove("open");
  document.body.classList.remove("panel-open");
}

// ── Build item list inside panel ───────────────────────────
function _buildPanelItems() {
  const container = document.getElementById("ppItems");
  container.innerHTML = "";

  const total = playlistVideoIds.length;
  document.getElementById("ppCount").textContent =
    `${total} video${total !== 1 ? "s" : ""}`;

  const limit = Math.min(total, 200);

  playlistVideoIds.slice(0, limit).forEach((id, i) => {
    const isNow  = i === currentlyPlayingIndex;
    const cached = playlistTitles[i];
    const card   = document.createElement("div");
    card.className     = "pp-item" + (isNow ? " now-playing" : "");
    card.id            = `ppItem-${i}`;
    card.dataset.index = i;

    card.innerHTML = `
      <div class="pp-thumb-wrap">
        <img
          src="https://img.youtube.com/vi/${id}/mqdefault.jpg"
          class="pp-thumb"
          loading="lazy"
          alt="Video thumbnail"
        />
        <div class="pp-thumb-overlay">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18a1 1 0 000-1.69L9.54 5.98A.998.998 0 008 6.82z"/>
          </svg>
        </div>
        ${isNow ? `<span class="pp-now-badge">▶ NOW</span>` : `<span class="pp-num">${i + 1}</span>`}
      </div>
      <div class="pp-info">
        <p class="pp-title" id="ppTitle-${i}">${cached || "Loading…"}</p>
        <p class="pp-meta">${isNow ? "Now playing" : ""}</p>
      </div>
    `;

    card.addEventListener("click", () => playVideoAt(i));
    container.appendChild(card);
  });

  if (total > 200) {
    const note = document.createElement("p");
    note.className   = "pp-overflow-note";
    note.textContent = `Showing first 200 of ${total} videos.`;
    container.appendChild(note);
  }

  // Scroll to current video
  requestAnimationFrame(() => {
    const el = document.getElementById(`ppItem-${currentlyPlayingIndex}`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

// ── Play a video immediately by index ─────────────────────
function playVideoAt(index) {
  if (!ytPlayer || typeof ytPlayer.playVideoAt !== "function") {
    showToast("Playback control isn't available yet.");
    return;
  }

  ytPlayer.playVideoAt(index);

  // Update header label
  const titleEl = document.getElementById(`ppTitle-${index}`);
  const title   = titleEl?.textContent;
  const label   = document.getElementById("videoLabel");
  if (label) {
    label.textContent = shuffleEnabled
      ? "🔀 Shuffling playlist"
      : `▶ ${title && title !== "Loading…" ? title : "Playing playlist"}`;
  }

  closePlaylistPanel();
  showToast("Playing now 🎵");
}

// ── Update the "now playing" highlight in panel ────────────
function _refreshCurrentCard() {
  document.querySelectorAll(".pp-item.now-playing").forEach(el => {
    el.classList.remove("now-playing");
    el.querySelector(".pp-now-badge")?.remove();
    const idx     = parseInt(el.dataset.index, 10);
    const thumbWrap = el.querySelector(".pp-thumb-wrap");
    if (thumbWrap && !thumbWrap.querySelector(".pp-num")) {
      const s = document.createElement("span");
      s.className   = "pp-num";
      s.textContent = idx + 1;
      thumbWrap.appendChild(s);
    }
    const meta = el.querySelector(".pp-meta");
    if (meta) meta.textContent = "";
  });

  const card = document.getElementById(`ppItem-${currentlyPlayingIndex}`);
  if (!card) return;
  card.classList.add("now-playing");

  const thumbWrap = card.querySelector(".pp-thumb-wrap");
  if (thumbWrap && !thumbWrap.querySelector(".pp-now-badge")) {
    thumbWrap.querySelector(".pp-num")?.remove();
    const badge = document.createElement("span");
    badge.className   = "pp-now-badge";
    badge.textContent = "▶ NOW";
    thumbWrap.appendChild(badge);
  }

  const meta = card.querySelector(".pp-meta");
  if (meta) meta.textContent = "Now playing";
}

// ── Fetch playlist titles ──────────────────────────────────
async function fetchPlaylistTitles(ids) {
  if (titleFetchAbort) titleFetchAbort.abort();
  const ctrl  = new AbortController();
  titleFetchAbort = ctrl;

  const limit = Math.min(ids.length, 200);
  playlistTitles = [];

  // Use YouTube Data API v3 if a key is available
  if (ytApiKey) {
    const batchSize = 50;
    for (let start = 0; start < limit; start += batchSize) {
      if (ctrl.signal.aborted) break;
      const batch = ids.slice(start, start + batchSize);
      const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${batch.join(",")}&key=${ytApiKey}`;
      try {
        const res  = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error("non-200");
        const data = await res.json();
        if (ctrl.signal.aborted) break;
        for (const item of data.items || []) {
          const idx = ids.indexOf(item.id);
          if (idx === -1) continue;
          const title = item.snippet?.title || `Video ${idx + 1}`;
          playlistTitles[idx] = title;
          const el = document.getElementById(`ppTitle-${idx}`);
          if (el) el.textContent = title;
        }
        await _sleep(200);
      } catch (e) {
        if (e.name === "AbortError") break;
      }
    }
    return;
  }

  // Fallback: YouTube oEmbed (no key needed)
  for (let i = 0; i < limit; i++) {
    if (ctrl.signal.aborted) break;

    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ids[i]}&format=json`;
    try {
      const res  = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error("non-200");
      const data = await res.json();
      const title = data.title || `Video ${i + 1}`;
      playlistTitles[i] = title;
      const el = document.getElementById(`ppTitle-${i}`);
      if (el) el.textContent = title;
    } catch (e) {
      if (e.name === "AbortError") break;
      const title = `Video ${i + 1}`;
      playlistTitles[i] = title;
      const el = document.getElementById(`ppTitle-${i}`);
      if (el && el.textContent === "Loading…") el.textContent = title;
    }

    await _sleep(55);
  }
}

// ── Show / hide the Browse button ─────────────────────────
function _setPlaylistMode(on) {
  isPlaylistMode = on;
  const btn = document.getElementById("browseBtn");
  if (btn) btn.style.display = on ? "flex" : "none";
}

// ── Full reset ─────────────────────────────────────────────
function _resetPlayer() {
  closePlaylistPanel();
  playlistVideoIds      = [];
  playlistTitles        = [];
  currentlyPlayingIndex = 0;
  if (titleFetchAbort) { titleFetchAbort.abort(); titleFetchAbort = null; }
  if (ytPlayer && typeof ytPlayer.destroy === "function") {
    ytPlayer.destroy();
    ytPlayer = null;
  }
}

// ── Helpers ────────────────────────────────────────────────
function _standardIframe(src) {
  const f = document.createElement("iframe");
  f.src   = src;
  f.setAttribute("allowfullscreen", "true");
  f.setAttribute("frameborder", "0");
  f.setAttribute("playsinline", "true");
  f.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; background-sync");
  f.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:none;";
  return f;
}

function extractVideoID(url) {
  const m = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:shorts\/|live\/|[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed|live)?)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function extractPlaylistID(url) {
  const m = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function showToast(message) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.style.cssText = `
      position:fixed;bottom:2rem;left:50%;transform:translateX(-50%) translateY(20px);
      background:rgba(255,255,255,0.1);backdrop-filter:blur(20px);
      border:1px solid rgba(255,255,255,0.12);color:#f4f2ff;
      padding:12px 22px;border-radius:100px;font-size:0.85rem;
      font-family:'DM Sans',sans-serif;font-weight:300;
      opacity:0;transition:opacity 0.3s,transform 0.3s;z-index:9999;white-space:nowrap;
    `;
    document.body.appendChild(t);
  }
  t.textContent = message;
  t.style.opacity   = "1";
  t.style.transform = "translateX(-50%) translateY(0)";
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.style.opacity   = "0";
    t.style.transform = "translateX(-50%) translateY(20px)";
  }, 3200);
}

// ── Recommendations ────────────────────────────────────────
var ytApiKey        = window.ytApiKey        || "";

const RECOMMENDATION_APIS = [];

async function fetchRecommendations(videoId) {
  if (recFetchAbort) recFetchAbort.abort();
  const ctrl = new AbortController();
  recFetchAbort = ctrl;

  const recSection = document.getElementById("recSection");
  const recItems   = document.getElementById("recItems");
  recSection.classList.remove("hidden");
  recItems.innerHTML =
    '<div class="rec-status"><span class="rec-spinner"></span>Loading recommendations…</div>';

  // Try YouTube Data API v3 first if user has provided a key or OAuth token
  if (ytApiKey) {
    try {
      const data = await _fetchYoutubeApi(videoId, ctrl.signal);
      if (data) { _renderRecommendations(data); return; }
    } catch (_) {}
  }

  // Fallback to third-party proxy APIs
  for (const api of RECOMMENDATION_APIS) {
    if (ctrl.signal.aborted) return;
    try {
      const data = await _fetchFromApi(api, videoId, ctrl.signal);
      if (data) { _renderRecommendations(data); return; }
    } catch (_) {}
  }

  if (!ctrl.signal.aborted) {
    const msg = (ytApiKey)
      ? 'Recommendations unavailable. Check console for details.'
      : 'Sign in with Google to see recommendations.';
    recItems.innerHTML = `<div class="rec-status">${msg}</div>`;
  }
}

async function _fetchFromApi(api, videoId, signal) {
  const timeout = AbortSignal.timeout ? AbortSignal.timeout(8000) : null;
  const combined = timeout
    ? _combineAbort(signal, timeout)
    : signal;

  if (api.type === "piped") {
    const res = await fetch(`${api.url}/next?videoId=${encodeURIComponent(videoId)}`, { signal: combined });
    if (!res.ok) return null;
    const data = await res.json();
    if (signal.aborted) return null;
    const streams = (data.relatedStreams || []).filter(s => !s.isShort);
    if (!streams.length) return null;
    return streams.map(s => ({
      videoId: _extractRecVideoId(s.url) || "",
      title: s.title || "Video",
      lengthSeconds: s.duration || 0,
      author: s.uploaderName || "",
      thumbnail: s.thumbnail || `https://img.youtube.com/vi/${_extractRecVideoId(s.url) || videoId}/mqdefault.jpg`,
    }));
  }

  if (api.type === "invidious") {
    const res = await fetch(
      `${api.url}/api/v1/videos/${encodeURIComponent(videoId)}?fields=recommendedVideos(videoId,title,lengthSeconds,author,videoThumbnails(quality,url))`,
      { signal: combined }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (signal.aborted) return null;
    const recs = data.recommendedVideos || [];
    if (!recs.length) return null;
    return recs.map(s => ({
      videoId: s.videoId || "",
      title: s.title || "Video",
      lengthSeconds: s.lengthSeconds || 0,
      author: s.author || "",
      thumbnail: _bestThumb(s.videoThumbnails),
    }));
  }

  return null;
}

async function _fetchYoutubeApi(videoId, signal) {
  const timeout = AbortSignal.timeout ? AbortSignal.timeout(10000) : null;
  const combined = timeout ? _combineAbort(signal, timeout) : signal;

  // Get video title first via oembed (no key needed)
  const oembRes = await fetch(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
    { signal: combined }
  );
  if (!oembRes.ok) return null;
  const oemb = await oembRes.json();
  if (signal.aborted) return null;
  const title = (oemb.title || "").replace(/[^a-zA-Z0-9 ]/g, "").trim();
  if (!title) return null;

  // Search YouTube using the title
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=24&type=video&q=${encodeURIComponent(title)}&key=${ytApiKey}`;
  const res = await fetch(url, { signal: combined });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg = errBody?.error?.message || `HTTP ${res.status}`;
    console.error("YouTube API error (search):", msg);
    return null;
  }
  const data = await res.json();
  if (signal.aborted) return null;
  const items = data.items || [];
  if (!items.length) return null;
  return items.map(s => ({
    videoId: s.id?.videoId || "",
    title: s.snippet?.title || "Video",
    lengthSeconds: 0,
    author: s.snippet?.channelTitle || "",
    thumbnail: s.snippet?.thumbnails?.medium?.url || s.snippet?.thumbnails?.default?.url || "",
  }));
}

function _combineAbort(signalA, signalB) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signalA.addEventListener("abort", onAbort);
  signalB.addEventListener("abort", onAbort);
  if (signalA.aborted || signalB.aborted) ctrl.abort();
  return ctrl.signal;
}

function _bestThumb(thumbnails) {
  if (!thumbnails || !thumbnails.length) return "";
  const pref = ["medium", "high", "default", "maxres"];
  for (const q of pref) {
    const t = thumbnails.find(th => th.quality === q);
    if (t) return t.url;
  }
  return thumbnails[0].url || "";
}

function _renderRecommendations(list) {
  const container = document.getElementById("recItems");
  container.innerHTML = "";

  if (!list.length) {
    container.innerHTML =
      '<div class="rec-status">No recommendations available.</div>';
    return;
  }

  const limit = Math.min(list.length, 24);

  for (let i = 0; i < limit; i++) {
    const s     = list[i];
    if (!s.videoId) continue;

    const card = document.createElement("div");
    card.className = "rec-item";
    card.innerHTML = `
      <div class="rec-thumb-wrap">
        <img src="${_escapeHtml(s.thumbnail || `https://img.youtube.com/vi/${s.videoId}/mqdefault.jpg`)}"
             class="rec-thumb" loading="lazy" alt="" />
        <div class="rec-thumb-overlay">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18a1 1 0 000-1.69L9.54 5.98A.998.998 0 008 6.82z"/>
          </svg>
        </div>
        ${_formatDuration(s.lengthSeconds)}
      </div>
      <div class="rec-info">
        <p class="rec-title">${_escapeHtml(s.title)}</p>
        <p class="rec-channel">${_escapeHtml(s.author)}</p>
      </div>
    `;

    card.addEventListener("click", () => playRecVideo(s.videoId, s.title));
    container.appendChild(card);
  }
}

function playRecVideo(videoId, title) {
  const label = document.getElementById("videoLabel");
  if (label) label.textContent = title || "Now playing";
  embedVideoFromId(videoId);
}

function _extractRecVideoId(url) {
  if (!url) return null;
  const m = url.match(/(?:watch\?v=|\/)([a-zA-Z0-9_-]{11})(?:[?&/]|$)/);
  return m ? m[1] : null;
}

function _formatDuration(sec) {
  if (!sec && sec !== 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `<span class="rec-duration">${m}:${String(s).padStart(2, "0")}</span>`;
}

function _escapeHtml(str) {
  if (!str) return "";
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ── Category feed ──────────────────────────────────────────
const CATEGORIES = {
  trending:  { label: "Trending",       icon: "trending", type: "trending" },
  music:     { label: "Music",          icon: "music",    type: "catId",    id: "10" },
  gaming:    { label: "Gaming",         icon: "gaming",   type: "catId",    id: "20" },
  news:      { label: "News",           icon: "news",     type: "catId",    id: "25" },
  sports:    { label: "Sports",         icon: "sports",   type: "catId",    id: "17" },
  movies:    { label: "Movies",         icon: "movies",   type: "catId",    id: "1"  },
  shopping:  { label: "Shopping",       icon: "shopping", type: "search",   q: "shopping haul" },
  fashion:   { label: "Fashion & Beauty", icon: "fashion", type: "catId",   id: "26" },
  courses:        { label: "Courses",        icon: "courses",  type: "search",   q: "courses" },
  recommendations: { label: "Recommendations", icon: "rec",     type: "search",  q: "recommended videos" },
  shorts:          { label: "Shorts",         icon: "shorts",  type: "shorts" },
  live:            { label: "Live",           icon: "live",    type: "live" },
};

function toggleCatBar() {
  const bar = document.getElementById("catBar");
  const btn = document.getElementById("catToggle");
  const feed = document.getElementById("feedSection");
  const closed = !bar.classList.contains("collapsed");
  bar.classList.toggle("collapsed", closed);
  btn.classList.toggle("collapsed", closed);
  if (feed) feed.classList.toggle("collapsed", closed);
  localStorage.setItem("catBarCollapsed", closed);
}

// Restore collapsed state on load
window.addEventListener("DOMContentLoaded", () => {
  if (localStorage.getItem("catBarCollapsed") === "true") {
    document.getElementById("catBar").classList.add("collapsed");
    document.getElementById("catToggle").classList.add("collapsed");
    const feed = document.getElementById("feedSection");
    if (feed) feed.classList.add("collapsed");
  }
});

async function loadCategory(catId) {
  const cat = CATEGORIES[catId];
  if (!cat) return;

  const label = document.getElementById("feedHeaderLabel");
  if (label) label.textContent = cat.label;

  document.querySelectorAll(".cat-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.cat === catId);
  });

  if (!ytApiKey) {
    document.getElementById("feedGrid").innerHTML =
      `<div class="feed-status">Sign in with Google to see ${cat.label} videos.</div>`;
    return;
  }

  const grid = document.getElementById("feedGrid");
  grid.innerHTML = '<div class="feed-status"><span class="rec-spinner"></span>Loading…</div>';

  try {
    const ctrl = new AbortController();
    let url;

    if (cat.type === "trending") {
      url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&chart=mostPopular&maxResults=30&regionCode=US&key=${ytApiKey}`;
    } else if (cat.type === "catId") {
      url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&chart=mostPopular&videoCategoryId=${cat.id}&maxResults=30&regionCode=US&key=${ytApiKey}`;
    } else if (cat.type === "shorts") {
      url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=30&type=video&videoDuration=short&q=shorts&key=${ytApiKey}`;
    } else if (cat.type === "live") {
      url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=30&type=video&eventType=live&q=live&key=${ytApiKey}`;
    } else {
      url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=30&type=video&q=${encodeURIComponent(cat.q)}&key=${ytApiKey}`;
    }

    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = errBody?.error?.message || `HTTP ${res.status}`;
      console.error("YouTube API error:", msg);
      _emptyFeed(
        res.status === 403
          ? 'YouTube Data API is not enabled. Go to <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" class="rec-link">Google Cloud Console</a> and enable it.'
          : `API error: ${_escapeHtml(msg)}`
      );
      return;
    }
    const data = await res.json();
    let items = data.items || [];
    if (!items.length) { _emptyFeed("No videos available."); return; }

    _renderFeed(items);
  } catch (e) {
    _emptyFeed("Could not load videos.");
  }
}

// Keep loadFeed as alias for backward compat
function loadFeed() {
  loadCategory("trending");
}

function _emptyFeed(msg) {
  document.getElementById("feedGrid").innerHTML = `<div class="feed-status">${msg}</div>`;
}

function _clearFeed() {
  const active = document.querySelector(".cat-btn.active");
  const label = active ? active.textContent.trim() : "trending";
  document.getElementById("feedGrid").innerHTML =
    `<div class="feed-status">Sign in with Google to see ${label} videos.</div>`;
}

function _renderFeed(items) {
  const grid = document.getElementById("feedGrid");
  grid.innerHTML = "";

  for (const item of items) {
    const vidId = item.id || "";
    if (!vidId) continue;
    const snip = item.snippet || {};
    const dur  = _parseDuration(item.contentDetails?.duration);

    const card = document.createElement("div");
    card.className = "feed-card";
    card.innerHTML = `
      <div class="feed-thumb-wrap">
        <img src="${_escapeHtml(snip.thumbnails?.medium?.url || snip.thumbnails?.default?.url || "")}"
             class="feed-thumb" loading="lazy" alt="" />
        <div class="feed-thumb-overlay">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18a1 1 0 000-1.69L9.54 5.98A.998.998 0 008 6.82z"/>
          </svg>
        </div>
        ${dur ? `<span class="feed-duration">${dur}</span>` : ""}
      </div>
      <div class="feed-info">
        <p class="feed-title">${_escapeHtml(snip.title || "Video")}</p>
        <p class="feed-channel">${_escapeHtml(snip.channelTitle || "")}</p>
      </div>
    `;

    card.addEventListener("click", () => playFeedVideo(vidId, snip.title));
    grid.appendChild(card);
  }
}

function playFeedVideo(videoId, title) {
  const label = document.getElementById("videoLabel");
  if (label) label.textContent = title || "Now playing";

  embedVideoFromId(videoId);
}

function embedVideoFromId(videoId) {
  _resetPlayer();
  _setPlaylistMode(false);

  const vc = document.getElementById("videoContainer");
  vc.innerHTML = "";

  const host = document.createElement("div");
  host.id = "yt-player-host";
  host.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  vc.appendChild(host);
  loadYouTubeAPI();
  if (ytApiReady) {
    _initSinglePlayer(videoId);
  } else {
    pendingVideoId = videoId;
  }
  singleVideoAutoPlay = true;
  fetchRecommendations(videoId);

  const sec = document.getElementById("videoSection");
  sec.classList.remove("hidden");
  setTimeout(() => sec.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
}

function _parseDuration(iso) {
  if (!iso) return "";
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "";
  const h = parseInt(m[1] || "0", 10);
  const mn = parseInt(m[2] || "0", 10);
  const s = parseInt(m[3] || "0", 10);
  if (h) return `${h}:${String(mn).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${mn}:${String(s).padStart(2,"0")}`;
}
