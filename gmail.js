// gmail.js
// Loaded into the BACKGROUND service worker only (alongside llm.js, auth.js).
// Thin wrapper over the Gmail REST API. Every call goes through googleFetch
// from auth.js, so token refresh and 401 retry are handled there.

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

// List message IDs matching a Gmail search query. The list endpoint returns
// ONLY ids and threadIds — no subject, no body. Fetching content requires a
// second call per message, which is why listMessages and getMessage are split.
async function gmailListMessages(query = "is:unread in:inbox", maxResults = 10) {
  const url =
    `${GMAIL_API}/messages?maxResults=${maxResults}` +
    `&q=${encodeURIComponent(query)}`;

  const data = await googleFetch(url);
  return data.messages || []; // absent entirely when nothing matches
}

// Fetch one message in full.
async function gmailGetMessage(messageId) {
  return googleFetch(`${GMAIL_API}/messages/${messageId}?format=full`);
}

// Gmail base64url-encodes bodies: standard base64 with - and _ swapped in for
// + and /, and padding stripped. atob() rejects that, so convert first.
function decodeBase64Url(data) {
  if (!data) return "";
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    // decodeURIComponent(escape(...)) recovers UTF-8 bytes that atob() would
    // otherwise mangle into latin-1 — matters for any non-ASCII subject line.
    return decodeURIComponent(escape(atob(base64)));
  } catch (err) {
    console.warn("[gmail] could not decode body chunk:", err);
    return "";
  }
}

// A message payload is a tree: a multipart node has `parts`, each of which may
// itself be multipart. The plain-text body can sit at any depth, so walk it
// recursively and prefer text/plain over text/html.
function extractPlainTextBody(payload) {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (Array.isArray(payload.parts)) {
    // Depth-first, plain text wins.
    for (const part of payload.parts) {
      const text = extractPlainTextBody(part);
      if (text) return text;
    }
  }

  // Last resort: an HTML-only message. Strip tags crudely — this text is
  // going to an LLM, not to a renderer, so perfect fidelity isn't needed.
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBase64Url(payload.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return "";
}

function getHeader(payload, name) {
  const header = (payload?.headers || []).find(
    (h) => h.name.toLowerCase() === name.toLowerCase()
  );
  return header ? header.value : "";
}

// Fetch recent messages and flatten each into the small shape the LLM needs.
// Parallel, not sequential — 10 messages is 10 round trips otherwise.
async function gmailFetchRecent(query = "is:unread in:inbox", maxResults = 10) {
  const stubs = await gmailListMessages(query, maxResults);
  if (stubs.length === 0) return [];

  const messages = await Promise.all(
    stubs.map(async (stub) => {
      const full = await gmailGetMessage(stub.id);
      const payload = full.payload;

      return {
        id: full.id,
        threadId: full.threadId,
        from: getHeader(payload, "From"),
        subject: getHeader(payload, "Subject") || "(no subject)",
        date: getHeader(payload, "Date"),
        // Cap per-message text so one long newsletter can't crowd out the
        // other nine in the prompt.
        body: extractPlainTextBody(payload).slice(0, 1500),
        snippet: full.snippet || ""
      };
    })
  );

  return messages;
}

// Flatten the message list into a single prompt-friendly block.
function formatMessagesForLLM(messages) {
  return messages
    .map((m, i) => {
      return (
        `[${i + 1}] From: ${m.from}\n` +
        `Subject: ${m.subject}\n` +
        `Date: ${m.date}\n` +
        `Body: ${m.body || m.snippet}\n`
      );
    })
    .join("\n---\n");
}