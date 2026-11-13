import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Bot, ChevronDown, Copy, Menu, MessageSquarePlus, PanelLeftClose, Plus, Settings2, Sparkles, SquarePen, Trash2, X, Zap } from "lucide-react";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
const starter = [{ id: "welcome", role: "assistant", content: "Hey! I'm **2ELAGPT**. What are we figuring out today?\n\nI can help you write, learn, brainstorm, code, and solve problems." }];
const uid = () => globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random());

export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [messages, setMessages] = useState(starter);
  const [history, setHistory] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("auto");
  const [modelOpen, setModelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [provider, setProvider] = useState("Automatic");
  const endRef = useRef(null);
  const abortRef = useRef(null);
  const textareaRef = useRef(null);
  const configured = Boolean(supabase);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);
  useEffect(() => {
    if (!session || !supabase) return;
    loadChats();
  }, [session]);

  async function loadChats() {
    const { data, error } = await supabase.from("conversations").select("id,title,updated_at").order("updated_at", { ascending: false }).limit(40);
    if (!error) setHistory(data || []);
  }
  async function loadChat(id) {
    if (!supabase || !session) return;
    const { data } = await supabase.from("messages").select("id,role,content").eq("conversation_id", id).order("created_at");
    if (data) { setMessages(data); setActiveId(id); setError(""); }
  }
  async function saveMessage(conversationId, role, content) {
    if (!supabase || !session) return;
    const { error } = await supabase.from("messages").insert({ conversation_id: conversationId, role, content });
    if (error) console.error("Could not save message:", error.message);
  }
  async function ensureConversation(firstText) {
    if (activeId) return activeId;
    const title = firstText.trim().slice(0, 56) || "New chat";
    if (!supabase || !session) return null;
    const { data, error } = await supabase.from("conversations").insert({ user_id: session.user.id, title }).select("id").single();
    if (error) throw error;
    setActiveId(data.id); loadChats(); return data.id;
  }
  function newChat() {
    abortRef.current?.abort();
    setMessages(starter); setActiveId(null); setError(""); setInput(""); setBusy(false);
    if (window.innerWidth < 760) setSidebarOpen(false);
  }
  async function authenticate(e) {
    e.preventDefault(); setAuthBusy(true); setAuthError("");
    try {
      const action = authMode === "signin" ? supabase.auth.signInWithPassword({ email, password }) : supabase.auth.signUp({ email, password });
      const { error } = await action;
      if (error) throw error;
      setAuthOpen(false); setPassword("");
    } catch (err) { setAuthError(err.message || "Authentication failed."); }
    finally { setAuthBusy(false); }
  }
  async function sendMessage(e) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput(""); setError("");
    const userMessage = { id: uid(), role: "user", content: text };
    const assistantMessage = { id: uid(), role: "assistant", content: "" };
    const next = [...messages.filter(m => m.id !== "welcome" || messages.length > 1), userMessage, assistantMessage];
    setMessages(next); setBusy(true);
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const conversationId = await ensureConversation(text);
      if (conversationId) await saveMessage(conversationId, "user", text);
      const endpoint = supabaseUrl ? supabaseUrl + "/functions/v1/chat" : "";
      if (!endpoint || !supabaseAnonKey) throw new Error("2ELAGPT isn't connected yet. Add your Supabase URL and anon key, then deploy the chat function. See README.md.");
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (session?.access_token || supabaseAnonKey), "apikey": supabaseAnonKey },
        body: JSON.stringify({ messages: next.filter(m => m.id !== "welcome").map(({ role, content }) => ({ role, content })), model }),
        signal: controller.signal
      });
      if (!response.ok) {
        let detail = "Request failed (" + response.status + ")";
        try { const body = await response.json(); detail = body.error || body.message || detail; } catch {}
        throw new Error(detail);
      }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let answer = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim(); if (payload === "[DONE]") continue;
          try {
            const data = JSON.parse(payload);
            if (data.error) throw new Error(data.error);
            const delta = data.choices?.[0]?.delta?.content ?? data.delta ?? "";
            if (delta) { answer += delta; setMessages(current => current.map(m => m.id === assistantMessage.id ? { ...m, content: answer } : m)); }
            if (data.provider) setProvider(data.provider);
          } catch (parseError) { if (parseError.message && !parseError.message.includes("JSON")) throw parseError; }
        }
      }
      if (!answer) throw new Error("The model returned an empty response. Check your provider keys and quotas.");
      if (conversationId) { await saveMessage(conversationId, "assistant", answer); await loadChats(); }
    } catch (err) {
      if (err.name !== "AbortError") { setError(err.message || "Something went wrong."); setMessages(current => current.filter(m => m.id !== assistantMessage.id)); }
    } finally { setBusy(false); abortRef.current = null; }
  }
  function stop() { abortRef.current?.abort(); setBusy(false); }
  async function deleteChat(id, e) {
    e?.stopPropagation(); if (!supabase || !session) return;
    await supabase.from("conversations").delete().eq("id", id);
    setHistory(h => h.filter(c => c.id !== id)); if (activeId === id) newChat();
  }
  const suggestions = useMemo(() => [
    ["Lightbulb", "Explain a difficult topic in simple terms"],
    ["Code", "Help me build a useful app"],
    ["Pen", "Write something clear and engaging"],
    ["Rocket", "Give me ideas for a new project"]
  ], []);
  return <div className="app-shell">
    <aside className={"sidebar " + (sidebarOpen ? "open" : "closed")}>
      <div className="brand-row"><div className="brand-mark">2</div><div className="brand-name">2ELA<span>GPT</span><small>YOUR INTELLIGENCE. WITHOUT LIMITS.</small></div><button className="icon-btn sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar"><PanelLeftClose size={18}/></button></div>
      <button className="new-chat" onClick={newChat}><SquarePen size={17}/> New chat <span>⌘ K</span></button>
      <div className="history-label">RECENT</div>
      <div className="history-list">{history.map(chat => <div className={"history-item " + (activeId === chat.id ? "selected" : "")} key={chat.id} onClick={() => loadChat(chat.id)}><MessageSquarePlus size={15}/><span>{chat.title}</span><button title="Delete chat" onClick={e => deleteChat(chat.id, e)}><Trash2 size={14}/></button></div>)}</div>
      <div className="sidebar-bottom">
        <div className="plan-card"><div className="plan-icon"><Zap size={16}/></div><div><b>2ELAGPT V1</b><small>Multi-model intelligence</small></div><span className="online-dot"/></div>
        <button className="profile-row" onClick={() => configured ? (session ? supabase.auth.signOut() : setAuthOpen(true)) : setSettingsOpen(true)}>
          <div className="avatar">{session?.user?.email?.[0]?.toUpperCase() || "G"}</div><div className="profile-copy"><b>{session?.user?.email || "Guest session"}</b><small>{session ? "Sign out" : configured ? "Sign in / create account" : "Backend setup required"}</small></div><Settings2 size={17}/>
        </button>
      </div>
    </aside>
    <main className="main-panel">
      <header className="topbar"><div className="top-left"><button className="icon-btn" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle sidebar"><Menu size={19}/></button><span className="top-brand">2ELA<span>GPT</span></span><div className="model-wrap"><button className="model-button" onClick={() => setModelOpen(!modelOpen)}> {model === "auto" ? "Auto" : model} <ChevronDown size={14}/></button>{modelOpen && <div className="model-menu"><button onClick={() => {setModel("auto");setModelOpen(false)}}><Sparkles size={15}/> Auto <small>Recommended</small></button><button onClick={() => {setModel("gemini-2.5-flash");setModelOpen(false)}}><Bot size={15}/> Gemini Flash</button><button onClick={() => {setModel("openrouter/free");setModelOpen(false)}}><Zap size={15}/> OpenRouter Free</button></div>}</div></div><div className="top-actions"><span className="provider-label"><i/> {provider}</span><button className="upgrade-btn" onClick={() => setSettingsOpen(true)}>API setup</button></div></header>
      <section className="chat-scroll">
        {messages.length === 1 && messages[0].id === "welcome" ? <div className="welcome"><div className="welcome-orb"><Sparkles size={27}/></div><div className="eyebrow">A NEW KIND OF ASSISTANT</div><h1>Your intelligence.<br/><em>Without limits.</em></h1><p>Ideas in. Possibilities out. Meet your new thinking partner.</p><div className="suggestion-grid">{suggestions.map(([icon, label]) => <button key={label} onClick={() => setInput(label)}><span>{icon === "Code" ? "{ }" : icon === "Pen" ? "✎" : icon === "Rocket" ? "↗" : "✧"}</span>{label}<ArrowUp size={14}/></button>)}</div></div> :
        <div className="messages">{messages.filter(m => m.id !== "welcome").map(m => <article className={"message " + m.role} key={m.id}><div className="message-avatar">{m.role === "assistant" ? <div className="mini-mark">2</div> : (session?.user?.email?.[0]?.toUpperCase() || "Y")}</div><div className="message-body"><div className="message-name">{m.role === "assistant" ? "2ELAGPT" : "You"}</div><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || (busy ? " " : "")}</ReactMarkdown></div>{m.role === "assistant" && m.content && <button className="copy-btn" onClick={() => navigator.clipboard?.writeText(m.content)}><Copy size={13}/> Copy</button>}</div></article>)}{busy && <div className="thinking"><span/><span/><span/> 2ELAGPT is thinking</div>}<div ref={endRef}/></div>}
      </section>
      <div className="composer-area">{error && <div className="error-banner"><span>{error}</span><button onClick={() => setError("")}><X size={15}/></button></div>}<form className="composer" onSubmit={sendMessage}><textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => {if (e.key === "Enter" && !e.shiftKey) {e.preventDefault();sendMessage();}}} placeholder="Message 2ELAGPT..." rows={1}/>{busy ? <button className="send-btn stop-btn" type="button" onClick={stop}>■</button> : <button className="send-btn" type="submit" disabled={!input.trim()}><ArrowUp size={19}/></button>}</form><div className="composer-note">2ELAGPT can make mistakes. Verify important information. <span>V1.0</span></div></div>
    </main>
    {authOpen && <div className="modal-backdrop" onClick={() => setAuthOpen(false)}><form className="modal" onSubmit={authenticate} onClick={e => e.stopPropagation()}><button type="button" className="modal-x" onClick={() => setAuthOpen(false)}><X/></button><div className="modal-logo">2</div><h2>{authMode === "signin" ? "Welcome back" : "Create your account"}</h2><p>Save your conversations across devices.</p><label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required/></label><label>Password<input type="password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} required/></label>{authError && <div className="auth-error">{authError}</div>}<button className="modal-submit" disabled={authBusy}>{authBusy ? "Please wait..." : authMode === "signin" ? "Sign in" : "Create account"}</button><button type="button" className="mode-switch" onClick={() => setAuthMode(authMode === "signin" ? "signup" : "signin")}>{authMode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}</button></form></div>}
    {settingsOpen && <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}><div className="modal setup-modal" onClick={e => e.stopPropagation()}><button className="modal-x" onClick={() => setSettingsOpen(false)}><X/></button><div className="modal-logo"><Settings2/></div><h2>Connect 2ELAGPT</h2><p>The frontend is designed to keep provider keys on the server. Never paste secret API keys into this website.</p><div className="setup-step"><b>1. Create a Supabase project</b><span>Copy its Project URL and anon/public key into your local .env file.</span></div><div className="setup-step"><b>2. Deploy the chat function</b><span>Set GEMINI_API_KEY and OPENROUTER_API_KEY as Supabase Edge Function secrets.</span></div><div className="setup-step"><b>3. Run the database migration</b><span>Use supabase/migrations/001_init.sql in the Supabase SQL editor.</span></div><a className="docs-link" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Open Supabase dashboard ↗</a></div></div>}
  </div>;
}