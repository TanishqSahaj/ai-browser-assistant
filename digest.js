// digest.js
// Runs on digest.html. Asks the background worker for a triaged summary of
// recent unread mail and renders it.

const digestEl = document.getElementById("digest");
const refreshBtn = document.getElementById("refreshBtn");
const copyBtn = document.getElementById("copyBtn");

let currentDigest = "";

function loadDigest() {
  digestEl.textContent = "Fetching mail and summarizing… this takes a few seconds.";
  currentDigest = "";

  chrome.runtime.sendMessage({ type: "GMAIL_DIGEST", query: "in:inbox" }, (response) => {
    if (!response || !response.ok) {
      digestEl.textContent = response?.error
        ? `Failed: ${response.error}`
        : "Failed — check the service worker console.";
      return;
    }

    if (response.count === 0) {
      digestEl.textContent = "No unread messages in your inbox.";
      return;
    }

    if (!response.digest) {
      digestEl.textContent = `Found ${response.count} messages but the summary came back empty.`;
      return;
    }

    currentDigest = response.digest;
    digestEl.textContent = response.digest;
  });
}

refreshBtn.addEventListener("click", loadDigest);

copyBtn.addEventListener("click", async () => {
  if (!currentDigest) return;
  try {
    await navigator.clipboard.writeText(currentDigest);
    copyBtn.textContent = "Copied";
    setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
  } catch (err) {
    console.warn("[digest] clipboard write failed:", err);
  }
});

loadDigest();