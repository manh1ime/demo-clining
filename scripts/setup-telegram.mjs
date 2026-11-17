const site = String(process.env.PUBLIC_SITE_URL || "").replace(/\/$/, "");
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!site || !secret) throw new Error("Set PUBLIC_SITE_URL and TELEGRAM_WEBHOOK_SECRET in the local environment");

const response = await fetch(`${site}/api/setup`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
  body: JSON.stringify({ action: process.argv.includes("--check") ? "check" : "setup" }),
});
const result = await response.json();
console.log(JSON.stringify(result, null, 2));
if (!response.ok || !result.ok) process.exit(1);
