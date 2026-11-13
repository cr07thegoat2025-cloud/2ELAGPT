import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const encoder = new TextEncoder();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const safeModels: Record<string, { provider: string; model: string }> = {
  "gemini-2.5-flash": { provider: "gemini", model: "gemini-2.5-flash" },
  "openrouter/free": { provider: "openrouter", model: "openrouter/free" }
};
function sse(payload: unknown) { return encoder.encode("data: " + JSON.stringify(payload) + "\n\n"); }

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const db = createClient(supabaseUrl, serviceKey);
  const { data: userData, error: userError } = await createClient(supabaseUrl, anonKey).auth.getUser(token);
  if (userError || !userData.user) return json(401, { error: "Sign in is required to use the hosted API." });
  const { data: usage } = await db.from("usage_events").select("id", { count: "exact", head: true }).eq("user_id", userData.user.id).gte("created_at", new Date(Date.now() - 60_000).toISOString());
  if ((usage?.length ?? 0) >= 20) return json(429, { error: "Rate limit reached. Please wait a minute and try again." });
  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body." }); }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length || messages.length > 50) return json(400, { error: "Send between 1 and 50 messages." });
  const clean = messages.map((m: any) => ({ role: m.role === "assistant" ? "model" : "user", content: String(m.content ?? "").slice(0, 20000) })).filter((m: any) => m.content);
  if (!clean.length) return json(400, { error: "Message content is empty." });
  const requested = safeModels[String(body.model || "auto")];
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  const routerKey = Deno.env.get("OPENROUTER_API_KEY");
  const candidates = requested ? [requested] : [{ provider: "gemini", model: "gemini-2.5-flash" }, { provider: "openrouter", model: "openrouter/free" }];
  if (!geminiKey && !routerKey) return json(503, { error: "No model provider is configured. Add GEMINI_API_KEY or OPENROUTER_API_KEY to Edge Function secrets." });
  const stream = new ReadableStream({
    async start(controller) {
      let lastError = "All configured AI providers failed.";
      for (const candidate of candidates) {
        const key = candidate.provider === "gemini" ? geminiKey : routerKey;
        if (!key) continue;
        try {
          let upstream: Response;
          if (candidate.provider === "gemini") {
            const contents = clean.map((m: any) => ({ role: m.role, parts: [{ text: m.content }] }));
            upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + candidate.model + ":streamGenerateContent?alt=sse&key=" + key, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents, generationConfig: { temperature: 0.7, maxOutputTokens: 4096 } }) });
          } else {
            upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json", "HTTP-Referer": "https://2elagpt.app", "X-Title": "2ELAGPT" }, body: JSON.stringify({ model: candidate.model, messages: clean.map((m: any) => ({ role: m.role === "model" ? "assistant" : "user", content: m.content })), stream: true, temperature: 0.7 }) });
          }
          if (!upstream.ok || !upstream.body) { lastError = candidate.provider + " returned HTTP " + upstream.status; continue; }
          controller.enqueue(sse({ provider: candidate.provider === "gemini" ? "Gemini" : "OpenRouter" }));
          const reader = upstream.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
          while (true) {
            const { value, done } = await reader.read(); if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n"); buffer = lines.pop() || "";
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              const raw = line.slice(5).trim(); if (!raw || raw === "[DONE]") continue;
              try {
                const item = JSON.parse(raw);
                const delta = candidate.provider === "gemini" ? (item.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("") : (item.choices?.[0]?.delta?.content || "");
                if (delta) controller.enqueue(sse({ choices: [{ delta: { content: delta } }] }));
              } catch { /* ignore malformed provider event */ }
            }
          }
          await db.from("usage_events").insert({ user_id: userData.user.id, provider: candidate.provider, model: candidate.model });
          controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close(); return;
        } catch (err) { lastError = err instanceof Error ? err.message : String(err); }
      }
      controller.enqueue(sse({ error: lastError })); controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close();
    }
  });
  return new Response(stream, { headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } });
});