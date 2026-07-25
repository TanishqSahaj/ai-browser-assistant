// llm.js
// Loaded into the BACKGROUND service worker only (never into content scripts,
// never into the popup).
//
// Three supported providers — pick ONE by setting LLM_PROVIDER below:
//
//   "ollama"       — runs fully on your own machine. No API key, no backend,
//                    no Worker needed. Requires `ollama serve` running with
//                    OLLAMA_ORIGINS="chrome-extension://*".
//
//   "ollama-cloud" — Ollama's hosted models. No local VRAM needed, but it
//                    NEEDS an API key — so the key lives in a Cloudflare
//                    Worker (worker-ollama.js), never in the extension.
//
//   "huggingface"  — Hugging Face's hosted Inference API, same arrangement:
//                    the token lives in worker-huggingface.js.

const LLM_PROVIDER = "ollama-cloud"; // "ollama" | "ollama-cloud" | "huggingface"

// --- Local Ollama settings (only used when LLM_PROVIDER === "ollama") ---
const OLLAMA_URL = "http://localhost:11434/api/generate";
const OLLAMA_MODEL = "llama3.2:3b"; // any model you've pulled: `ollama list`

// --- Ollama Cloud settings (only used when LLM_PROVIDER === "ollama-cloud") ---
const OLLAMA_CLOUD_BACKEND_URL = "https://ai-browser-assistant-ollama.ai-browser-tanishq.workers.dev";

// --- Hugging Face settings (only used when LLM_PROVIDER === "huggingface") ---
const HF_BACKEND_URL = "https://ai-browser-assistant-hf.ai-browser-tanishq.workers.dev";

// ---------------------------------------------------------------------------
// Prompt building lives here for the LOCAL Ollama path only, since there's no
// backend in front of it to build prompts safely. For both Worker-backed
// paths, the Worker builds the prompt server-side instead — don't let the
// caller send an arbitrary system prompt to something holding your key.
// ---------------------------------------------------------------------------

function buildMatchFieldPrompt(clueText, profileKeys) {
  return (
    "You match web form fields to profile keys. Given a field's label/placeholder/name text " +
    "and a list of valid profile keys, respond with ONLY the single best matching key from the " +
    "list, or the word NONE if nothing matches well. No punctuation, no explanation, no markdown.\n\n" +
    `Field clue text: "${clueText}"\n` +
    `Valid profile keys: ${profileKeys.join(", ")}\n` +
    "Answer:"
  );
}

function buildGenerateAnswerPrompt(question, profile) {
  return (
    "You write short first-person answers to application-form questions (e.g. 'why should we hire " +
    "you', 'tell us about yourself') using ONLY the facts given in the profile. Do not invent facts " +
    "not present in the profile. Keep it to 2-4 sentences, plain text, no markdown.\n\n" +
    `Question: "${question}"\n` +
    `Profile facts: ${JSON.stringify(profile)}\n` +
    "Answer:"
  );
}

function buildSummarizePrompt(pageText) {
  return (
    "Summarize the page content below. Output exactly this structure, no markdown, no preamble:\n" +
    "TLDR: one sentence\n" +
    "KEY POINTS:\n- point\n- point\n- point\n" +
    "TAGS: three to five comma-separated tags\n\n" +
    "PAGE CONTENT:\n" +
    String(pageText || "").slice(0, 6000)
  );
}

// ---------------------------------------------------------------------------
// Local Ollama path — direct call, no key involved.
// ---------------------------------------------------------------------------
async function callOllama(prompt) {
  try {
    const response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("[llm/ollama] error:", response.status, errBody);
      return { error: `Ollama error (${response.status})` };
    }

    const data = await response.json();
    return { result: (data.response || "").trim() };
  } catch (err) {
    console.error("[llm/ollama] could not reach Ollama:", err);
    return { error: "Could not reach Ollama — is `ollama serve` running?" };
  }
}

// ---------------------------------------------------------------------------
// Worker-backed paths — the Worker holds the key AND builds the prompt.
// Shared by ollama-cloud and huggingface, since both speak the same
// { task, input } -> { result } contract.
// ---------------------------------------------------------------------------
async function callWorkerBackend(backendUrl, label, task, input) {
  try {
    const response = await fetch(backendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, input }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`[llm/${label}] backend error:`, response.status, errBody);
      return { error: `Backend error (${response.status})` };
    }

    const data = await response.json();
    return { result: (data.result || "").trim() };
  } catch (err) {
    console.error(`[llm/${label}] network error calling backend:`, err);
    return { error: "Could not reach backend — check your connection." };
  }
}

