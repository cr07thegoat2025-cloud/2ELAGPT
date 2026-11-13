import { sql } from "@vercel/postgres";

const init = async () => {
  await sql`CREATE TABLE IF NOT EXISTS bikchu_requests (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(254) NOT NULL,
    package VARCHAR(40) NOT NULL,
    idea TEXT NOT NULL,
    budget VARCHAR(80),
    status VARCHAR(30) NOT NULL DEFAULT 'New',
    ai_brief TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!process.env.POSTGRES_URL) return res.status(503).json({ error: "The request database is not connected yet. Please try again later." });

  try {
    await init();
    const body = req.body || {};
    // Honeypot field: real visitors leave this empty.
    if (body.website) return res.status(200).json({ ok: true });
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const packageChoice = String(body.package || "Not sure yet").trim();
    const idea = String(body.idea || "").trim();
    const budget = String(body.budget || "").trim().slice(0, 80);
    if (name.length < 2 || name.length > 100) return res.status(400).json({ error: "Please enter a name between 2 and 100 characters." });
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Please enter a valid email address." });
    if (!["Basic App — $10", "Advanced App — $30", "Pro App — $50", "Not sure yet"].includes(packageChoice)) return res.status(400).json({ error: "Please choose one of the listed packages." });
    if (idea.length < 15 || idea.length > 5000) return res.status(400).json({ error: "Please describe your idea in 15–5,000 characters." });

    const result = await sql`INSERT INTO bikchu_requests (name, email, package, idea, budget)
      VALUES (${name}, ${email}, ${packageChoice}, ${idea}, ${budget})
      RETURNING id`;
    return res.status(201).json({ ok: true, requestId: result.rows[0].id });
  } catch (error) {
    console.error("BIKCHU request save failed:", error);
    return res.status(500).json({ error: "We couldn't save your request. Please try again later." });
  }
}
