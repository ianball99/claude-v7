import React, { useState, useRef, useEffect } from "react";

// All Vamoos API calls go through the Netlify function which adds
// the X-User-Access-Token header server-side. Works both locally
// (netlify dev) and when deployed.
const OPERATOR_CODE  = "alisdair";
const FUNCTION_URL   = "/.netlify/functions/vamoos";

// ── Core fetch ────────────────────────────────────────────────────────────────
async function vamoosRequest(method, path, body = null, params = null) {
  // Pass the Vamoos path + any params to our serverless function
  const url = new URL(FUNCTION_URL, window.location.origin);
  url.searchParams.set("path", path);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v != null) url.searchParams.append(k, String(v));
    });
  }

  try {
    const res = await fetch(url.toString(), {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

// ── Intent parser ─────────────────────────────────────────────────────────────
async function parseIntent(userMessage, history) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      system: `Intent parser for Vamoos. Operator: "${OPERATOR_CODE}". Respond ONLY with valid JSON.
Format: { "action": "<action>", "params": { ...params } }
Actions: list_itineraries, get_itinerary{reference_code}, list_pois, get_poi{id},
lookup_flight{carrier_code,flight_number,departure_airport,arrival_airport,date},
lookup_flight_legs{carrier_code,flight_number,date}, list_notification_templates,
list_conversations, list_stays, get_conversations{reference_code},
get_dnd_requests{reference_code}, unknown`,
      messages: [...history, { role: "user", content: userMessage }],
    }),
  });
  const d = await res.json();
  try { return JSON.parse((d?.content?.[0]?.text || "{}").replace(/```json|```/g, "").trim()); }
  catch { return { action: "unknown", params: {} }; }
}

// ── Summariser ────────────────────────────────────────────────────────────────
async function summarise(userMessage, apiResult, history) {
  const payload = apiResult
    ? apiResult.ok
      ? `API SUCCESS (HTTP ${apiResult.status}).\nData:\n${JSON.stringify(apiResult.data, null, 2)}`
      : `API FAILED (HTTP ${apiResult.status}).\nError: ${apiResult.error || JSON.stringify(apiResult.data)}`
    : "No matching API action.";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: `Vamoos assistant for operator "${OPERATOR_CODE}". Summarise the EXACT API data returned. If it failed, say so. NEVER invent data.`,
      messages: [...history, { role: "user", content: `User: "${userMessage}"\n\n${payload}` }],
    }),
  });
  const d = await res.json();
  return d?.content?.[0]?.text || "(No response)";
}

// ── Execute ───────────────────────────────────────────────────────────────────
async function executeAction(intent) {
  const op = OPERATOR_CODE;
  const p  = intent.params || {};
  switch (intent.action) {
    case "list_itineraries":            return vamoosRequest("GET", "/itinerary", null, p);
    case "get_itinerary":               return vamoosRequest("GET", `/itinerary/${op}/${p.reference_code}`);
    case "list_pois":                   return vamoosRequest("GET", "/poi", null, p);
    case "get_poi":                     return vamoosRequest("GET", `/poi/${p.id}`);
    case "lookup_flight":               return vamoosRequest("GET", `/flight/lookup/${p.carrier_code}/${p.flight_number}/${p.departure_airport}/${p.arrival_airport}/${p.date}`);
    case "lookup_flight_legs":          return vamoosRequest("GET", `/flight/lookup_legs/${p.carrier_code}/${p.flight_number}/${p.date}`);
    case "list_notification_templates": return vamoosRequest("GET", "/notification/list");
    case "list_conversations":          return vamoosRequest("GET", "/messaging/conversations");
    case "list_stays":                  return vamoosRequest("GET", "/itinerary/stays", null, p);
    case "get_conversations":           return vamoosRequest("GET", `/itinerary/${op}/${p.reference_code}/messaging`);
    case "get_dnd_requests":            return vamoosRequest("GET", `/itinerary/${op}/${p.reference_code}/dnd`);
    default:                            return null;
  }
}

