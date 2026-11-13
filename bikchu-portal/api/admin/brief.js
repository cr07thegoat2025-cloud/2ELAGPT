import { sql } from "@vercel/postgres";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const password = process.env.ADMIN_PASSWORD || "";
  const auth = req.headers.authorization || "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!password || supplied.length !== password.length || supplied !== password) return res.status(401).json({ error: "Unauthorized." });
  if (!process.env.POSTGRES_URL || !process.env.OPENROUTER_API_KEY) return res.status(503).json({ error: "Connect the database and add OPENROUTER_API_KEY in Vercel first." });

  try {
    const id = Number(req.body?.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid request ID." });
    const found = await sql`SELECT id, name, package, idea, budget FROM bikchu_requests WHERE id = ${id} LIMIT 1`;
    if (!found.rows.length) return res.status(404).json({ error: "Request not found." });
    const project = found.rows[0];
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + process.env.OPENROUTER_API_KEY,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://bikchu.com",
        "X-Title": "BIKCHU Project Assistant"
      },
      body: JSON.stringify({
        model: "openrouter/free",
        messages: [
          { role: "system", content: "You are BIKCHU's internal project planning assistant. Create a concise, practical project brief. Include: summary, core features, recommended technology, complexity (simple/medium/complex), likely risks, suggested starting price in USD based on the stated package ($10/$30/$50) and whether a custom quote is more appropriate. Treat all pricing as a draft estimate only. Do not promise delivery dates or claim anything has been built or tested. The owner must review and approve everything. Output readable Markdown." },
          { role: "user", content: JSON.stringify({ name: project.name, requestedPackage: project.package, budget: project.budget, idea: project.idea }) }
        ]
      })
    });
    if (!upstream.ok) {
      const detail = (await upstream.text()).slice(0, 500);
      return res.status(502).json({ error: "OpenRouter returned " + upstream.status + ": " + detail });
    }
    const data = await upstream.json();
    const brief = data.choices?.[0]?.message?.content;
    if (!brief) return res.status(502).json({ error: "The AI returned an empty project brief." });
    await sql`UPDATE bikchu_requests SET ai_brief = ${brief} WHERE id = ${id}`;
    return res.status(200).json({ brief });
  } catch (error) {
    console.error("BIKCHU brief generation failed:", error);
    return res.status(500).json({ error: "Could not generate a project brief." });
  }
}
