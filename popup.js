// popup.js
// Talks ONLY to the background worker (never directly to the content script)
// for the ping path; SCAN_FORM goes straight to the tab.

document.getElementById("scanBtn").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { type: "SCAN_FORM" }, () => {
      if (chrome.runtime.lastError) {
        document.getElementById("result").textContent =
          "Can't scan this page — try a normal http(s) page.";
        return;
      }
      window.close(); // close popup so the user can see the overlay
    });
  });
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

document.getElementById("summarizeBtn").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { type: "SUMMARIZE_PAGE" }, () => {
      if (chrome.runtime.lastError) {
        document.getElementById("result").textContent =
          "Can't summarize this page — try a normal http(s) page.";
        return;
      }
      window.close();
    });
  });
});