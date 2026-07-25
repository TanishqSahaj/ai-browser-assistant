// popup.js
// Runs when the popup window is open. Page actions go straight to the tab's
// content script; PING and all Google auth go via the background worker.

// Both page actions do the same thing apart from the message type, so they
// share one helper.
function sendToActiveTab(messageType, failureText) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: messageType }, () => {
      if (chrome.runtime.lastError) {
        document.getElementById("result").textContent = failureText;
        return;
      }
      window.close(); // close popup so the user can see the overlay
    });
  });
}

document.getElementById("scanBtn").addEventListener("click", () => {
  sendToActiveTab("SCAN_FORM", "Can't scan this page — try a normal http(s) page.");
});

document.getElementById("summarizeBtn").addEventListener("click", () => {
  sendToActiveTab("SUMMARIZE_PAGE", "Can't summarize this page — try a normal http(s) page.");
});

document.getElementById("openProfile").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

document.getElementById("pingBtn").addEventListener("click", () => {
  const resultDiv = document.getElementById("result");
  resultDiv.textContent = "Asking background worker...";

  chrome.runtime.sendMessage({ type: "PING_FROM_POPUP" }, (response) => {
    if (!response) {
      resultDiv.textContent = "No response — check the console for errors.";
      return;
    }
    resultDiv.textContent = `Title: "${response.title}"\nURL: ${response.url}`;
  });
});

// ---- Google account status ----
const googleStatusEl = document.getElementById("googleStatus");
const googleAuthBtn = document.getElementById("googleAuthBtn");

function refreshGoogleStatus() {
  chrome.runtime.sendMessage({ type: "GOOGLE_STATUS" }, (response) => {
    if (response && response.signedIn) {
      googleStatusEl.textContent = `Connected: ${response.email}`;
      googleAuthBtn.textContent = "Disconnect Google";
      googleAuthBtn.dataset.mode = "out";
    } else {
      googleStatusEl.textContent = "Not connected to Google";
      googleAuthBtn.textContent = "Connect Google";
      googleAuthBtn.dataset.mode = "in";
    }
  });
}

googleAuthBtn.addEventListener("click", () => {
  const signingOut = googleAuthBtn.dataset.mode === "out";
  googleStatusEl.textContent = signingOut ? "Disconnecting…" : "Opening Google sign-in…";

  chrome.runtime.sendMessage(
    { type: signingOut ? "GOOGLE_SIGN_OUT" : "GOOGLE_SIGN_IN" },
    (response) => {
      if (!response || !response.ok) {
        googleStatusEl.textContent = response?.error
          ? `Failed: ${response.error}`
          : "Failed — check the service worker console.";
        return;
      }
      refreshGoogleStatus();
    }
  );
});
document.getElementById("digestBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("digest.html") });
  window.close();
});

document.getElementById("calendarBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("calendar.html") });
  window.close();
});

refreshGoogleStatus();