// field-matcher.js
// Pure logic, no DOM writing here — just "given this field's text clues,
// which profile key does it most likely correspond to?"
// Kept in its own file so Module 1's matching can improve over time
// (e.g. swap in an LLM call later) without touching content.js.

// Each profile key maps to keywords we'd expect to see in a label/name/
// placeholder/id for that kind of field. Order doesn't matter.
const FIELD_SYNONYMS = {
  fullName: ["full name", "your name", "name", "applicant name"],
  email: ["email", "e-mail"],
  phone: ["phone", "mobile", "contact number", "whatsapp"],
  college: ["college", "university", "institute", "school name"],
  degree: ["degree", "course", "major", "branch", "program"],
  gradYear: ["graduation year", "grad year", "year of passing", "batch"],
  city: ["city", "location", "current city"],
  linkedin: ["linkedin"],
  bio: ["bio", "about you", "why do you want", "tell us about", "why should", "sop", "statement of purpose"],
  github: ["github", "git hub"],
};

// Gather all the readable "clue text" for a form field: its <label>,
// placeholder, name attribute, id, and aria-label — lowercased and joined.
function getFieldClueText(fieldEl) {
  let clues = [];

  // Look for a <label for="fieldId">
  if (fieldEl.id) {
    const label = document.querySelector(`label[for="${CSS.escape(fieldEl.id)}"]`);
    if (label) clues.push(label.innerText);
  }

  // Look for a label that WRAPS this field
  const parentLabel = fieldEl.closest("label");
  if (parentLabel) clues.push(parentLabel.innerText);

  if (fieldEl.placeholder) clues.push(fieldEl.placeholder);
  if (fieldEl.name) clues.push(fieldEl.name);
  if (fieldEl.id) clues.push(fieldEl.id);
  if (fieldEl.getAttribute("aria-label")) clues.push(fieldEl.getAttribute("aria-label"));

  return clues.join(" ").toLowerCase();
}

// Given a field element, return the best-matching profile key, or null.
function matchFieldToProfileKey(fieldEl) {
  const clueText = getFieldClueText(fieldEl);
  if (!clueText.trim()) return null;

  for (const [profileKey, synonyms] of Object.entries(FIELD_SYNONYMS)) {
    for (const synonym of synonyms) {
      if (clueText.includes(synonym)) {
        return profileKey;
      }
    }
  }
  return null;
}
