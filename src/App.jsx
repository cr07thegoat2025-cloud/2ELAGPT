import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Bot, ChevronDown, Copy, Menu, MessageSquarePlus, PanelLeftClose, Settings2, Sparkles, SquarePen, Trash2, X, Zap } from "lucide-react";

const starter = [{ id: "welcome", role: "assistant", content: "Hey! I'm **2ELAGPT**. What are we figuring out today?\n\nI can help you write, learn, brainstorm, code, and solve problems." }];
const uid = () => globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random());
const DEFAULT_API = import.meta.env.VITE_API_URL || "";
const readSaved = () => { try { return JSON.parse(localStorage.getItem("2ela_chats") || "[]"); } catch { return []; } };

export default function App() {
  const [messages, setMessages] = useState(starter);
  const [history, setHistory] = useState(readSaved);
  const [activeId, setActiveId] = useState(null);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("openrouter/free");
  const [codingMode, setCodingMode] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem("2ela_api_url") || DEFAULT_API);
  const [apiDraft, setApiDraft] = useState(() => localStorage.getItem("2ela_api_url") || DEFAULT_API);
  const [provider, setProvider] = useState("API not connected");
  const endRef = useRef(null);
  const abortRef = useRef(null);
  const suggestions = useMemo(() => [
    ["Lightbulb", "Explain a difficult topic in simple terms"],
    ["Code", "Help me build a useful app"],
    ["Pen", "Write something clear and engaging"],
    ["Rocket", "Give me ideas for a new project"]
  ], []);

  useEffect(() => { try { localStorage.setItem("2ela_chats", JSON.stringify(history.slice(0, 40))); } catch {} }, [history]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  function saveCurrentChat(nextMessages, id = activeId) {
    const chatId = id || uid();
    const first = nextMessages.find(m => m.role === "user")?.content || "New chat";
    const chat = { id: chatId, title: first.slice(0, 56), messages: nextMessages.filter(m => m.id !== "welcome"), updated_at: Date.now() };
    setHistory(old => [chat, ...old.filter(c => c.id !== chatId)].slice(0, 40));
    setActiveId(chatId);
    return chatId;
  }
  function newChat() {
    abortRef.current?.abort();
    setMessages(starter); setActiveId(null); setError(""); setInput(""); setBusy(false);
    if (window.innerWidth < 760) setSidebarOpen(false);
  }
  function loadChat(chat) { setMessages(chat.messages?.length ? chat.messages : starter); setActiveId(chat.id); setError(""); }
  function deleteChat(id, e) {
    e?.stopPropagation();
    setHistory(h => h.filter(c => c.id !== id));
    if (activeId === id) newChat();
  }
  function saveApi() {
    const clean = apiDraft.trim().replace(/\/+$/, "");
    if (clean && !/^https:\/\//i.test(clean)) { setError("API address must start with https://"); return; }
    localStorage.setItem("2ela_api_url", clean);
    setApiUrl(clean); setSettingsOpen(false); setError("");
    setProvider(clean ? "API configured" : "API not connected");
  }
  async function sendMessage(e) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    if (!apiUrl) { setError("Connect your 2ELAGPT API first: open API setup and enter your Vercel deployment URL."); setSettingsOpen(true); setApiDraft(apiUrl); return; }
    setInput(""); setError("");
    const userMessage = { id: uid(), role: "user", content: text };
    const assistantMessage = { id: uid(), role: "assistant", content: "" };
    const next = [...messages.filter(m => m.id !== "welcome" || messages.length > 1), userMessage, assistantMessage];
    setMessages(next); setBusy(true);
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const response = await fetch(apiUrl.endsWith("/api/chat") ? apiUrl : apiUrl + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.filter(m => m.id !== "welcome").map(({ role, content }) => ({ role, content })), model, mode: codingMode ? "coding" : "auto" }),
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
            if (data.provider) { setProvider(data.provider); }
          } catch (parseError) { if (parseError.message && !parseError.message.includes("JSON")) throw parseError; }
        }
      }
      if (!answer) throw new Error("The AI returned an empty response. Check OPENROUTER_API_KEY and your OpenRouter account quota.");
      const finalMessages = next.map(m => m.id === assistantMessage.id ? { ...m, content: answer } : m);
      setHistory(old => {
        const id = activeId || uid();
        const first = finalMessages.find(m => m.role === "user")?.content || "New chat";
        const chat = { id, title: first.slice(0, 56), messages: finalMessages.filter(m => m.id !== "welcome"), updated_at: Date.now() };
        setActiveId(id);
        return [chat, ...old.filter(c => c.id !== id)].slice(0, 40);
      });
    } catch (err) {
      if (err.name !== "AbortError") { setError(err.message || "Something went wrong."); setMessages(current => current.filter(m => m.id !== assistantMessage.id)); }
    } finally { setBusy(false); abortRef.current = null; }
  }
  function stop() { abortRef.current?.abort(); setBusy(false); }

  return <div className="app-shell">
    <aside className={"sidebar " + (sidebarOpen ? "open" : "closed")}>
      <div className="brand-row"><div className="brand-mark">2</div><div className="brand-name">2ELA<span>GPT</span><small>YOUR INTELLIGENCE. WITHOUT LIMITS.</small></div><button className="icon-btn sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar"><PanelLeftClose size={18}/></button></div>
      <button className="new-chat" onClick={newChat}><SquarePen size={17}/> New chat <span>⌘ K</span></button>
      <div className="history-label">RECENT CHATS</div>
      <div className="history-list">{history.map(chat => <div className={"history-item " + (activeId === chat.id ? "selected" : "")} key={chat.id} onClick={() => loadChat(chat)}><MessageSquarePlus size={15}/><span>{chat.title}</span><button title="Delete chat" onClick={e => deleteChat(chat.id, e)}><Trash2 size={14}/></button></div>)}</div>
      <div className="sidebar-bottom">
        <div className="plan-card"><div className="plan-icon"><Zap size={16}/></div><div><b>2ELAGPT V1</b><small>Powered by OpenRouter</small></div><span className="online-dot"/></div>
        <button className="profile-row" onClick={() => {setApiDraft(apiUrl);setSettingsOpen(true)}}><div className="avatar">2</div><div className="profile-copy"><b>Guest session</b><small>{apiUrl ? "API configured" : "Connect AI backend"}</small></div><Settings2 size={17}/></button>
      </div>
    </aside>
    <main className="main-panel">
      <header className="topbar"><div className="top-left"><button className="icon-btn" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle sidebar"><Menu size={19}/></button><span className="top-brand">2ELA<span>GPT</span></span><button className={"model-button " + (codingMode ? "coding-active" : "")} onClick={() => setCodingMode(v => !v)} title="Toggle specialist coding mode">{codingMode ? "{ } Coding ON" : "{ } Coding"}</button><div className="model-wrap"><button className="model-button" onClick={() => setModelOpen(!modelOpen)}>{model === "auto" ? "Auto" : "OpenRouter Free"} <ChevronDown size={14}/></button>{modelOpen && <div className="model-menu"><button onClick={() => {setModel("auto");setModelOpen(false)}}><Sparkles size={15}/> Auto <small>Recommended</small></button><button onClick={() => {setModel("openrouter/free");setModelOpen(false)}}><Zap size={15}/> OpenRouter Free</button></div>}</div></div><div className="top-actions"><span className="provider-label"><i/> {provider}</span><button className="upgrade-btn" onClick={() => {setApiDraft(apiUrl);setSettingsOpen(true)}}>API setup</button></div></header>
      <section className="chat-scroll">
        {messages.length === 1 && messages[0].id === "welcome" ? <div className="welcome"><div className="welcome-orb"><Sparkles size={27}/></div><div className="eyebrow">A NEW KIND OF ASSISTANT</div><h1>Your intelligence.<br/><em>Without limits.</em></h1><p>Ideas in. Possibilities out. Meet your new thinking partner.</p><div className="suggestion-grid">{suggestions.map(([icon, label]) => <button key={label} onClick={() => setInput(label)}><span>{icon === "Code" ? "{ }" : icon === "Pen" ? "✎" : icon === "Rocket" ? "↗" : "✧"}</span>{label}<ArrowUp size={14}/></button>)}</div></div> :
        <div className="messages">{messages.filter(m => m.id !== "welcome").map(m => <article className={"message " + m.role} key={m.id}><div className="message-avatar">{m.role === "assistant" ? <div className="mini-mark">2</div> : "Y"}</div><div className="message-body"><div className="message-name">{m.role === "assistant" ? "2ELAGPT" : "You"}</div><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || (busy ? " " : "")}</ReactMarkdown></div>{m.role === "assistant" && m.content && <button className="copy-btn" onClick={() => navigator.clipboard?.writeText(m.content)}><Copy size={13}/> Copy</button>}</div></article>)}{busy && <div className="thinking"><span/><span/><span/> 2ELAGPT is thinking</div>}<div ref={endRef}/></div>}
      </section>
      <div className="composer-area">{error && <div className="error-banner"><span>{error}</span><button onClick={() => setError("")}><X size={15}/></button></div>}<form className="composer" onSubmit={sendMessage}><textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => {if (e.key === "Enter" && !e.shiftKey) {e.preventDefault();sendMessage();}}} placeholder="Message 2ELAGPT..." rows={1}/>{busy ? <button className="send-btn stop-btn" type="button" onClick={stop}>■</button> : <button className="send-btn" type="submit" disabled={!input.trim()}><ArrowUp size={19}/></button>}</form><div className="composer-note">2ELAGPT can make mistakes. Verify important information. <span>V1.0</span></div></div>
    </main>
    {settingsOpen && <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}><div className="modal setup-modal" onClick={e => e.stopPropagation()}><button className="modal-x" onClick={() => setSettingsOpen(false)}><X/></button><div className="modal-logo"><Settings2/></div><h2>Connect 2ELAGPT AI</h2><p>Paste your 2ELAGPT Vercel deployment address. It should look like https://your-project.vercel.app</p><label>Vercel deployment URL<input type="url" value={apiDraft} onChange={e => setApiDraft(e.target.value)} placeholder="https://your-project.vercel.app"/></label><button className="modal-submit" onClick={saveApi}>Save API address</button><div className="setup-step"><b>Your OpenRouter key stays private</b><span>Add OPENROUTER_API_KEY in Vercel Project Settings → Environment Variables. Never put the key in this app.</span></div><a className="docs-link" href="https://vercel.com/dashboard" target="_blank" rel="noreferrer">Open Vercel dashboard ↗</a></div></div>}
  </div>;
}
