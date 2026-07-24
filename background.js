// background.js
// Runs in the background, separately from any webpage.
// Listens for messages and responds — the pattern every module reuses.

importScripts("llm.js", "auth.js", "gmail.js");

console.log("[background] service worker started");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[background] got message:", message.type);

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

    return true;
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

  if (message.type === "LLM_SUMMARIZE") {
    llmSummarize(message.pageText)
      .then((summary) => sendResponse({ summary }))
      .catch((err) => {
        console.error("[background] LLM_SUMMARIZE failed:", err);
        sendResponse({ summary: null });
      });
    return true;
  }

  if (message.type === "GOOGLE_SIGN_IN") {
    getAuthToken(true)
      .then(() => getGoogleProfile())
      .then((profile) => sendResponse({ ok: true, email: profile.email }))
      .catch((err) => {
        console.error("[background] GOOGLE_SIGN_IN failed:", err);
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  if (message.type === "GOOGLE_SIGN_OUT") {
    signOutGoogle()
      .then((ok) => sendResponse({ ok }))
      .catch((err) => {
        console.error("[background] GOOGLE_SIGN_OUT failed:", err);
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "GOOGLE_STATUS") {
    getAuthToken(false)
      .then(() => getGoogleProfile())
      .then((profile) => sendResponse({ signedIn: true, email: profile.email }))
      .catch(() => sendResponse({ signedIn: false }));
    return true;
  }

  if (message.type === "GMAIL_DIGEST") {
    // Wrapped in an async IIFE because the listener itself cannot be async:
    // an async listener returns a Promise, which Chrome reads as "no response
    // coming" and closes the channel before sendResponse fires.
    (async () => {
      try {
        const messages = await gmailFetchRecent(
          message.query || "is:unread in:inbox",
          message.maxResults || 10
        );

        if (messages.length === 0) {
          sendResponse({ ok: true, digest: null, count: 0 });
          return;
        }

        const digest = await llmInboxDigest(formatMessagesForLLM(messages));
        sendResponse({ ok: true, digest, count: messages.length });
      } catch (err) {
        console.error("[background] GMAIL_DIGEST failed:", err);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
});
