// auth.js
// Loaded into the BACKGROUND service worker only (same as llm.js).
// Wraps chrome.identity so every Google module — Gmail, Calendar — gets
// tokens the same way and handles expiry the same way.
//
// The client_id and scopes live in manifest.json under "oauth2", so
// chrome.identity.getAuthToken reads them itself. Nothing secret lives here:
// a Chrome Extension OAuth client has no client secret by design.

// Get an access token. interactive=true pops the Google sign-in window;
// interactive=false silently returns a cached token or fails — use false for
// background work that shouldn't interrupt the user.
function getAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || "No token returned"));
        return;
      }
      resolve(token);
    });
  });
}

// Chrome caches tokens but doesn't notice server-side revocation. When an API
// call 401s, the cached token must be dropped or every retry reuses the dead
// one.
function removeCachedToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

// Sign out completely: drop the cached token AND revoke it at Google, so the
// next sign-in re-prompts for consent.
async function signOutGoogle() {
  try {
    const token = await getAuthToken(false);
    await removeCachedToken(token);
    await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
    return true;
  } catch (err) {
    console.warn("[auth] nothing to sign out:", err.message);
    return false;
  }
}

// Authenticated fetch against any Google API. Retries once on 401 after
// dropping the stale token — this is the case that bites hardest otherwise,
// because the failure looks random and only appears after ~an hour.
async function googleFetch(url, options = {}, retryOn401 = true) {
  const token = await getAuthToken(true);

  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (response.status === 401 && retryOn401) {
    console.warn("[auth] token rejected, refreshing and retrying once");
    await removeCachedToken(token);
    return googleFetch(url, options, false);
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google API ${response.status}: ${detail}`);
  }

  return response.json();
}

// Quick check used by the popup to show signed-in state.
async function getGoogleProfile() {
  return googleFetch("https://www.googleapis.com/oauth2/v2/userinfo");
}