// Routes a task to whichever provider is configured. All public functions
// use this, so adding a provider later means editing one place.
async function callProvider(task, localPrompt, input) {
  if (LLM_PROVIDER === "ollama") {
    return callOllama(localPrompt);
  }
  if (LLM_PROVIDER === "ollama-cloud") {
    return callWorkerBackend(OLLAMA_CLOUD_BACKEND_URL, "ollama-cloud", task, input);
  }
  return callWorkerBackend(HF_BACKEND_URL, "hf", task, input);
}

// ---------------------------------------------------------------------------
// Public functions used by background.js — same signatures regardless of
// which provider is active, so switching LLM_PROVIDER is a one-line change.
// ---------------------------------------------------------------------------

async function llmMatchField(clueText, profileKeys) {
  const { result, error } = await callProvider(
    "match_field",
    buildMatchFieldPrompt(clueText, profileKeys),
    { clueText, profileKeys }
  );

  if (error || !result) return null;

  // Models sometimes wrap the answer in quotes/punctuation or add a stray
  // word — take the first token-ish chunk and compare loosely.
  const cleaned = result.replace(/["'.]/g, "").trim().split(/\s+/)[0];
  if (!cleaned || cleaned.toUpperCase() === "NONE") return null;
  return profileKeys.includes(cleaned) ? cleaned : null;
}

async function llmGenerateAnswer(question, profile) {
  const { result, error } = await callProvider(
    "generate_answer",
    buildGenerateAnswerPrompt(question, profile),
    { question, profile }
  );

  if (error) return null;
  return result || null;
}

async function llmSummarize(pageText) {
  const { result, error } = await callProvider(
    "summarize",
    buildSummarizePrompt(pageText),
    { pageText }
  );

  if (error) return null;
  return result || null;
}

function buildInboxDigestPrompt(messagesText) {
  return (
    "You triage email. Below are recent messages. Produce a digest with this exact " +
    "structure, no markdown, no preamble:\n" +
    "NEEDS REPLY:\n- sender — one-line reason\n" +
    "FYI:\n- sender — one-line summary\n" +
    "IGNORE:\n- sender — one-line reason\n\n" +
    "Put each message in exactly one section. If a section is empty write 'none'.\n\n" +
    "MESSAGES:\n" +
    String(messagesText || "").slice(0, 8000)
  );
}

async function llmInboxDigest(messagesText) {
  const { result, error } = await callProvider(
    "inbox_digest",
    buildInboxDigestPrompt(messagesText),
    { messagesText }
  );

  if (error) return null;
  return result || null;
}

function buildParseEventPrompt(text, nowISO, timeZone) {
  return (
    "You convert a natural-language scheduling request into a Google Calendar event.\n" +
    "Respond with ONLY a JSON object, no markdown, no code fences, no explanation.\n\n" +
    "Shape:\n" +
    '{"summary":"title","location":"place or empty string",' +
    '"description":"detail or empty string",' +
    '"start":{"dateTime":"ISO8601 with offset","timeZone":"IANA zone"},' +
    '"end":{"dateTime":"ISO8601 with offset","timeZone":"IANA zone"}}\n\n' +
    "Rules:\n" +
    "- Resolve relative dates against the current time given below.\n" +
    "- If no duration is stated, make the event 1 hour.\n" +
    "- If no time is stated, use 09:00 local.\n" +
    "- Use the user's timezone for both dateTime offset and timeZone.\n\n" +
    `Current time: ${nowISO}\n` +
    `User timezone: ${timeZone}\n` +
    `Request: "${text}"\n\n` +
    "JSON:"
  );
}

async function llmParseEvent(text, nowISO, timeZone) {
  const { result, error } = await callProvider(
    "parse_event",
    buildParseEventPrompt(text, nowISO, timeZone),
    { text, nowISO, timeZone }
  );

  if (error) return null;
  return result || null;
}

function buildPlanActionsPrompt(text) {
  return (
    "You are a command router. Turn the user's request into an ordered list of actions.\n" +
    "Respond with ONLY a JSON array, no markdown, no code fences, no explanation.\n\n" +
    "Available actions:\n" +
    '- {"action":"fill_form"} — fill the form on the current page\n' +
    '- {"action":"summarize_page"} — summarize the current page\n' +
    '- {"action":"inbox_digest"} — triage recent unread email\n' +
    '- {"action":"create_event","text":"the scheduling phrase"} — add a calendar event\n' +
    '- {"action":"list_events"} — show upcoming calendar events\n\n' +
    "Rules:\n" +
    "- Include only actions the user actually asked for.\n" +
    "- Preserve the order implied by the request.\n" +
    "- For create_event, copy the relevant scheduling phrase into text verbatim.\n" +
    "- If nothing matches, return [].\n\n" +
    `Request: "${text}"\n\n` +
    "JSON array:"
  );
}

async function llmPlanActions(text) {
  const { result, error } = await callProvider(
    "plan_actions",
    buildPlanActionsPrompt(text),
    { text }
  );

  if (error) return null;
  return result || null;
}