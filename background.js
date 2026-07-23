// background.js
// Runs in the background, separately from any webpage.
// Listens for messages and responds — the pattern every future module reuses.

importScripts("llm.js");

console.log("[background] service worker started");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[background] got message:", message);

  if (message.type === "PING_FROM_POPUP") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];

      if (!activeTab) {
        sendResponse({ title: "(no active tab)", url: "" });
        return;
      }

      chrome.tabs.sendMessage(
        activeTab.id,
        { type: "GET_PAGE_TITLE" },
        (contentResponse) => {
          // Without this guard the popup hangs forever on pages where no
          // content script is injected (chrome://, the Web Store, PDFs).
          if (chrome.runtime.lastError) {
            console.warn("[background] no content script:", chrome.runtime.lastError.message);
            sendResponse({
              title: "(no content script on this page)",
              url: activeTab.url || ""
            });
            return;
          }
          sendResponse(contentResponse);
        }
      );
    });

    return true; // keep the message channel open for the async response
  }

  if (message.type === "LLM_MATCH_FIELD") {
    llmMatchField(message.clueText, message.profileKeys)
      .then((matchedKey) => sendResponse({ matchedKey }))
      .catch((err) => {
        console.error("[background] LLM_MATCH_FIELD failed:", err);
        sendResponse({ matchedKey: null });
      });
    return true;
  }

  if (message.type === "LLM_GENERATE_ANSWER") {
    llmGenerateAnswer(message.question, message.profile)
      .then((answer) => sendResponse({ answer }))
      .catch((err) => {
        console.error("[background] LLM_GENERATE_ANSWER failed:", err);
        sendResponse({ answer: null });
      });
    return true;
  }
});

if (message.type === "LLM_SUMMARIZE") {
    llmSummarize(message.pageText)
      .then((summary) => sendResponse({ summary }))
      .catch((err) => {
        console.error("[background] LLM_SUMMARIZE failed:", err);
        sendResponse({ summary: null });
      });
    return true;
  }