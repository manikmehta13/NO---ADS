// ── State ─────────────────────────────────────────────────
let shuffleEnabled        = false;
let ytPlayer              = null;
let ytApiReady            = false;
let pendingPlaylistId     = null;
let isPlaylistMode        = false;
let playlistVideoIds      = [];
let currentlyPlayingIndex = 0;
let titleFetchAbort       = null;

// ── Service Worker ─────────────────────────────────────────
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js")
    .then(() => console.log("SW registered"))
    .catch((e) => console.log("SW failed", e));
}

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
    vc.appendChild(_standardIframe(
      `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`
    ));
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

function _onPlayerReady(event) {
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
    currentlyPlayingIndex = ytPlayer.getPlaylistIndex();
    _refreshCurrentCard();
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
    const isNow = i === currentlyPlayingIndex;
    const card  = document.createElement("div");
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
        <p class="pp-title" id="ppTitle-${i}">Loading…</p>
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

// ── Progressively fetch titles via YouTube oEmbed ─────────
async function fetchPlaylistTitles(ids) {
  if (titleFetchAbort) titleFetchAbort.abort();
  const ctrl  = new AbortController();
  titleFetchAbort = ctrl;

  const limit = Math.min(ids.length, 200);

  for (let i = 0; i < limit; i++) {
    if (ctrl.signal.aborted) break;

    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ids[i]}&format=json`;
    try {
      const res  = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error("non-200");
      const data = await res.json();
      const el   = document.getElementById(`ppTitle-${i}`);
      if (el) el.textContent = data.title || `Video ${i + 1}`;
    } catch (e) {
      if (e.name === "AbortError") break;
      const el = document.getElementById(`ppTitle-${i}`);
      if (el && el.textContent === "Loading…") el.textContent = `Video ${i + 1}`;
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
  f.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
  f.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:none;";
  return f;
}

function extractVideoID(url) {
  const m = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed|live)?)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
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
