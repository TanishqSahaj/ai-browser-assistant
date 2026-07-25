// calendar-page.js
// Runs on calendar.html. Lists upcoming events and handles the
// parse -> preview -> confirm flow for creating one from plain English.

const eventsEl = document.getElementById("events");
const quickAddEl = document.getElementById("quickAdd");
const previewEl = document.getElementById("preview");
const statusEl = document.getElementById("status");
const parseBtn = document.getElementById("parseBtn");
const refreshBtn = document.getElementById("refreshBtn");

let pendingEvent = null;

// ---- List ----
function loadEvents() {
  eventsEl.textContent = "Loading…";

  chrome.runtime.sendMessage({ type: "CALENDAR_LIST" }, (response) => {
    if (!response || !response.ok) {
      eventsEl.textContent = response?.error
        ? `Failed: ${response.error}`
        : "Failed — check the service worker console.";
      return;
    }

    if (response.events.length === 0) {
      eventsEl.textContent = "Nothing scheduled in the next 7 days.";
      return;
    }

    eventsEl.innerHTML = "";
    response.events.forEach((ev) => {
      const div = document.createElement("div");
      div.className = "event";

      const title = document.createElement("div");
      title.className = "event-title";
      title.textContent = ev.summary;

      const time = document.createElement("div");
      time.className = "event-time";
      time.textContent = formatEventTimeLocal(ev);

      div.appendChild(title);
      div.appendChild(time);

      if (ev.location) {
        const loc = document.createElement("div");
        loc.className = "event-loc";
        loc.textContent = ev.location;
        div.appendChild(loc);
      }

      eventsEl.appendChild(div);
    });
  });
}

// calendar.js lives in the service worker, so this page can't call its
// formatter — duplicated here rather than plumbing a message round trip
// just to format a string.
function formatEventTimeLocal(event) {
  if (event.isAllDay) {
    return new Date(event.start).toLocaleDateString(undefined, {
      weekday: "short", month: "short", day: "numeric"
    }) + " (all day)";
  }

  const start = new Date(event.start);
  const end = new Date(event.end);

  return (
    start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) +
    ", " +
    start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) +
    " – " +
    end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  );
}

// ---- Parse ----
parseBtn.addEventListener("click", () => {
  const text = quickAddEl.value.trim();
  if (!text) return;

  statusEl.textContent = "Parsing…";
  previewEl.style.display = "none";
  pendingEvent = null;

  chrome.runtime.sendMessage(
    {
      type: "CALENDAR_PARSE",
      text,
      // The service worker has no reliable local timezone, so send both from
      // the page where Intl actually reflects the user's settings.
      nowISO: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    (response) => {
      if (!response || !response.ok) {
        statusEl.textContent = response?.error
          ? `Failed: ${response.error}`
          : "Failed — check the service worker console.";
        if (response?.raw) console.warn("[calendar] raw model output:", response.raw);
        return;
      }

      pendingEvent = response.event;
      statusEl.textContent = "";
      showPreview(response.event);
    }
  );
});

function showPreview(event) {
  previewEl.innerHTML = "";
  previewEl.style.display = "block";

  const title = document.createElement("div");
  title.style.fontWeight = "600";
  title.textContent = event.summary;

  const when = document.createElement("div");
  when.style.color = "#555";
  when.style.marginTop = "4px";
  when.textContent = formatEventTimeLocal({
    start: event.start.dateTime || event.start.date,
    end: event.end.dateTime || event.end.date,
    isAllDay: Boolean(event.start.date && !event.start.dateTime)
  });

  previewEl.appendChild(title);
  previewEl.appendChild(when);

  if (event.location) {
    const loc = document.createElement("div");
    loc.style.color = "#777";
    loc.style.marginTop = "2px";
    loc.textContent = event.location;
    previewEl.appendChild(loc);
  }

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Add to Calendar";
  confirmBtn.addEventListener("click", createPendingEvent);

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.className = "secondary";
  cancelBtn.addEventListener("click", () => {
    previewEl.style.display = "none";
    pendingEvent = null;
  });

  previewEl.appendChild(confirmBtn);
  previewEl.appendChild(cancelBtn);
}

// ---- Create ----
function createPendingEvent() {
  if (!pendingEvent) return;

  statusEl.textContent = "Creating…";

  chrome.runtime.sendMessage(
    { type: "CALENDAR_CREATE", event: pendingEvent },
    (response) => {
      if (!response || !response.ok) {
        statusEl.textContent = response?.error
          ? `Failed: ${response.error}`
          : "Failed — check the service worker console.";
        return;
      }

      statusEl.textContent = "✓ Added to your calendar";
      previewEl.style.display = "none";
      quickAddEl.value = "";
      pendingEvent = null;
      loadEvents();

      setTimeout(() => (statusEl.textContent = ""), 3000);
    }
  );
}

refreshBtn.addEventListener("click", loadEvents);

quickAddEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") parseBtn.click();
});

loadEvents();