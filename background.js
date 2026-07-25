// background.js
// Runs in the background, separately from any webpage.
// Listens for messages and responds — the pattern every module reuses.

importScripts("llm.js", "auth.js", "gmail.js", "calendar.js");

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

  // ---- Calendar ----

  if (message.type === "CALENDAR_LIST") {
    (async () => {
      try {
        const events = await calendarListUpcoming(
          message.maxResults || 10,
          message.daysAhead || 7
        );
        sendResponse({ ok: true, events });
      } catch (err) {
        console.error("[background] CALENDAR_LIST failed:", err);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === "CALENDAR_PARSE") {
    // Parse only — the user reviews the result before anything is created.
    // Creating straight from model output would mean a hallucinated date
    // silently lands on their real calendar.
    (async () => {
      try {
        const raw = await llmParseEvent(
          message.text,
          message.nowISO,
          message.timeZone
        );

        if (!raw) {
          sendResponse({ ok: false, error: "Model returned nothing" });
          return;
        }

        const event = parseEventJSON(raw);
        if (!event) {
          sendResponse({ ok: false, error: "Could not parse model output as JSON", raw });
          return;
        }

        const problem = validateEventShape(event);
        if (problem) {
          sendResponse({ ok: false, error: `Invalid event: ${problem}`, raw });
          return;
        }

        sendResponse({ ok: true, event });
      } catch (err) {
        console.error("[background] CALENDAR_PARSE failed:", err);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === "CALENDAR_CREATE") {
    (async () => {
      try {
        const problem = validateEventShape(message.event);
        if (problem) {
          sendResponse({ ok: false, error: `Invalid event: ${problem}` });
          return;
        }

        const created = await calendarCreateEvent(message.event);
        sendResponse({ ok: true, event: created });
      } catch (err) {
        console.error("[background] CALENDAR_CREATE failed:", err);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
});
