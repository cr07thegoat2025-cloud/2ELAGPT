import { sql } from "@vercel/postgres";

const init = async () => {
  await sql`CREATE TABLE IF NOT EXISTS bikchu_requests (
    id BIGSERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(254) NOT NULL,
    package VARCHAR(40) NOT NULL, idea TEXT NOT NULL, budget VARCHAR(80),
    status VARCHAR(30) NOT NULL DEFAULT 'New', ai_brief TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.ADMIN_PASSWORD) return res.status(503).json({ error: "Admin password is not configured." });
  const auth = req.headers.authorization || "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (supplied.length !== process.env.ADMIN_PASSWORD.length || supplied !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Incorrect admin password." });
  }
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  if (!process.env.POSTGRES_URL) return res.status(503).json({ error: "Database is not connected." });
  try {
    await init();
    const result = await sql`SELECT id, name, email, package, idea, budget, status, ai_brief, created_at
      FROM bikchu_requests ORDER BY created_at DESC LIMIT 100`;
    return res.status(200).json({ requests: result.rows });
  } catch (error) {
    console.error("BIKCHU admin list failed:", error);
    return res.status(500).json({ error: "Could not load requests." });
  }
}
