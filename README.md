# AI Browser Assistant

A Chrome extension (Manifest V3) that acts as a personal assistant inside the browser. It fills forms from a saved profile, summarizes pages, triages Gmail, manages Google Calendar, and routes plain-English commands across all of these modules — powered by an open-source LLM (local Ollama or Ollama Cloud) with API keys isolated in a Cloudflare Worker.

## What it does

- **Form filling** — scans any page for fields, matches them to your saved profile using keyword rules first and an LLM fallback for the ones rules can't identify, then fills on your approval.
- **Page summarization** — extracts the main content of a page and returns a structured TLDR / key points / tags.
- **Inbox digest** — reads recent unread mail and triages it into *needs reply / FYI / ignore*.
- **Calendar** — lists upcoming events and creates new ones from natural language ("lunch with Sam on Friday at noon"), always with a review step before anything is written.
- **Command orchestrator** — turns one sentence into an ordered plan across the modules above and runs each step. "Summarize this page and add a meeting with the recruiter next Wednesday at 3pm" becomes two actions, executed in sequence.

## Architecture

The extension is a thin client. It never holds an API key and never lets the model act directly — the model only proposes, validated code disposes.

```
Popup / Pages ──▶ Background service worker ──▶ Cloudflare Worker ──▶ Ollama Cloud
   (UI)              (routing + Google APIs)      (holds the key,        (the model)
                                                   builds prompts)
```

### Files

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest — permissions, OAuth config, content-script registration |
| `background.js` | Service worker. Routes every message; imports the modules below |
| `llm.js` | Provider abstraction — local Ollama, Ollama Cloud, or Hugging Face, switched by one constant |
| `auth.js` | Wraps `chrome.identity` — Google tokens, refresh, and 401 retry for all Google calls |
| `gmail.js` | Gmail REST wrapper — lists messages, walks the MIME tree, decodes base64url bodies |
| `calendar.js` | Calendar REST wrapper — lists events, creates events, parses and validates model JSON |
| `field-matcher.js` | Keyword field matching (no LLM) — tried before any model call |
| `content.js` | Runs in the page — scans fields, shows overlays, fills forms, extracts page text |
| `storage.js` | Thin wrapper over `chrome.storage.local` — one source of truth for the profile |
| `options.html` / `options.js` | Profile editor |
| `popup.html` / `popup.js` | Toolbar entry point for every feature |
| `digest.html` / `digest.js` | Inbox digest page |
| `calendar.html` / `calendar-page.js` | Calendar view and quick-add page |
| `command.html` / `command-page.js` | The orchestrator UI — plans and runs multi-step commands |
| `worker-ollama.js` | Cloudflare Worker holding the Ollama Cloud key; builds all prompts server-side |
| `worker-huggingface.js` | Alternate Worker for the Hugging Face provider |
| `wrangler-ollama.toml` / `wrangler-hf.toml` | Worker deployment configs |

### Design principles

- **Keys never live in the extension.** Anyone can unpack a Chrome extension and read its files, so hosted-provider keys sit in a Cloudflare Worker that builds prompts server-side. The extension only sends `{ task, input }`.
- **The model proposes; code disposes.** The LLM suggests a field key, an event, or a plan — but every result is parsed and validated before it does anything. Calendar writes and (eventually) email sends always get a human confirmation.
- **One provider switch.** Flip `LLM_PROVIDER` in `llm.js` between `"ollama"`, `"ollama-cloud"`, and `"huggingface"`; every feature follows.
- **Keyword first, LLM second.** Field matching tries free, instant keyword rules before spending an API call — the model only handles what rules miss.

## Setup

### 1. Load the extension

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. The extension ID is pinned via the `key` in `manifest.json`, so it stays stable across reloads

### 2. Choose an LLM provider

In `llm.js`, set `LLM_PROVIDER`.

**Local Ollama** (no key, no backend, runs on your machine):

```bash
# Windows PowerShell
$env:OLLAMA_ORIGINS = "chrome-extension://*"
ollama serve
```

Pull a small model that fits your VRAM — `llama3.2:3b` or `qwen2.5:3b` are plenty for these tasks:

```bash
ollama pull llama3.2:3b
```

Set `OLLAMA_MODEL` to match. On a 4 GB GPU, cap the context if you hit out-of-memory errors: `$env:OLLAMA_CONTEXT_LENGTH = "2048"`.

**Ollama Cloud** (no local VRAM; needs a key, so it goes through a Worker):

```bash
wrangler secret put OLLAMA_API_KEY --config wrangler-ollama.toml
wrangler deploy --config wrangler-ollama.toml
```

Paste the deployed URL into `OLLAMA_CLOUD_BACKEND_URL` in `llm.js`. Cloud model names carry a `-cloud` suffix (e.g. `gpt-oss:20b-cloud`); check ollama.com/library for the current list.

### 3. Google OAuth (for Gmail + Calendar)

1. In Google Cloud Console, create a project and enable the **Gmail API** and **Google Calendar API** (each is toggled on per-project separately).
2. Under **Google Auth Platform → Data Access**, add these scopes:
   - `userinfo.email`
   - `gmail.readonly`
   - `gmail.send`
   - `calendar.events`
3. Under **Audience → Test users**, add your own Google account — only listed test users can sign in while the app is unpublished.
4. Under **Clients**, create an **OAuth client ID** of type **Chrome Extension** with your extension's ID.
5. Paste the client ID into the `oauth2` block in `manifest.json`.

Reload the extension, open the popup, and click **Connect Google**. Expect an "unverified app" screen — normal for an unpublished app with sensitive scopes; click through Advanced → Continue.

## Usage

Everything is reachable from the toolbar popup.

- **Scan & Fill This Page** — preview and fill a form
- **Summarize This Page** — structured summary in an overlay
- **Inbox Digest** — triaged view of recent unread mail
- **Calendar** — upcoming events + natural-language quick-add
- **Command…** — describe a multi-step task in one sentence

The Command popup acts on the tab behind it, so page actions ("summarize this page", "fill this form") need a normal web page focused when you open it.

## Notes and limitations

- **Test-user only.** Gmail and Calendar are sensitive scopes; publishing to other users requires Google's verification process (weeks, security review). As a test user everything works immediately.
- **Relative dates.** The model resolves "next Tuesday" imperfectly — weekday arithmetic is a known LLM weakness. The parse → preview → confirm flow exists precisely so a wrong date never lands on your real calendar unreviewed.
- **Active-tab heuristic.** Page actions target the focused tab. This is correct for a single window but can surprise you with multiple windows open.
- **PowerShell console encoding.** When testing Worker responses directly, em-dashes and curly quotes may render as garbled characters in the terminal — a Windows-1252 vs UTF-8 display artifact only. Chrome renders them correctly.

## Roadmap

Built (phases 0–9): foundations, skeleton, profile storage, form filling, LLM integration, summarization, Google OAuth, Gmail digest, Calendar, and the command orchestrator.

Remaining:

- **Email drafter** — read a thread, generate a contextual reply, and save it to Gmail Drafts for review (never auto-send). The one genuinely missing capability.
- **Long-answer form fields** — wire up the existing `llmGenerateAnswer` so "why should we hire you" textareas get a generated answer from your bio rather than the raw bio pasted in.
- **Polish** — dropdown for the digest query, better multi-window tab handling.
