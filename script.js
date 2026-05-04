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

function embedVideo() {
  const link = document.getElementById("videoLink").value;
  const videoId = extractVideoID(link);
  const videoContainer = document.getElementById("videoContainer");
  videoContainer.innerHTML = "";

  if (videoId) {
    const iframe = document.createElement("iframe");
    iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;
    iframe.setAttribute("allowfullscreen", "true");
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
    videoContainer.appendChild(iframe);
  } else {
    showToast("Please enter a valid YouTube link.");
  }
}

function extractVideoID(url) {
  const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed|live)?)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

function embedPlaylist() {
  const link = document.getElementById("videoLink").value;
  const playlistId = extractPlaylistID(link);
  const videoContainer = document.getElementById("videoContainer");
  videoContainer.innerHTML = "";

  if (playlistId) {
    const iframe = document.createElement("iframe");
    iframe.src = `https://www.youtube.com/embed/videoseries?list=${playlistId}&rel=0&modestbranding=1`;
    iframe.setAttribute("allowfullscreen", "true");
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
    videoContainer.appendChild(iframe);
  } else {
    showToast("Please enter a valid YouTube playlist link.");
  }
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
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(20px)";
  }, 3000);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js")
    .then(() => console.log("Service Worker Registered"))
    .catch((error) => console.log("Service Worker Registration Failed", error));
}
