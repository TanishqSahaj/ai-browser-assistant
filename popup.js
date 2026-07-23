// popup.js
// Runs when the popup window is open. SCAN_FORM and SUMMARIZE_PAGE go
// straight to the tab's content script; PING goes via the background worker.

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