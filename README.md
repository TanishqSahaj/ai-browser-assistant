@"
# AI Browser Assistant

Chrome extension (MV3) that fills web forms from a saved profile, using an LLM
to match fields the keyword matcher can't identify.

## Architecture

- ``content.js`` — scans the page, shows the preview overlay, writes values
- ``field-matcher.js`` — free keyword matching, tried first
- ``background.js`` — service worker, routes LLM requests
- ``llm.js`` — provider abstraction: local Ollama, Ollama Cloud, or Hugging Face
- ``worker-ollama.js`` / ``worker-huggingface.js`` — Cloudflare Workers holding API keys

API keys never live in the extension. Hosted providers are proxied through a
Cloudflare Worker that builds prompts server-side.

## Setup

1. Load unpacked at ``chrome://extensions``
2. Set your profile on the options page
3. Pick a provider in ``llm.js`` (``LLM_PROVIDER``)

**Local Ollama:**