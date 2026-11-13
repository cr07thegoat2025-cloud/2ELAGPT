const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400"
};
const encoder = new TextEncoder();
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
const basePrompt = "You are 2ELAGPT, a capable, helpful AI assistant. Be accurate, clear, thoughtful, and honest about uncertainty. Use Markdown when it improves readability.";
const codingPrompt = "You are 2ELAGPT Coding Expert, a senior software engineer and patient programming tutor. Produce correct, complete, practical code; explain key decisions; debug carefully; never claim code was tested unless it was. " + basePrompt;
const event = data => "data: " + JSON.stringify(data) + "\n\n";

async function gemini(env, messages, mode) {
  if (!env.GEMINI_API_KEY) throw new Error("Gemini API key is not configured.");
  const contents = messages.filter(m => m.role !== "system").map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content || "") }] }));
  return fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=" + encodeURIComponent(env.GEMINI_API_KEY), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: mode === "coding" ? codingPrompt : basePrompt }] }, contents, generationConfig: { temperature: 0.7, maxOutputTokens: 8192 } })
  });
}
async function openrouter(env, messages, mode) {
  if (!env.OPENROUTER_API_KEY) throw new Error("OpenRouter API key is not configured.");
  return fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", headers: { "Authorization": "Bearer " + env.OPENROUTER_API_KEY, "Content-Type": "application/json", "HTTP-Referer": "https://2elagpt.app", "X-Title": "2ELAGPT" },
    body: JSON.stringify({ model: "openrouter/free", stream: true, messages: [{ role: "system", content: mode === "coding" ? codingPrompt : basePrompt }, ...messages.filter(m => m.role !== "system").map(m => ({ role: m.role, content: String(m.content || "") }))] })
  });
}
async function* chunks(response, provider) {
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim(); if (!raw || raw === "[DONE]") continue;
        try {
          const d = JSON.parse(raw);
          const text = provider === "gemini" ? (d.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("") : (d.choices?.[0]?.delta?.content || "");
          if (text) yield { choices: [{ delta: { content: text } }], provider: provider === "gemini" ? "Gemini 2.5 Flash" : "OpenRouter Free" };
        } catch {}
      }
    }
  } finally { reader.releaseLock(); }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method === "GET" && url.pathname === "/") return json({ name: "2ELAGPT API", status: "online", endpoint: "POST /chat" });
    if (request.method !== "POST" || url.pathname !== "/chat") return json({ error: "Not found. Use POST /chat." }, 404);
    let body; try { body = await request.json(); } catch { return json({ error: "Body must be valid JSON." }, 400); }
    if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 60) return json({ error: "messages must contain 1–60 messages." }, 400);
    const messages = body.messages.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 30000) }));
    const mode = body.mode === "coding" ? "coding" : "auto"; const model = body.model || "auto";
    try {
      let response, provider;
      if (model === "openrouter/free") { response = await openrouter(env, messages, mode); provider = "openrouter"; }
      else {
        response = await gemini(env, messages, mode); provider = "gemini";
        if (!response.ok && model === "auto" && env.OPENROUTER_API_KEY) { await response.body?.cancel(); response = await openrouter(env, messages, mode); provider = "openrouter"; }
      }
      if (!response.ok) return json({ error: "AI provider error (" + response.status + "): " + (await response.text()).slice(0, 1000) }, 502);
      const stream = new ReadableStream({
        async start(controller) {
          try { for await (const part of chunks(response, provider)) controller.enqueue(encoder.encode(event(part))); controller.enqueue(encoder.encode("data: [DONE]\n\n")); }
          catch (e) { controller.enqueue(encoder.encode(event({ error: e.message || "AI stream failed." }))); }
          finally { controller.close(); }
        },
        cancel() { response.body?.cancel(); }
      });
      return new Response(stream, { headers: { ...cors, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" } });
    } catch (e) { return json({ error: e.message || "Could not reach AI provider." }, 500); }
  }
};
