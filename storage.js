// storage.js
// A tiny shared helper around chrome.storage.local.
// EVERY module we build later (form filling, email, calendar) will import
// this same file to read/write the user's profile — one source of truth.

const PROFILE_KEY = "userProfile";

// Get the whole saved profile object. Returns {} if nothing saved yet.
function getProfile() {
  return new Promise((resolve) => {
    chrome.storage.local.get([PROFILE_KEY], (result) => {
      resolve(result[PROFILE_KEY] || {});
    });
  });
}

// Save (merge) new fields into the profile without wiping existing ones.
function saveProfileFields(newFields) {
  return new Promise(async (resolve) => {
    const current = await getProfile();
    const updated = { ...current, ...newFields };
    chrome.storage.local.set({ [PROFILE_KEY]: updated }, () => {
      resolve(updated);
    });
  });
}

// Save a single field learned "on the fly" — e.g. Module 1 will call this
// when it asks the user for a missing field and gets an answer.
function saveOneField(fieldName, value) {
  return saveProfileFields({ [fieldName]: value });
}
