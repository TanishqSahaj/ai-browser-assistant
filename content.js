// content.js
// Module 1 (Form Filling) + Module 3 (Page Summarization).
// Scans the page for form fields, matches them against the saved profile,
// shows a floating preview panel, and fills the form on approval.
// Also extracts page text and shows an LLM-generated summary.

console.log("[content] script injected into this page");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_PAGE_TITLE") {
    sendResponse({ title: document.title, url: window.location.href });
  }
  if (message.type === "SCAN_FORM") {
    scanAndShowOverlay();
    sendResponse({ started: true });
  }
  if (message.type === "SUMMARIZE_PAGE") {
    summarizeAndShowOverlay();
    sendResponse({ started: true });
  }
  if (message.type === "SUMMARIZE_PAGE_TEXT") {
    (async () => {
      const pageText = extractPageText();
      if (pageText.length < 100) {
        sendResponse({ summary: null });
        return;
      }
      try {
        const response = await chrome.runtime.sendMessage({ type: "LLM_SUMMARIZE", pageText });
        sendResponse({ summary: response ? response.summary : null });
      } catch (err) {
        console.warn("[content] SUMMARIZE_PAGE_TEXT failed:", err);
        sendResponse({ summary: null });
      }
    })();
    return true; // async
  }
});

// ---- 1. SCAN: find all fillable fields on the page ----
function getFillableFields() {
  const selector = "input, textarea, select";
  const all = Array.from(document.querySelectorAll(selector));

  return all.filter((el) => {
    const type = (el.type || "").toLowerCase();
    if (["hidden", "submit", "button", "reset", "file", "image"].includes(type)) return false;
    if (el.offsetParent === null) return false; // not visible on screen
    return true;
  });
}

// ---- 2. MATCH + BUILD PANEL DATA ----
async function buildFieldPlan() {
  const profile = await getProfile();
  const fields = getFillableFields();

  // The LLM must be able to answer with any key the app understands â€” not
  // just the ones the user has filled in so far. Otherwise a correct guess
  // for an empty field gets rejected as invalid.
  const KNOWN_PROFILE_KEYS = [
    "fullName", "email", "phone", "college", "degree",
    "gradYear", "city", "linkedin", "github", "bio"
  ];

  const profileKeys = Array.from(
    new Set([...KNOWN_PROFILE_KEYS, ...Object.keys(profile)])
  );

  // Parallel, not sequential â€” a 20-field form used to mean 20 back-to-back
  // LLM round trips (~60s of frozen UI). Now they overlap.
  const plan = await Promise.all(
    fields.map(async (el, index) => {
      let matchedKey = matchFieldToProfileKey(el);
      let viaLLM = false;

      if (!matchedKey) {
        const clueText = getFieldClueText(el);
        if (clueText.trim()) {
          matchedKey = await askLLMToMatchField(clueText, profileKeys);
          if (matchedKey) viaLLM = true;
        }
      }

      const suggestedValue = matchedKey ? (profile[matchedKey] || "") : "";

      return {
        index,
        element: el,
        matchedKey,
        viaLLM,
        label: matchedKey || getFieldClueText(el).slice(0, 40) || "(unlabeled field)",
        value: suggestedValue,
        isMatched: Boolean(matchedKey && suggestedValue)
      };
    })
  );

  return plan;
}

// Ask the background worker (which holds llm.js) to guess a profile key
// for a field the keyword matcher couldn't figure out.
async function askLLMToMatchField(clueText, profileKeys) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "LLM_MATCH_FIELD",
      clueText,
      profileKeys
    });
    return response ? response.matchedKey : null;
  } catch (err) {
    console.warn("[content] LLM match request failed:", err);
    return null;
  }
}

// ---- 3. SHOW OVERLAY PANEL ----
async function scanAndShowOverlay() {
  removeExistingOverlay();
  showLoadingOverlay("Scanning pageâ€¦", "Matching fields against your profile.");

  let plan;
  try {
    plan = await buildFieldPlan();
  } catch (err) {
    console.error("[content] buildFieldPlan failed:", err);
    removeExistingOverlay();
    alert("AI Browser Assistant: scan failed â€” check the console.");
    return;
  }

  removeExistingOverlay();

  if (plan.length === 0) {
    alert("AI Browser Assistant: no fillable fields found on this page.");
    return;
  }

  const overlay = document.createElement("div");
  overlay.id = "aibrowser-overlay";

  overlay.innerHTML = `
    <h3>Form Preview <span id="aibrowser-close-x">âœ•</span></h3>
    <div id="aibrowser-field-list"></div>
    <div class="aibrowser-btn-row">
      <button id="aibrowser-cancel-btn">Cancel</button>
      <button id="aibrowser-fill-btn">Fill Form</button>
    </div>
  `;

  document.body.appendChild(overlay);

  const listEl = overlay.querySelector("#aibrowser-field-list");

  plan.forEach((item) => {
    const row = document.createElement("div");
    row.className = "aibrowser-field-row";

    let tagClass, tagText;
    if (item.isMatched && item.viaLLM) {
      tagClass = "aibrowser-tag-matched aibrowser-tag-llm";
      tagText = "matched (AI)";
    } else if (item.isMatched) {
      tagClass = "aibrowser-tag-matched";
      tagText = "matched";
    } else if (item.matchedKey && item.viaLLM) {
      tagClass = "aibrowser-tag-missing aibrowser-tag-llm";
      tagText = "AI guess â€” no data yet";
    } else if (item.matchedKey) {
      tagClass = "aibrowser-tag-missing";
      tagText = "no data â€” enter below";
    } else {
      tagClass = "aibrowser-tag-missing";
      tagText = "unmatched";
    }

    row.innerHTML = `
      <div class="aibrowser-field-label">
        <span>${escapeHtml(item.label)}</span>
        <span class="${tagClass}">${tagText}</span>
      </div>
      <input type="text" data-field-index="${item.index}" value="${escapeHtml(item.value)}" />
    `;

    listEl.appendChild(row);
  });

  overlay._plan = plan;

  overlay.querySelector("#aibrowser-close-x").addEventListener("click", removeExistingOverlay);
  overlay.querySelector("#aibrowser-cancel-btn").addEventListener("click", removeExistingOverlay);
  overlay.querySelector("#aibrowser-fill-btn").addEventListener("click", () => handleFillClick(plan));
}

