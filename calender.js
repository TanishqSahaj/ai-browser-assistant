// calendar.js
// Loaded into the BACKGROUND service worker only (alongside llm.js, auth.js,
// gmail.js). Thin wrapper over the Google Calendar REST API — every call goes
// through googleFetch from auth.js, so token refresh is handled there.

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

// List upcoming events on the primary calendar.
// singleEvents=true expands recurring events into individual instances —
// without it a weekly standup returns as ONE item with a recurrence rule,
// which is useless for "what's on today". orderBy=startTime requires it.
async function calendarListUpcoming(maxResults = 10, daysAhead = 7) {
  const now = new Date();
  const end = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    maxResults: String(maxResults),
    singleEvents: "true",
    orderBy: "startTime"
  });

  const data = await googleFetch(
    `${CALENDAR_API}/calendars/primary/events?${params.toString()}`
  );

  return (data.items || []).map((item) => ({
    id: item.id,
    summary: item.summary || "(no title)",
    location: item.location || "",
    description: item.description || "",
    // All-day events carry `date`; timed events carry `dateTime`. Callers
    // need to know which, so keep the distinction rather than flattening it.
    start: item.start?.dateTime || item.start?.date || "",
    end: item.end?.dateTime || item.end?.date || "",
    isAllDay: Boolean(item.start?.date && !item.start?.dateTime),
    htmlLink: item.htmlLink || ""
  }));
}

// Create an event. `event` must already be in Google's shape — the LLM
// produces it and validateEventShape checks it before we get here.
async function calendarCreateEvent(event) {
  return googleFetch(`${CALENDAR_API}/calendars/primary/events`, {
    method: "POST",
    body: JSON.stringify(event)
  });
}

// The model returns JSON as text and sometimes wraps it in code fences or
// adds a sentence before it. Pull out the first balanced JSON object.
function parseEventJSON(raw) {
  if (!raw) return null;

  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) return null;

  try {
    return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
  } catch (err) {
    console.warn("[calendar] could not parse event JSON:", err, cleaned);
    return null;
  }
}

// Never POST straight from model output. A malformed dateTime returns a 400
// that's hard to trace back; a missing summary silently creates a blank event.
function validateEventShape(event) {
  if (!event || typeof event !== "object") return "Not an object";
  if (!event.summary) return "Missing summary";
  if (!event.start || !event.end) return "Missing start or end";

  const startValue = event.start.dateTime || event.start.date;
  const endValue = event.end.dateTime || event.end.date;
  if (!startValue || !endValue) return "Start or end has no date/dateTime";

  if (Number.isNaN(Date.parse(startValue))) return `Unparseable start: ${startValue}`;
  if (Number.isNaN(Date.parse(endValue))) return `Unparseable end: ${endValue}`;

  if (Date.parse(endValue) <= Date.parse(startValue)) return "End is not after start";

  return null; // valid
}

// Format for display in the events list.
function formatEventTime(event) {
  if (event.isAllDay) {
    return new Date(event.start).toLocaleDateString(undefined, {
      weekday: "short", month: "short", day: "numeric"
    }) + " (all day)";
  }

  const start = new Date(event.start);
  const end = new Date(event.end);

  const dayPart = start.toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric"
  });
  const timePart =
    start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) +
    " – " +
    end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return `${dayPart}, ${timePart}`;
}