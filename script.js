// ── State ───────────────────────────────────────────────
let shuffleEnabled = false;
let ytPlayer = null;
let ytApiReady = false;
let pendingPlaylistId = null;

// ── Service Worker ───────────────────────────────────────
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js")
    .then(() => console.log("Service Worker Registered"))
    .catch((error) => console.log("Service Worker Registration Failed", error));
}

// ── YouTube IFrame API bootstrap ─────────────────────────
function loadYouTubeAPI() {
  if (document.getElementById("yt-api-script")) return;
  const script = document.createElement("script");
  script.id = "yt-api-script";
  script.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(script);
}

// Called automatically by YouTube after API script loads
window.onYouTubeIframeAPIReady = function () {
  ytApiReady = true;
  if (pendingPlaylistId) {
    initYTPlayer(pendingPlaylistId);
    pendingPlaylistId = null;
  }
};

// ── Share-target / PWA entry ─────────────────────────────
window.onload = function () {
  const params = new URLSearchParams(window.location.search);
  let sharedUrl = params.get("url") || params.get("text");

  if (sharedUrl) {
    sharedUrl = decodeURIComponent(sharedUrl.trim());
    document.getElementById("videoLink").value = sharedUrl;

    const clearBtn = document.getElementById("clearBtn");
    if (clearBtn) {
      clearBtn.style.opacity = "1";
      clearBtn.style.pointerEvents = "auto";
    }

    if (sharedUrl.includes("youtube.com") || sharedUrl.includes("youtu.be")) {
      if (sharedUrl.includes("list=")) {
        embedPlaylist();
      } else {
        embedVideo();
      }
    }
  }
};

// ── Shuffle toggle ────────────────────────────────────────
function toggleShuffle() {
  shuffleEnabled = !shuffleEnabled;

  const btn = document.getElementById("shuffleToggle");
  const indicator = document.getElementById("shuffleIndicator");
  const label = document.getElementById("shuffleLabel");

  if (shuffleEnabled) {
    btn.classList.add("shuffle-on");
    indicator.classList.add("on");
    label.textContent = "Shuffle On";
    showToast("Shuffle enabled — next playlist will play in random order.");
  } else {
    btn.classList.remove("shuffle-on");
    indicator.classList.remove("on");
    label.textContent = "Shuffle Off";
    showToast("Shuffle disabled.");
  }
}

// ── Video embed ───────────────────────────────────────────
function embedVideo() {
  const link = document.getElementById("videoLink").value;
  const videoId = extractVideoID(link);
  const videoContainer = document.getElementById("videoContainer");
  videoContainer.innerHTML = "";
  destroyYTPlayer();

  if (videoId) {
    const iframe = createStandardIframe(
      `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`
    );
    videoContainer.appendChild(iframe);
  } else {
    showToast("Please enter a valid YouTube link.");
  }
}

// ── Playlist embed ────────────────────────────────────────
function embedPlaylist() {
  const link = document.getElementById("videoLink").value;
  const playlistId = extractPlaylistID(link);
  const videoContainer = document.getElementById("videoContainer");
  videoContainer.innerHTML = "";
  destroyYTPlayer();

  if (!playlistId) {
    showToast("Please enter a valid YouTube playlist link.");
    return;
  }

  if (shuffleEnabled) {
    // Use IFrame Player API so we can call setShuffle(true)
    const playerHost = document.createElement("div");
    playerHost.id = "yt-player-host";
    playerHost.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;";
    videoContainer.appendChild(playerHost);

    loadYouTubeAPI();

    if (ytApiReady) {
      initYTPlayer(playlistId);
    } else {
      // Queue it; onYouTubeIframeAPIReady will fire it
      pendingPlaylistId = playlistId;
    }
  } else {
    const iframe = createStandardIframe(
      `https://www.youtube.com/embed/videoseries?list=${playlistId}&rel=0&modestbranding=1`
    );
    videoContainer.appendChild(iframe);
  }
}

// ── YT Player initialiser (shuffle path) ─────────────────
function initYTPlayer(playlistId) {
  ytPlayer = new YT.Player("yt-player-host", {
    width: "100%",
    height: "100%",
    playerVars: {
      listType: "playlist",
      list: playlistId,
      autoplay: 1,
      rel: 0,
      modestbranding: 1,
    },
    events: {
      onReady: function (event) {
        event.target.setShuffle(true);
        event.target.playVideo();
      },
      onError: function () {
        showToast("Couldn't load the playlist. Check the link and try again.");
      },
    },
  });
}

function destroyYTPlayer() {
  if (ytPlayer && typeof ytPlayer.destroy === "function") {
    ytPlayer.destroy();
    ytPlayer = null;
  }
}

// ── Helpers ───────────────────────────────────────────────
function createStandardIframe(src) {
  const iframe = document.createElement("iframe");
  iframe.src = src;
  iframe.setAttribute("allowfullscreen", "true");
  iframe.setAttribute("frameborder", "0");
  iframe.setAttribute(
    "allow",
    "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
  );
  iframe.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:none;";
  return iframe;
}

function extractVideoID(url) {
  const regex =
    /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed|live)?)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

function extractPlaylistID(url) {
  const regex = /[?&]list=([a-zA-Z0-9_-]+)/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

function showToast(message) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.style.cssText = `
      position: fixed; bottom: 2rem; left: 50%; transform: translateX(-50%) translateY(20px);
      background: rgba(255,255,255,0.1); backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.12); color: #f4f2ff;
      padding: 12px 22px; border-radius: 100px; font-size: 0.85rem;
      font-family: 'DM Sans', sans-serif; font-weight: 300;
      opacity: 0; transition: opacity 0.3s, transform 0.3s; z-index: 999; white-space: nowrap;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = "1";
  toast.style.transform = "translateX(-50%) translateY(0)";
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(20px)";
  }, 3000);
}
