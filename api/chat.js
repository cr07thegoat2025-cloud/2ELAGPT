const BASE_PROMPT = "You are 2ELAGPT, a capable, helpful AI assistant. Be accurate, clear, thoughtful, and honest about uncertainty. Use Markdown when it improves readability.";
const CODING_PROMPT = "You are 2ELAGPT Coding Expert, a senior software engineer and patient programming tutor. Produce correct, complete, practical code; explain key decisions; debug carefully; never claim code was tested unless it was. " + BASE_PROMPT;
const send = (res, data) => res.write("data: " + JSON.stringify(data) + "\n\n");

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST /api/chat." });
  if (!process.env.OPENROUTER_API_KEY) return res.status(500).json({ error: "The server is missing OPENROUTER_API_KEY. Add it in Vercel Project Settings → Environment Variables, then redeploy." });

  const body = req.body || {};
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 60) {
    return res.status(400).json({ error: "messages must contain 1–60 messages." });
  }
  const mode = body.mode === "coding" ? "coding" : "auto";
  const messages = [
    { role: "system", content: mode === "coding" ? CODING_PROMPT : BASE_PROMPT },
    ...body.messages.filter(m => m && (m.role === "user" || m.role === "assistant"))
      .map(m => ({ role: m.role, content: String(m.content || "").slice(0, 30000) }))
  ];

  let upstream;
  try {
    upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + process.env.OPENROUTER_API_KEY,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://2elagpt.app",
        "X-Title": "2ELAGPT"
      },
      body: JSON.stringify({
        model: typeof body.model === "string" && body.model.startsWith("openrouter/") ? body.model : "openrouter/free",
        stream: true,
        messages
      })
    });
  } catch {
    return res.status(502).json({ error: "Could not reach OpenRouter. Please try again." });
  }

  if (!upstream.ok) {
    const detail = (await upstream.text()).slice(0, 900);
    return res.status(502).json({ error: "OpenRouter error (" + upstream.status + "): " + detail });
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const packet = JSON.parse(raw);
          if (packet.error) {
            send(res, { error: packet.error.message || "OpenRouter stream error." });
            continue;
          }
          const delta = packet.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            send(res, { choices: [{ delta: { content: delta } }], provider: "OpenRouter" });
          } else if (Array.isArray(delta)) {
            const content = delta.map(part => part.text || "").join("");
            if (content) send(res, { choices: [{ delta: { content } }], provider: "OpenRouter" });
          }
        } catch {
          // Ignore non-JSON keepalive or metadata lines from the upstream stream.
        }
      }
    }
    send(res, { provider: "OpenRouter", done: true });
    res.write("data: [DONE]\n\n");
  } catch (error) {
    send(res, { error: "The OpenRouter stream was interrupted. Please retry." });
  } finally {
    reader.releaseLock();
    res.end();
  }
}
