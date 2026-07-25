// command-page.js
// Runs on command.html. Asks the background worker to turn a sentence into an
// ordered plan, then executes each step by reusing the same message types the
// individual module pages already use. The LLM plans; execution stays in code.

const commandEl = document.getElementById("command");
const planBtn = document.getElementById("planBtn");
const planEl = document.getElementById("plan");

// Human-readable labels for the action types the planner can emit.
const ACTION_LABELS = {
  fill_form: "Fill form on current page",
  summarize_page: "Summarize current page",
  inbox_digest: "Triage inbox",
  create_event: "Add calendar event",
  list_events: "List upcoming events"
};

planBtn.addEventListener("click", async () => {
  const text = commandEl.value.trim();
  if (!text) return;

  planBtn.disabled = true;
  planEl.innerHTML = `<div class="step"><span class="running">Planning…</span></div>`;

  const planResponse = await sendMessage({ type: "PLAN_ACTIONS", text });

  if (!planResponse.ok) {
    planEl.innerHTML = `<div class="step"><span class="failed">Planning failed: ${escapeText(planResponse.error)}</span></div>`;
    if (planResponse.raw) console.warn("[command] raw planner output:", planResponse.raw);
    planBtn.disabled = false;
    return;
  }

  if (planResponse.plan.length === 0) {
    planEl.innerHTML = `<div class="step"><span class="failed">No matching actions found for that request.</span></div>`;
    planBtn.disabled = false;
    return;
  }

  await runPlan(planResponse.plan);
  planBtn.disabled = false;
});

// Render the plan as a list of step cards, then execute sequentially. Steps
// run in order because later steps may depend on earlier ones (fill the form,
// THEN summarize; the user's mental model is a sequence).
async function runPlan(plan) {
  planEl.innerHTML = "";
  const stepEls = plan.map((step, i) => renderStep(step, i));

  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    const el = stepEls[i];

    setStepStatus(el, "running", "running…");

    try {
      const detail = await executeStep(step);
      setStepStatus(el, "done", "done");
      if (detail) setStepDetail(el, detail);
    } catch (err) {
      setStepStatus(el, "failed", "failed");
      setStepDetail(el, err.message);
      // Keep going — one failed step shouldn't abort the rest. Triaging the
      // inbox is still useful even if a calendar step failed.
    }
  }
}

// Map one plan step to the module message that does the work. Each arm returns
// a short detail string shown under the step, or throws on failure.
async function executeStep(step) {
  switch (step.action) {
    case "fill_form": {
      const tab = await getActiveNonExtensionTab();
      if (!tab) throw new Error("No ordinary web page tab is open to fill.");
      await sendToTab(tab.id, { type: "SCAN_FORM" });
      return "Opened the fill preview on the active page.";
    }

    case "summarize_page": {
      const tab = await getActiveNonExtensionTab();
      if (!tab) throw new Error("No ordinary web page tab is open to summarize.");
      const res = await sendToTabExpectReply(tab.id, { type: "SUMMARIZE_PAGE_TEXT" });
      if (!res || !res.summary) throw new Error("Summary came back empty.");
      return res.summary;
    }

    case "inbox_digest": {
      const res = await sendMessage({ type: "GMAIL_DIGEST" });
      if (!res.ok) throw new Error(res.error || "Digest failed.");
      if (res.count === 0) return "No unread messages.";
      return res.digest || "Digest came back empty.";
    }

    case "list_events": {
      const res = await sendMessage({ type: "CALENDAR_LIST" });
      if (!res.ok) throw new Error(res.error || "Could not list events.");
      if (res.events.length === 0) return "Nothing scheduled in the next 7 days.";
      return res.events
        .map((e) => `• ${e.summary} — ${e.start}`)
        .join("\n");
    }

    case "create_event": {
      const parseRes = await sendMessage({
        type: "CALENDAR_PARSE",
        text: step.text || "",
        nowISO: new Date().toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      });
      if (!parseRes.ok) throw new Error(parseRes.error || "Could not parse the event.");

      // Calendar writes always get a confirmation, even inside a plan — a
      // hallucinated date must never land on the real calendar unreviewed.
      const ev = parseRes.event;
      const when = ev.start.dateTime || ev.start.date;
      const confirmed = window.confirm(
        `Add this event?\n\n${ev.summary}\n${new Date(when).toLocaleString()}` +
        (ev.location ? `\n${ev.location}` : "")
      );
      if (!confirmed) return "Skipped — you cancelled.";

      const createRes = await sendMessage({ type: "CALENDAR_CREATE", event: ev });
      if (!createRes.ok) throw new Error(createRes.error || "Could not create the event.");
      return `Added: ${ev.summary}`;
    }

    default:
      throw new Error(`Unknown action: ${step.action}`);
  }
}

// ---- DOM helpers ----
function renderStep(step, i) {
  const div = document.createElement("div");
  div.className = "step";

  const head = document.createElement("div");
  head.className = "step-head";

  const action = document.createElement("span");
  action.className = "step-action";
  action.textContent = `${i + 1}. ${ACTION_LABELS[step.action] || step.action}`;

  const status = document.createElement("span");
  status.className = "step-status pending";
  status.textContent = "pending";

  head.appendChild(action);
  head.appendChild(status);
  div.appendChild(head);

  if (step.text) {
    const detail = document.createElement("div");
    detail.className = "step-detail";
    detail.textContent = `"${step.text}"`;
    div.appendChild(detail);
  }

  planEl.appendChild(div);
  return div;
}

function setStepStatus(el, cls, text) {
  const status = el.querySelector(".step-status");
  status.className = `step-status ${cls}`;
  status.textContent = text;
}

function setStepDetail(el, text) {
  let detail = el.querySelector(".step-detail.result");
  if (!detail) {
    detail = document.createElement("div");
    detail.className = "step-detail result";
    el.appendChild(detail);
  }
  detail.textContent = text;
}

function escapeText(s) {
  return s == null ? "" : String(s);
}

// ---- messaging helpers ----
function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: "No response" });
    });
  });
}

function sendToTab(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, () => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve();
    });
  });
}

function sendToTabExpectReply(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(response);
    });
  });
}

// The command page is itself a tab, and so are digest/calendar pages. Find the
// most recently active ordinary web page to act on.
// Inside a popup, the active tab of the current window IS the page the user
// is looking at — no heuristic needed.
function getActiveNonExtensionTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const t = tabs[0];
      if (t && t.url && (t.url.startsWith("http://") || t.url.startsWith("https://"))) {
        resolve(t);
      } else {
        resolve(null);
      }
    });
  });
}