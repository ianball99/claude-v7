import React, { useState, useRef, useEffect } from "react";

const OPERATOR_CODE = "alisdair";
const FUNCTION_URL  = "/.netlify/functions/vamoos";

// ── Core fetch via Netlify function ───────────────────────────────────────────
async function vamoosRequest(method, path, body = null, params = null) {
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

// ── Diagnostic tests ──────────────────────────────────────────────────────────
async function runDiagnostic(setDiag) {
  setDiag({ running: true, results: [] });
  const results = [];

  const add = (r) => {
    results.push(r);
    setDiag({ running: true, results: [...results] });
  };

  // Test 1: Can we reach the Netlify function at all?
  try {
    const url = `${window.location.origin}${FUNCTION_URL}?path=/itinerary&count=1`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
    add({
      label: "Netlify function",
      desc: `GET ${FUNCTION_URL}?path=/itinerary`,
      status: res.status,
      ok: res.ok,
      data,
    });
  } catch (err) {
    add({ label: "Netlify function", desc: `GET ${FUNCTION_URL}?path=/itinerary`, status: 0, ok: false, error: err.message });
  }

  // Test 2: Is the function URL even resolving? (HEAD request)
  try {
    const res = await fetch(`${window.location.origin}${FUNCTION_URL}`, { method: "HEAD" });
    add({
      label: "Function exists?",
      desc: `HEAD ${FUNCTION_URL}`,
      status: res.status,
      ok: res.status !== 404,
      data: res.status === 404 ? { error: "Function not found — check netlify/functions/vamoos.js is deployed" } : { ok: true },
    });
  } catch (err) {
    add({ label: "Function exists?", desc: `HEAD ${FUNCTION_URL}`, status: 0, ok: false, error: err.message });
  }

  // Test 3: Direct Vamoos call (will 401 or CORS — but tells us which)
  try {
    const res = await fetch("https://live.vamoos.com/v3/itinerary?count=1", {
      headers: {
        "X-User-Access-Token": "lc98kyzju11Yz6BoZ5JQqh7iBQVeuQovzOjSl1Gj",
        Accept: "application/json",
      },
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
    add({
      label: "Direct Vamoos (bypass function)",
      desc: "GET https://live.vamoos.com/v3/itinerary",
      status: res.status,
      ok: res.ok,
      data,
      note: res.ok ? "✓ Direct works! CORS is allowed." : res.status === 401 ? "Auth failed direct too" : "Non-auth error",
    });
  } catch (err) {
    add({
      label: "Direct Vamoos (bypass function)",
      desc: "GET https://live.vamoos.com/v3/itinerary",
      status: 0,
      ok: false,
      error: err.message,
      note: "CORS is blocking direct access — function proxy is needed",
    });
  }

  // Test 4: What is window.location.origin?
  add({
    label: "App origin",
    desc: "Where the app thinks it is running",
    status: 200,
    ok: true,
    data: {
      origin: window.location.origin,
      href: window.location.href,
      function_url: `${window.location.origin}${FUNCTION_URL}`,
    },
  });

  setDiag({ running: false, results });
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

// ── UI components ─────────────────────────────────────────────────────────────
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
    <div style={{ marginTop: 6 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 6, padding: "2px 10px", color: "rgba(255,255,255,0.35)",
        fontFamily: "monospace", fontSize: 10, cursor: "pointer",
      }}>
        {open ? "▲ hide" : "▼ details"}
      </button>
      {open && (
        <pre style={{
          marginTop: 6, padding: 10, borderRadius: 8,
          background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.07)",
          color: "#7ec8a0", fontFamily: "monospace", fontSize: 10.5,
          lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-all",
          maxHeight: 200, overflowY: "auto",
        }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

function DiagPanel({ diag, onRun }) {
  return (
    <div style={{
      margin: "12px 24px", padding: 16, borderRadius: 12,
      background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)",
      fontFamily: "monospace", fontSize: 11,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ color: "#d4af37", fontSize: 12, marginBottom: 3 }}>🔧 DIAGNOSTIC</div>
          <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>
            Tests the Netlify function, direct API access, and app origin.
            Share these results if still stuck.
          </div>
        </div>
        <button onClick={onRun} disabled={diag?.running} style={{
          background: "rgba(212,175,55,0.15)", border: "1px solid rgba(212,175,55,0.4)",
          borderRadius: 8, padding: "6px 16px", color: "#d4af37",
          fontFamily: "monospace", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap",
          marginLeft: 16,
        }}>
          {diag?.running ? "Running…" : "Run Tests"}
        </button>
      </div>

      {!diag?.results?.length && !diag?.running && (
        <div style={{ color: "rgba(255,255,255,0.25)" }}>Press Run Tests to diagnose the connection.</div>
      )}

      {diag?.results?.map((r, i) => (
        <div key={i} style={{
          marginBottom: 8, padding: "8px 12px", borderRadius: 8,
          background: r.ok ? "rgba(76,175,80,0.07)" : "rgba(220,80,80,0.07)",
          border: `1px solid ${r.ok ? "rgba(76,175,80,0.25)" : "rgba(220,80,80,0.2)"}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: r.ok ? "#4caf50" : "#ef5350", fontSize: 14 }}>{r.ok ? "✓" : "✗"}</span>
            <span style={{ color: r.ok ? "#4caf50" : "rgba(255,255,255,0.7)", fontWeight: "bold" }}>{r.label}</span>
            <span style={{ color: r.ok ? "#4caf50" : "#ef5350" }}>HTTP {r.status || "ERR"}</span>
          </div>
          <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, marginTop: 3 }}>{r.desc}</div>
          {r.note && <div style={{ color: "#f0c84a", fontSize: 10.5, marginTop: 4 }}>⚠ {r.note}</div>}
          {r.error && <div style={{ color: "#ef5350", fontSize: 10.5, marginTop: 4 }}>Error: {r.error}</div>}
          <RawToggle data={r.data || r.error} />
        </div>
      ))}

      {diag && !diag.running && diag.results?.length > 0 && (
        <div style={{
          marginTop: 10, padding: "10px 12px", borderRadius: 8,
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          color: "rgba(255,255,255,0.5)", fontSize: 10.5, lineHeight: 1.7,
        }}>
          <strong style={{ color: "rgba(255,255,255,0.7)" }}>How to read these results:</strong><br />
          • <strong>Netlify function ✓</strong> = proxy is working, app should work<br />
          • <strong>Netlify function ✗ 404</strong> = function file not deployed correctly<br />
          • <strong>Netlify function ✗ 0/ERR</strong> = function URL not reachable at all<br />
          • <strong>Direct Vamoos ✓</strong> = CORS is open, no proxy needed<br />
          • <strong>Direct Vamoos ERR</strong> = CORS blocked, proxy is required<br />
          Share these results and I can pinpoint the exact fix.
        </div>
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
  const [showDiag, setShowDiag]     = useState(false);
  const [diag, setDiag]             = useState(null);
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
            <button onClick={() => setShowDiag(d => !d)} style={{
              background: showDiag ? "rgba(212,175,55,0.15)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${showDiag ? "rgba(212,175,55,0.4)" : "rgba(255,255,255,0.12)"}`,
              borderRadius: 8, padding: "4px 12px",
              color: showDiag ? "#d4af37" : "rgba(255,255,255,0.4)",
              fontFamily: "'DM Mono',monospace", fontSize: 10, cursor: "pointer",
            }}>
              🔧 diag
            </button>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "rgba(255,255,255,0.2)", letterSpacing: "0.06em" }}>
              v7.3 · 2026-03-09
            </div>
            <div style={{ background: "rgba(212,175,55,0.08)", border: "1px solid rgba(212,175,55,0.22)", borderRadius: 20, padding: "4px 14px", display: "flex", alignItems: "center", gap: 7, fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#d4af37" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4caf50", boxShadow: "0 0 6px #4caf50" }} />
              {OPERATOR_CODE}
            </div>
          </div>
        </div>

        {showDiag && <DiagPanel diag={diag} onRun={() => runDiagnostic(setDiag)} />}

        {/* Chat */}
        <div style={{ width: "100%", maxWidth: 760, flex: 1, padding: "24px 24px 0", display: "flex", flexDirection: "column", gap: 16 }}>
          {isEmpty && !showDiag ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingTop: 50, animation: "fadeUp 0.7s ease both" }}>
              <div style={{ fontSize: 56, marginBottom: 20, animation: "float 4s ease-in-out infinite", filter: "drop-shadow(0 8px 24px rgba(212,175,55,0.35))" }}>🌍</div>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontWeight: 300, fontSize: 27, color: "rgba(255,255,255,0.8)", marginBottom: 8 }}>What would you like to know?</div>
              <div style={{ fontSize: 13, fontStyle: "italic", color: "rgba(255,255,255,0.3)", marginBottom: 14, textAlign: "center", fontFamily: "Georgia,serif" }}>
                Serverless function proxies API calls — Claude explains real data only.
              </div>
              <div style={{ marginBottom: 28, padding: "7px 14px", borderRadius: 8, background: "rgba(212,175,55,0.07)", border: "1px solid rgba(212,175,55,0.18)", color: "rgba(212,175,55,0.6)", fontSize: 10.5, fontFamily: "'DM Mono',monospace", textAlign: "center" }}>
                Having issues? Click 🔧 diag → Run Tests and share the results.
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
