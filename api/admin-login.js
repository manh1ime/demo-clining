import { createSessionCookie, verifyPassword } from "../lib/admin-auth.js";

const attempts = new Map();

function bodyOf(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return req.body ? JSON.parse(req.body) : {};
}

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  if (!process.env.ADMIN_PASSWORD) return res.status(503).json({ ok: false, error: "ADMIN_PASSWORD is not configured" });

  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const now = Date.now();
  const record = attempts.get(ip) || { count: 0, resetAt: now + 15 * 60_000 };
  if (record.resetAt < now) { record.count = 0; record.resetAt = now + 15 * 60_000; }
  if (record.count >= 8) return res.status(429).json({ ok: false });

  let body;
  try { body = bodyOf(req); } catch { return res.status(400).json({ ok: false }); }
  if (!verifyPassword(body.password)) {
    record.count += 1;
    attempts.set(ip, record);
    return res.status(401).json({ ok: false });
  }

  attempts.delete(ip);
  res.setHeader("Set-Cookie", createSessionCookie());
  return res.status(200).json({ ok: true });
}
