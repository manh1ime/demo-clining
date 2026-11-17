import { hasAdminSession } from "../lib/admin-auth.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false });
  return hasAdminSession(req)
    ? res.status(200).json({ ok: true })
    : res.status(401).json({ ok: false });
}
