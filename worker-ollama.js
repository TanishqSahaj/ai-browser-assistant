// worker-ollama.js
// Cloudflare Worker — holds your Ollama Cloud API key, proxies the fixed
// tasks (match_field, generate_answer, summarize) that llm.js expects.
// Only needed if you set LLM_PROVIDER = "ollama-cloud" in llm.js.
//
// Deploy steps:
//   1. Get a key: https://ollama.com/settings/keys
//   2. wrangler secret put OLLAMA_API_KEY --config wrangler-ollama.toml
//   3. wrangler deploy --config wrangler-ollama.toml
//   4. Copy the printed URL into llm.js -> OLLAMA_CLOUD_BACKEND_URL

// NOTE: gpt-oss is a reasoning model — it emits internal reasoning before the
// real answer. That's why maxTokens is generous even for one-word tasks; at
// 10 tokens the reasoning ate the whole budget and content came back empty.
const OLLAMA_CLOUD_MODEL = "gpt-oss:20b-cloud";

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return new Response("Only POST is supported", { status: 405, headers: corsHeaders });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400, corsHeaders);
    }

    const { task, input } = body;
    if (!task || typeof input === "undefined") {
      return jsonResponse({ error: "Missing 'task' or 'input'" }, 400, corsHeaders);
    }

    let prompt;
    let maxTokens = 300;

    if (task === "match_field") {
      prompt =
        "You match web form fields to profile keys. Given a field's label/placeholder/name text " +
        "and a list of valid profile keys, respond with ONLY the single best matching key from the " +
        "list, or the word NONE if nothing matches well. No punctuation, no explanation.\n\n" +
        `Field clue text: "${input.clueText}"\n` +
        `Valid profile keys: ${(input.profileKeys || []).join(", ")}\n` +
        "Answer:";
      maxTokens = 200;
    } else if (task === "generate_answer") {
      prompt =
        "You write short first-person answers to application-form questions using ONLY the facts " +
        "given in the profile. Do not invent facts. Keep it to 2-4 sentences, plain text.\n\n" +
        `Question: "${input.question}"\n` +
        `Profile facts: ${JSON.stringify(input.profile)}\n` +
        "Answer:";
      maxTokens = 400;
    } else if (task === "summarize") {
      prompt =
        "Summarize the page content below. Output exactly this structure, no markdown, no preamble:\n" +
        "TLDR: one sentence\n" +
        "KEY POINTS:\n- point\n- point\n- point\n" +
        "TAGS: three to five comma-separated tags\n\n" +
        "PAGE CONTENT:\n" +
        String(input.pageText || "").slice(0, 6000);
      maxTokens = 800;
    } else if (task === "inbox_digest") {
      prompt =
        "You triage email. Below are recent messages. Produce a digest with this exact " +
        "structure, no markdown, no preamble:\n" +
        "NEEDS REPLY:\n- sender — one-line reason\n" +
        "FYI:\n- sender — one-line summary\n" +
        "IGNORE:\n- sender — one-line reason\n\n" +
        "Put each message in exactly one section. If a section is empty write 'none'.\n\n" +
        "MESSAGES:\n" +
        String(input.messagesText || "").slice(0, 8000);
      maxTokens = 1000;
    } else if (task === "parse_event") {
      prompt =
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
        `Current time: ${input.nowISO}\n` +
        `User timezone: ${input.timeZone}\n` +
        `Request: "${input.text}"\n\n` +
        "JSON:";
      maxTokens = 600;
    }
     else if (task === "plan_actions") {
      prompt =
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
        `Request: "${input.text}"\n\n` +
        "JSON array:";
      maxTokens = 500;
    }
    else {
      return jsonResponse({ error: `Unknown task: ${task}` }, 400, corsHeaders);
    }

    let ollamaResponse;
    try {
      ollamaResponse = await fetch("https://ollama.com/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OLLAMA_API_KEY}`,
        },
        body: JSON.stringify({
          model: OLLAMA_CLOUD_MODEL,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          options: { num_predict: maxTokens },
        }),
      });
    } catch (err) {
      return jsonResponse(
        { error: "Could not reach Ollama Cloud", detail: String(err) },
        502,
        corsHeaders
      );
    }

    if (!ollamaResponse.ok) {
      const detail = await ollamaResponse.text();
      return jsonResponse({ error: "Ollama Cloud API error", detail }, 502, corsHeaders);
    }

    const data = await ollamaResponse.json();
    // /api/chat non-streaming shape: { message: { role, content }, done, ... }
    const resultText = (data?.message?.content || "").trim();

    return jsonResponse({ result: resultText }, 200, corsHeaders);
  },
};

function jsonResponse(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}