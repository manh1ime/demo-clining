const auth = document.getElementById("adminAuth");
const app = document.getElementById("crmApp");
const form = document.getElementById("adminLoginForm");
const status = document.getElementById("adminAuthStatus");
const localMode = import.meta.env.DEV || import.meta.env.MODE === "internal";
let loaded = false;

async function openPanel() {
  auth.hidden = true;
  app.hidden = false;
  if (!loaded) {
    loaded = true;
    await import("./leads.js");
  }
  document.getElementById("adminLogout")?.addEventListener("click", async () => {
    if (!localMode) await fetch("/api/admin-logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    window.location.reload();
  });
}

async function hasSession() {
  if (localMode) return true;
  try {
    const response = await fetch("/api/admin-session", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return false;
    const result = await response.json().catch(() => ({}));
    return result.ok === true;
  } catch {
    return false;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button[type=submit]");
  const password = document.getElementById("adminPassword").value;
  status.hidden = true;
  button.disabled = true;
  button.textContent = "Проверяем...";
  try {
    const response = await fetch("/api/admin-login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) throw new Error("Неверный пароль или временная блокировка входа.");
    form.reset();
    await openPanel();
  } catch (error) {
    status.textContent = error.message || "Не удалось проверить пароль. Попробуйте ещё раз.";
    status.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "Войти";
  }
});

if (await hasSession()) {
  await openPanel();
} else {
  auth.hidden = false;
  app.hidden = true;
  document.getElementById("adminPassword").focus();
}

if (!localMode) {
  window.setInterval(async () => {
    if (!(await hasSession())) window.dispatchEvent(new Event("crm:session-expired"));
  }, 300_000);
}