// Shared "workingâ€¦" panel so the LLM round trips don't look like a hang.
function showLoadingOverlay(title = "Workingâ€¦", subtitle = "") {
  const loader = document.createElement("div");
  loader.id = "aibrowser-overlay";
  loader.innerHTML = `
    <h3>${escapeHtml(title)}</h3>
    <div style="color:#666;">${escapeHtml(subtitle)}</div>
  `;
  document.body.appendChild(loader);
}

function removeExistingOverlay() {
  const existing = document.getElementById("aibrowser-overlay");
  if (existing) existing.remove();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.innerText = str == null ? "" : String(str);
  return div.innerHTML;
}

// ---- 4. FILL: write values into the real page, and remember new ones ----
async function handleFillClick(plan) {
  const overlay = document.getElementById("aibrowser-overlay");
  const inputs = overlay.querySelectorAll("input[data-field-index]");

  const newlyLearnedFields = {};

  inputs.forEach((inputEl) => {
    const index = Number(inputEl.dataset.fieldIndex);
    const item = plan[index];
    const finalValue = inputEl.value;

    if (!finalValue) return; // user left it blank, skip

    setNativeFieldValue(item.element, finalValue);

    // Learn anything the user typed or edited for a known profile key â€”
    // including AI-guessed keys that had no stored value yet.
    if (item.matchedKey && finalValue !== item.value) {
      newlyLearnedFields[item.matchedKey] = finalValue;
    }
  });

  if (Object.keys(newlyLearnedFields).length > 0) {
    await saveProfileFields(newlyLearnedFields);
    console.log("[content] learned new profile fields:", newlyLearnedFields);
  }

  removeExistingOverlay();
}

// Setting .value directly doesn't always trigger the page's own JS
// (React-based forms especially). Fire the events the page expects.
function setNativeFieldValue(element, value) {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

  if (descriptor && descriptor.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }

  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

// ---- 5. SUMMARIZE ----
function extractPageText() {
  // Prefer semantic content containers so we don't feed nav/footer junk to
  // the model; fall back to the whole body when the page has no <article>.
  const candidate =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.body;

  // Strip script/style leftovers and collapse runaway whitespace.
  return (candidate.innerText || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function summarizeAndShowOverlay() {
  removeExistingOverlay();

  const pageText = extractPageText();
  if (pageText.length < 100) {
    alert("AI Browser Assistant: not enough text on this page to summarize.");
    return;
  }

  showLoadingOverlay("Summarizing pageâ€¦", "Sending the page text to the model.");

  let summary = null;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "LLM_SUMMARIZE",
      pageText
    });
    summary = response ? response.summary : null;
  } catch (err) {
    console.warn("[content] summarize request failed:", err);
  }

  removeExistingOverlay();

  const overlay = document.createElement("div");
  overlay.id = "aibrowser-overlay";
  overlay.innerHTML = `
    <h3>Page Summary <span id="aibrowser-close-x">âœ•</span></h3>
    <div id="aibrowser-summary-body"></div>
    <div class="aibrowser-btn-row">
      <button id="aibrowser-copy-btn">Copy</button>
      <button id="aibrowser-cancel-btn">Close</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // Set as text, not innerHTML â€” the summary is model output going onto an
  // arbitrary page, so it never gets parsed as markup.
  overlay.querySelector("#aibrowser-summary-body").innerText = summary
    ? summary
    : "Could not generate a summary â€” check the service worker console.";

  overlay.querySelector("#aibrowser-close-x").addEventListener("click", removeExistingOverlay);
  overlay.querySelector("#aibrowser-cancel-btn").addEventListener("click", removeExistingOverlay);

  const copyBtn = overlay.querySelector("#aibrowser-copy-btn");
  copyBtn.addEventListener("click", async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary);
      copyBtn.textContent = "Copied";
      setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
    } catch (err) {
      console.warn("[content] clipboard write failed:", err);
    }
  });
}
