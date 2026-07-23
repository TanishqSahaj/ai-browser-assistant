// worker-ollama.js
// Cloudflare Worker — holds your Ollama Cloud API key, proxies the same two
// fixed tasks (match_field, generate_answer) that llm.js expects.
// Only needed if you set LLM_PROVIDER = "ollama-cloud" in llm.js.
//
// Deploy steps:
//   1. Get a key: https://ollama.com/settings/keys
//   2. wrangler secret put OLLAMA_API_KEY --config wrangler-ollama.toml
//   3. wrangler deploy --config wrangler-ollama.toml
//   4. Copy the printed URL into llm.js -> OLLAMA_CLOUD_BACKEND_URL

// Cloud model names carry a "-cloud" suffix. Check ollama.com/library for
// what's currently offered — if you get a 502 with a model-not-found detail,
// this constant is the thing to change.
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
      maxTokens = 200;
    } 
    else if (task === "summarize") {
      prompt =
        "Summarize the page content below. Output exactly this structure, no markdown, no preamble:\n" +
        "TLDR: one sentence\n" +
        "KEY POINTS:\n- point\n- point\n- point\n" +
        "TAGS: three to five comma-separated tags\n\n" +
        "PAGE CONTENT:\n" +
        String(input.pageText || "").slice(0, 6000);
      maxTokens = 600;
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