// ── UI ────────────────────────────────────────────────────────────────────────
function Dots() {
  return (
    <div style={{ display: "flex", gap: 5 }}>
      {[0,1,2].map(i => (
        <div key={i} style={{
          width: 7, height: 7, borderRadius: "50%", background: "#d4af37",
          animation: `bop 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  );
}

function RawToggle({ data }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 8 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 6, padding: "2px 10px", color: "rgba(255,255,255,0.35)",
        fontFamily: "monospace", fontSize: 10, cursor: "pointer",
      }}>
        {open ? "▲ hide raw" : "▼ raw response"}
      </button>
      {open && (
        <pre style={{
          marginTop: 6, padding: 10, borderRadius: 8,
          background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.07)",
          color: "#7ec8a0", fontFamily: "monospace", fontSize: 10.5,
          lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-all",
          maxHeight: 300, overflowY: "auto",
        }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ApiChip({ result, action }) {
  if (!result) return null;
  return (
    <div style={{
      marginBottom: 10, padding: "7px 12px", borderRadius: 10,
      background: result.ok ? "rgba(76,175,80,0.08)" : "rgba(220,80,80,0.08)",
      border: `1px solid ${result.ok ? "rgba(76,175,80,0.25)" : "rgba(220,80,80,0.25)"}`,
    }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{
          fontFamily: "monospace", fontSize: 10, padding: "1px 8px", borderRadius: 10,
          background: result.ok ? "rgba(76,175,80,0.15)" : "rgba(220,80,80,0.15)",
          color: result.ok ? "#4caf50" : "#ef5350",
          border: `1px solid ${result.ok ? "rgba(76,175,80,0.3)" : "rgba(220,80,80,0.3)"}`,
        }}>
          {result.ok ? `✓ ${result.status}` : `✗ ${result.status || "ERR"}`}
        </span>
        <span style={{ color: "#d4af37", fontSize: 11, fontFamily: "monospace" }}>
          {action?.replace(/_/g, " ")}
        </span>
      </div>
      {!result.ok && (
        <div style={{ marginTop: 5, color: "#ef5350", fontSize: 11, fontFamily: "monospace" }}>
          {result.error || JSON.stringify(result.data)}
        </div>
      )}
      <RawToggle data={result} />
    </div>
  );
}

function Bubble({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: 4 }}>
      {!isUser && (
        <div style={{
          width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
          background: "linear-gradient(135deg,#d4af37,#a07d20)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, marginRight: 10, marginTop: 2,
        }}>✈</div>
      )}
      <div style={{
        maxWidth: "78%",
        background: isUser ? "linear-gradient(135deg,#d4af37,#b8961e)" : "rgba(255,255,255,0.04)",
        borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
        padding: "12px 16px",
        border: isUser ? "none" : "1px solid rgba(255,255,255,0.08)",
      }}>
        {msg.apiResult && <ApiChip result={msg.apiResult} action={msg.action} />}
        <div style={{
          color: isUser ? "#1a1208" : "rgba(255,255,255,0.88)",
          fontSize: 14, lineHeight: 1.7, fontFamily: "Georgia,serif",
          whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}>
          {msg.text}
        </div>
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  "List my itineraries",
  "Show POIs in France",
  "List notification templates",
  "Show all conversations",
  "List stays",
];

export default function VamoosChat() {
  const [messages, setMessages]     = useState([]);
  const [history, setHistory]       = useState([]);
  const [input, setInput]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [statusText, setStatusText] = useState("");
  const bottomRef = useRef(null);
  const taRef     = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  async function send(text) {
    const userText = (text || input).trim();
    if (!userText || loading) return;
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
    setMessages(prev => [...prev, { role: "user", text: userText }]);
    setLoading(true);
    try {
      setStatusText("Parsing intent…");
      const intent = await parseIntent(userText, history);
      let apiResult = null;
      if (intent.action && intent.action !== "unknown") {
        setStatusText(`Fetching: ${intent.action.replace(/_/g, " ")}…`);
        apiResult = await executeAction(intent);
      }
      setStatusText("Summarising…");
      const reply = await summarise(userText, apiResult, history);
      setHistory(h => [...h,
        { role: "user", content: userText },
        { role: "assistant", content: reply },
      ]);
      setMessages(prev => [...prev, { role: "assistant", text: reply, apiResult, action: intent.action }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", text: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
      setStatusText("");
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400&family=DM+Mono:wght@300;400&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}body{background:#0d0d0d;}
        @keyframes bop{0%,80%,100%{transform:translateY(0);opacity:0.4}40%{transform:translateY(-5px);opacity:1}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes float{0%,100%{transform:translateY(0) rotate(-1deg)}50%{transform:translateY(-8px) rotate(1deg)}}
        @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:rgba(212,175,55,0.2);border-radius:2px}
        textarea::-webkit-scrollbar{display:none}
      `}</style>

      <div style={{
        minHeight: "100vh", background: "#0d0d0d",
        backgroundImage: "radial-gradient(ellipse 80% 40% at 50% -5%,rgba(212,175,55,0.07) 0%,transparent 70%)",
        display: "flex", flexDirection: "column", alignItems: "center",
      }}>
        {/* Header */}
        <div style={{ width: "100%", maxWidth: 760, padding: "28px 24px 0", display: "flex", alignItems: "center", gap: 14, animation: "fadeUp 0.5s ease both" }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, background: "linear-gradient(135deg,#d4af37,#8b5e1a)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, boxShadow: "0 4px 20px rgba(212,175,55,0.3)" }}>✈</div>
          <div>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontWeight: 300, fontSize: 22, color: "rgba(255,255,255,0.9)", letterSpacing: "0.03em" }}>
              Vamoos{" "}
              <span style={{ background: "linear-gradient(90deg,#d4af37,#f0c840,#d4af37)", backgroundSize: "200% auto", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "shimmer 3s linear infinite" }}>Concierge</span>
            </div>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, marginTop: 2, color: "rgba(255,255,255,0.28)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              serverless proxy · real data only
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "rgba(255,255,255,0.2)", letterSpacing: "0.06em" }}>
              v7 · 2026-03-09
            </div>
            <div style={{ background: "rgba(212,175,55,0.08)", border: "1px solid rgba(212,175,55,0.22)", borderRadius: 20, padding: "4px 14px", display: "flex", alignItems: "center", gap: 7, fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#d4af37" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4caf50", boxShadow: "0 0 6px #4caf50" }} />
              {OPERATOR_CODE}
            </div>
          </div>
        </div>

        {/* Chat */}
        <div style={{ width: "100%", maxWidth: 760, flex: 1, padding: "24px 24px 0", display: "flex", flexDirection: "column", gap: 16 }}>
          {isEmpty ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingTop: 50, animation: "fadeUp 0.7s ease both" }}>
              <div style={{ fontSize: 56, marginBottom: 20, animation: "float 4s ease-in-out infinite", filter: "drop-shadow(0 8px 24px rgba(212,175,55,0.35))" }}>🌍</div>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontWeight: 300, fontSize: 27, color: "rgba(255,255,255,0.8)", marginBottom: 8 }}>What would you like to know?</div>
              <div style={{ fontSize: 13, fontStyle: "italic", color: "rgba(255,255,255,0.3)", marginBottom: 28, textAlign: "center", fontFamily: "Georgia,serif" }}>
                Serverless function proxies API calls — no CORS, real data only.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 480 }}>
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} onClick={() => send(s)} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: "8px 16px", fontFamily: "Georgia,serif", fontStyle: "italic", fontSize: 13, color: "rgba(255,255,255,0.5)", cursor: "pointer", transition: "all 0.2s" }}
                    onMouseEnter={e => Object.assign(e.target.style, { background: "rgba(212,175,55,0.1)", borderColor: "rgba(212,175,55,0.35)", color: "#d4af37" })}
                    onMouseLeave={e => Object.assign(e.target.style, { background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" })}
                  >{s}</button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {messages.map((msg, i) => <Bubble key={i} msg={msg} />)}
              {loading && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, paddingLeft: 42 }}>
                  <Dots />
                  <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "rgba(255,255,255,0.3)", letterSpacing: "0.05em" }}>{statusText}</span>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div style={{ width: "100%", maxWidth: 760, padding: "16px 24px 28px", background: "linear-gradient(to top,#0d0d0d 75%,transparent)", position: "sticky", bottom: 0 }}>
          {!isEmpty && <div style={{ height: 1, marginBottom: 14, background: "linear-gradient(90deg,transparent,rgba(212,175,55,0.18),transparent)" }} />}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 24, padding: "12px 12px 12px 20px" }}>
            <textarea ref={taRef} rows={1} placeholder="Ask about itineraries, flights, POIs…" value={input} disabled={loading}
              onChange={e => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              style={{ flex: 1, background: "none", border: "none", outline: "none", color: "rgba(255,255,255,0.85)", fontFamily: "Georgia,serif", fontSize: 14, lineHeight: 1.5, resize: "none", minHeight: 24, maxHeight: 120 }}
            />
            <button onClick={() => send()} disabled={!input.trim() || loading} style={{ width: 38, height: 38, borderRadius: "50%", border: "none", background: "linear-gradient(135deg,#d4af37,#a07d20)", color: "#1a1208", fontSize: 17, cursor: !input.trim() || loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 2px 12px rgba(212,175,55,0.3)", opacity: !input.trim() || loading ? 0.4 : 1 }}>↑</button>
          </div>
        </div>
      </div>
    </>
  );
}
