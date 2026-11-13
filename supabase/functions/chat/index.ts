import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const encoder = new TextEncoder();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const safeModels: Record<string, { provider: "gemini" | "openrouter"; model: string }> = {
  "gemini-2.5-flash": { provider: "gemini", model: "gemini-2.5-flash" },
  "openrouter/free": { provider: "openrouter", model: "openrouter/free" },
};

const BASE_INSTRUCTIONS = `You are 2ELAGPT, a capable, friendly, precise AI assistant.
Be useful, clear, and honest. Answer the user's actual question. Do not invent facts, sources, test results, or capabilities. If uncertain, say what is uncertain and how to verify it. Follow the conversation context and ask a focused clarification only when necessary.
When writing code, provide complete, runnable solutions where practical, explain important decisions, include setup/run instructions when needed, and never claim code was executed unless it actually was. Prefer secure, maintainable, accessible code. Do not expose secrets or ask users to paste API keys into public code.`;

const CODING_INSTRUCTIONS = `You are now operating in 2ELAGPT CODING EXPERT mode.
Act as a senior software engineer, debugger, architect, and patient coding teacher.
- Diagnose the root cause before proposing a fix; do not guess when logs or source are available.
- Produce correct, complete code that fits the user's existing language, framework, versions, and project structure.
- Preserve existing working behavior and avoid unnecessary rewrites.
- Explain exactly which files change and provide full replacement files or precise patches.
- Consider edge cases, errors, security, performance, accessibility, and mobile responsiveness.
- For debugging, explain the likely cause, the fix, and a reproducible verification checklist.
- For new projects, propose a sensible architecture and implement in small testable steps.
- Never invent APIs, package methods, build results, or successful tests. Clearly label assumptions.
- Use fenced code blocks with the correct language. Keep explanations beginner-friendly when the user is learning.`;

function sse(payload: unknown) {
  return encoder.encode("data: " + JSON.stringify(payload) + "\n\n");
}

function isCodingRequest(messages: Array<{ role: string; content: string }>) {
  const latest = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  return /\b(code|coding|program|programming|debug|bug|error|stack trace|function|class|api|html|css|javascript|typescript|python|java|c#|c\+\+|lua|sql|react|node|godot|scratch|github|build|compile|website|app|script|algorithm|database|terminal|command line)\b/i.test(latest);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json(503, { error: "The 2ELAGPT server is missing Supabase configuration." });
  }

  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Sign in is required to use 2ELAGPT." });

  const db = createClient(supabaseUrl, serviceKey);
  const authClient = createClient(supabaseUrl, anonKey);
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) return json(401, { error: "Your session is invalid or expired. Please sign in again." });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body." }); }

  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  if (!rawMessages.length || rawMessages.length > 50) return json(400, { error: "Send between 1 and 50 messages." });
  const messages = rawMessages
    .filter((m: any) => m && (m.role === "user" || m.role === "assistant"))
    .map((m: any) => ({ role: m.role, content: String(m.content ?? "").slice(0, 20000) }))
    .filter((m: { content: string }) => m.content.trim());
  if (!messages.length) return json(400, { error: "Message content is empty." });

  const { count: usageCount, error: usageError } = await db
    .from("usage_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userData.user.id)
    .gte("created_at", new Date(Date.now() - 60_000).toISOString());
  if (usageError) return json(503, { error: "Usage protection is temporarily unavailable. Please retry shortly." });
  if ((usageCount ?? 0) >= 20) return json(429, { error: "You've reached the current limit of 20 messages per minute. Please wait and try again." });

  const requested = safeModels[String(body.model || "auto")];
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  const routerKey = Deno.env.get("OPENROUTER_API_KEY");
  const candidates = requested
    ? [requested]
    : [{ provider: "gemini" as const, model: "gemini-2.5-flash" }, { provider: "openrouter" as const, model: "openrouter/free" }];

  if (!candidates.some((c) => c.provider === "gemini" ? !!geminiKey : !!routerKey)) {
    return json(503, { error: "No selected AI provider is configured. Add the required provider key to Supabase Edge Function secrets." });
  }

  const mode = body.mode === "coding" ? "coding" : body.mode === "general" ? "general" : "auto";
  const codingMode = mode === "coding" || (mode === "auto" && isCodingRequest(messages));
  const systemPrompt = BASE_INSTRUCTIONS + (codingMode ? "\n\n" + CODING_INSTRUCTIONS : "");
  const latestUserText = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const stream = new ReadableStream({
    async start(controller) {
      let lastError = "All configured AI providers failed.";
      for (const candidate of candidates) {
        const key = candidate.provider === "gemini" ? geminiKey : routerKey;
        if (!key) continue;
        try {
          let upstream: Response;
          if (candidate.provider === "gemini") {
            const contents = messages.map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            }));
            upstream = await fetch(
              "https://generativelanguage.googleapis.com/v1beta/models/" + candidate.model + ":streamGenerateContent?alt=sse&key=" + key,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  systemInstruction: { parts: [{ text: systemPrompt }] },
                  contents,
                  generationConfig: { temperature: 0.55, maxOutputTokens: 8192 },
                }),
              },
            );
          } else {
            upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: {
                "Authorization": "Bearer " + key,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://2elagpt.app",
                "X-Title": "2ELAGPT",
              },
              body: JSON.stringify({
                model: candidate.model,
                messages: [
                  { role: "system", content: systemPrompt },
                  ...messages.map((m) => ({ role: m.role, content: m.content })),
                ],
                stream: true,
                temperature: 0.55,
                max_tokens: 8192,
              }),
            });
          }

          if (!upstream.ok || !upstream.body) {
            const detail = await upstream.text().catch(() => "");
            lastError = candidate.provider + " returned HTTP " + upstream.status + (detail ? ": " + detail.slice(0, 300) : "");
            continue;
          }

          controller.enqueue(sse({ provider: candidate.provider === "gemini" ? "Gemini" : "OpenRouter", mode: codingMode ? "Coding" : "General" }));
          const reader = upstream.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let emittedText = false;

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
                const item = JSON.parse(raw);
                const delta = candidate.provider === "gemini"
                  ? (item.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("")
                  : (item.choices?.[0]?.delta?.content || "");
                if (delta) {
                  emittedText = true;
                  controller.enqueue(sse({ choices: [{ delta: { content: delta } }] }));
                }
              } catch { /* Ignore non-JSON keepalive or malformed provider event. */ }
            }
          }

          if (!emittedText) {
            lastError = candidate.provider + " returned an empty response.";
            continue;
          }

          await db.from("usage_events").insert({
            user_id: userData.user.id,
            provider: candidate.provider,
            model: candidate.model,
          });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
      controller.enqueue(sse({ error: lastError }));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive" },
  });
});
