// worker-huggingface.js
// Cloudflare Worker — holds your Hugging Face API token, proxies the same
// two fixed tasks (match_field, generate_answer) that llm.js expects.
// Only needed if you set LLM_PROVIDER = "huggingface" in extension/llm.js.
//
// Deploy steps:
//   1. Get a token: https://huggingface.co/settings/tokens (read access is enough)
//   2. cd worker && wrangler secret put HF_API_TOKEN   (paste the token)
//   3. wrangler deploy --config wrangler-hf.toml
//   4. Copy the printed URL into extension/llm.js -> HF_BACKEND_URL

// NOTE: avoid "thinking"/reasoning models here (e.g. Qwen3.x, DeepSeek-R1).
// They emit internal reasoning tokens before the real answer, which can eat
// the whole max_tokens budget and leave message.content empty for a task
// this simple. A plain instruct model is a better fit for one-word/short
// answers like ours.
const HF_MODEL = "Qwen/Qwen3.6-35B-A3B";

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
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { task, input } = body;
    if (!task || typeof input === "undefined") {
      return new Response(JSON.stringify({ error: "Missing 'task' or 'input'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let prompt;
    let maxNewTokens = 300;

    if (task === "match_field") {
      prompt =
        "You match web form fields to profile keys. Given a field's label/placeholder/name text " +
        "and a list of valid profile keys, respond with ONLY the single best matching key from the " +
        "list, or the word NONE if nothing matches well. No punctuation, no explanation.\n\n" +
        `Field clue text: "${input.clueText}"\n` +
        `Valid profile keys: ${input.profileKeys.join(", ")}\n` +
        "Answer:";
      maxNewTokens = 10;
    } else if (task === "generate_answer") {
      prompt =
        "You write short first-person answers to application-form questions using ONLY the facts " +
        "given in the profile. Do not invent facts. Keep it to 2-4 sentences, plain text.\n\n" +
        `Question: "${input.question}"\n` +
        `Profile facts: ${JSON.stringify(input.profile)}\n` +
        "Answer:";
      maxNewTokens = 200;
    } else {
      return new Response(JSON.stringify({ error: `Unknown task: ${task}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // NOTE: Hugging Face retired the old api-inference.huggingface.co
    // endpoint. The current endpoint is router.huggingface.co, and it speaks
    // an OpenAI-compatible chat-completions format (messages[], not a raw
    // "inputs" string) rather than the old text-generation payload shape.
    const hfResponse = await fetch(
      "https://router.huggingface.co/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.HF_API_TOKEN}`,
        },
        body: JSON.stringify({
          model: HF_MODEL,
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxNewTokens,
        }),
      }
    );

    if (!hfResponse.ok) {
      const errText = await hfResponse.text();
      return new Response(JSON.stringify({ error: "Hugging Face API error", detail: errText }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await hfResponse.json();
    // Chat-completions shape: { choices: [{ message: { content: "..." } }] }
    const resultText = (data.choices?.[0]?.message?.content || "").trim();

    // TEMP DEBUG: include the raw provider response so we can see its exact
    // shape when result comes back empty. Remove this "raw" field once
    // things are working — don't ship it, it's noisy and leaks provider
    // internals to the client.
    return new Response(JSON.stringify({ result: resultText, raw: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  },
};