// options.js
// Runs on the profile settings page.

const fieldIds = [
  "fullName", "email", "phone", "college",
  "degree", "gradYear", "city", "linkedin", "github", "bio"
];

// When the page opens, fill in any previously saved values.
window.addEventListener("DOMContentLoaded", async () => {
  const profile = await getProfile();
  fieldIds.forEach((id) => {
    if (profile[id]) {
      document.getElementById(id).value = profile[id];
    }
  });
});

// When Save is clicked, collect every field and store it.
document.getElementById("saveBtn").addEventListener("click", async () => {
  const newFields = {};
  fieldIds.forEach((id) => {
    newFields[id] = document.getElementById(id).value.trim();
  });

  await saveProfileFields(newFields);

  const status = document.getElementById("status");
  status.textContent = "✓ Profile saved";
  setTimeout(() => (status.textContent = ""), 2000);
});
