const toggle = document.getElementById("toggle");
const status = document.getElementById("status");

chrome.storage.local.get(["enabled"], (res) => {
  toggle.checked = res.enabled !== false;
  status.textContent = toggle.checked ? "On" : "Off";
});

toggle.addEventListener("change", () => {
  chrome.storage.local.set({
    enabled: toggle.checked
  });

  status.textContent = toggle.checked ? "On" : "Off";

  chrome.tabs.query(
    {
      url: [
        "*://www.youtube.com/*",
        "*://m.youtube.com/*"
      ]
    },
    (tabs) => {
      for (const tab of tabs) {
        chrome.tabs
          .sendMessage(tab.id, {
            type: "toggle",
            enabled: toggle.checked
          })
          .catch(() => {});
      }
    }
  );
});