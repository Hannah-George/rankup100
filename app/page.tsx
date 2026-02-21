// @ts-nocheck
"use client";
import { useState, useEffect, useRef, useCallback } from "react";

/* ╔══════════════════════════════════════════════════════════════╗
   ║              SUPABASE CONFIG — PASTE YOUR KEYS HERE          ║
   ╚══════════════════════════════════════════════════════════════╝ */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://kfdwmjmzehgrdzlsidlw.supabase.co";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmZHdtam16ZWhncmR6bHNpZGx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDIxNDYsImV4cCI6MjA4NzE3ODE0Nn0.rcPzFPzW5HuD95dMMUhvd6ANkb_gg499FfRcwhN8h1E";

/* ╔══════════════════════════════════════════════════════════════╗
   ║         MINIMAL SUPABASE REST CLIENT (no auth.users)         ║
   ║   Only talks to public.users, public.questions, public.attempts ║
   ╚══════════════════════════════════════════════════════════════╝ */
const supabase = {
  _headers: () => ({
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  }),

  from: (table: string) => {
    const state = {
      _table: table,
      _filters: [],
      _selectCols: "*",
      _orderCol: null,
      _orderAsc: true,
      _limitN: null,
      _singleRow: false,
    };

    const builder = {
      select(cols = "*") { state._selectCols = cols; return builder; },
      eq(col, val) { state._filters.push(`${col}=eq.${encodeURIComponent(val)}`); return builder; },
      order(
  col: string, 
  { ascending = true }: { ascending?: boolean } = {}
) {
  state._orderCol = col;
  state._orderAsc = ascending;
  return builder;
}, { state._orderCol = col; state._orderAsc = ascending; return builder; },
      limit(n: number) { state._limitN = n; return builder; },
      single() { state._singleRow = true; return builder; },

      async _fetch() {
        let url = `${SUPABASE_URL}/rest/v1/${state._table}?select=${encodeURIComponent(state._selectCols)}`;
        if (state._filters.length) url += "&" + state._filters.join("&");
        if (state._orderCol) url += `&order=${state._orderCol}.${state._orderAsc ? "asc" : "desc"}`;
        if (state._limitN) url += `&limit=${state._limitN}`;
        if (state._singleRow) url += "&limit=1";
        const res = await fetch(url, { headers: supabase._headers() });
        const json = await res.json();
        if (!res.ok) return { data: null, error: json };
        const d = state._singleRow ? (Array.isArray(json) ? json[0] || null : json) : json;
        return { data: d, error: null };
      },

      then(resolve, reject) { return builder._fetch().then(resolve, reject); },

      async insert(rows) {
        const url = `${SUPABASE_URL}/rest/v1/${state._table}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { ...supabase._headers(), Prefer: "return=representation" },
          body: JSON.stringify(rows),
        });
        const json = await res.json();
        return { data: res.ok ? json : null, error: res.ok ? null : json };
      },

      async update(vals) {
        let url = `${SUPABASE_URL}/rest/v1/${state._table}?`;
        if (state._filters.length) url += state._filters.join("&");
        const res = await fetch(url, {
          method: "PATCH",
          headers: { ...supabase._headers(), Prefer: "return=representation" },
          body: JSON.stringify(vals),
        });
        const json = await res.json();
        return { data: res.ok ? json : null, error: res.ok ? null : json };
      },
    };

    return builder;
  },
};

/* ╔══════════════════════════════════════════════════════════════╗
   ║                    DATABASE HELPERS                           ║
   ╚══════════════════════════════════════════════════════════════╝ */

// LOGIN — find user by email + password in public.users
async function dbLogin(email, password) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("email", email.trim().toLowerCase())
    .eq("password", password)
    .single();
  if (error || !data) return { user: null, error: "Invalid email or password." };
  return { user: data, error: null };
}

// SIGNUP — check email not taken, then insert new user
async function dbSignup(email, password, fullName) {
  // Check if email already exists
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("email", email.trim().toLowerCase())
    .single();
  if (existing) return { user: null, error: "An account with this email already exists." };

  // Insert new user
  const { data, error } = await supabase.from("users").insert({
    email: email.trim().toLowerCase(),
    password: password,
    full_name: fullName.trim(),
    rating: 1200,
    streak: 0,
    last_solved_date: null,
    exam: "jee",
  });
  if (error || !data) return { user: null, error: "Signup failed. Please try again." };
  // data is an array, get first row
  const user = Array.isArray(data) ? data[0] : data;
  return { user, error: null };
}

// Get leaderboard — top 15 by rating
async function dbGetLeaderboard() {
  const { data } = await supabase
    .from("users")
    .select("id, email, full_name, rating, streak, exam")
    .order("rating", { ascending: false })
    .limit(15);
  return data || [];
}

// Get random question by subject
async function dbGetRandomQuestion(subject, exam = "jee") {
  const { data, error } = await supabase
    .from("questions")
    .select("*")
    .eq("subject", subject)
    .eq("exam", exam);
  if (error || !data?.length) return null;
  return data[Math.floor(Math.random() * data.length)];
}

// Save attempt
async function dbSaveAttempt({ userId, questionId, isCorrect }) {
  await supabase.from("attempts").insert({
    user_id: userId,
    question_id: questionId,
    is_correct: isCorrect,
  });
}

// Update user rating + streak after solving
async function dbUpdateUserStats(userId, newRating, newStreak, lastSolvedDate) {
  await supabase
    .from("users")
    .update({
      rating: newRating,
      streak: newStreak,
      last_solved_date: lastSolvedDate
    })
    .eq("id", userId);
}

/* ╔══════════════════════════════════════════════════════════════╗
   ║                    FALLBACK MOCK DATA                         ║
   ╚══════════════════════════════════════════════════════════════╝ */
const MOCK_QUESTIONS = {
  physics: [
    { id:"p1", subject:"physics", exam:"jee", question_text:"A ball projected at 30° with 20 m/s. Range? (g=10)", option_a:"20√3 m", option_b:"34.6 m", option_c:"40 m", option_d:"Both A & B", correct_option:"d", difficulty:"Medium", topic:"Projectile Motion", rating:1280 },
    { id:"p2", subject:"physics", exam:"jee", question_text:"3 kg and 5 kg blocks on frictionless pulley. Acceleration?", option_a:"2.5 m/s²", option_b:"3.27 m/s²", option_c:"4.9 m/s²", option_d:"1.96 m/s²", correct_option:"a", difficulty:"Hard", topic:"Newton's Laws", rating:1350 },
    { id:"p3", subject:"physics", exam:"jee", question_text:"Escape velocity from Earth's surface is approximately:", option_a:"7.9 km/s", option_b:"11.2 km/s", option_c:"15.0 km/s", option_d:"9.8 km/s", correct_option:"b", difficulty:"Easy", topic:"Gravitation", rating:1100 },
    { id:"p4", subject:"physics", exam:"jee", question_text:"4μF capacitor charged to 400V. Energy stored?", option_a:"0.32 J", option_b:"3.2 J", option_c:"0.16 J", option_d:"1.6 J", correct_option:"a", difficulty:"Medium", topic:"Electrostatics", rating:1220 },
    { id:"p5", subject:"physics", exam:"jee", question_text:"Which law states F = ma?", option_a:"Newton's First Law", option_b:"Newton's Second Law", option_c:"Newton's Third Law", option_d:"Law of Gravitation", correct_option:"b", difficulty:"Easy", topic:"Newton's Laws", rating:1000 },
  ],
  chemistry: [
    { id:"c1", subject:"chemistry", exam:"jee", question_text:"Which element has the highest electronegativity?", option_a:"Oxygen", option_b:"Nitrogen", option_c:"Fluorine", option_d:"Chlorine", correct_option:"c", difficulty:"Easy", topic:"Periodic Properties", rating:1050 },
    { id:"c2", subject:"chemistry", exam:"jee", question_text:"Hybridization of carbon in benzene is:", option_a:"sp³", option_b:"sp²", option_c:"sp", option_d:"sp³d", correct_option:"b", difficulty:"Medium", topic:"Chemical Bonding", rating:1200 },
    { id:"c3", subject:"chemistry", exam:"jee", question_text:"Which is an SN2 reaction?", option_a:"Tertiary + NaOH", option_b:"Primary alkyl halide + NaOH", option_c:"Tertiary + KCN", option_d:"Secondary + HBr", correct_option:"b", difficulty:"Hard", topic:"Organic Reactions", rating:1400 },
    { id:"c4", subject:"chemistry", exam:"jee", question_text:"pH of 0.001 M HCl solution is:", option_a:"3", option_b:"4", option_c:"2", option_d:"1", correct_option:"a", difficulty:"Easy", topic:"Ionic Equilibrium", rating:1080 },
  ],
  mathematics: [
    { id:"m1", subject:"mathematics", exam:"jee", question_text:"∫₀² (x² + 3x + 2)dx = ?", option_a:"34/3", option_b:"32/3", option_c:"12", option_d:"10", correct_option:"a", difficulty:"Hard", topic:"Integral Calculus", rating:1380 },
    { id:"m2", subject:"mathematics", exam:"jee", question_text:"lim(x→0) (sin 3x)/(5x) = ?", option_a:"3/5", option_b:"5/3", option_c:"1", option_d:"0", correct_option:"a", difficulty:"Medium", topic:"Limits", rating:1250 },
    { id:"m3", subject:"mathematics", exam:"jee", question_text:"Sum of infinite GP 1, 1/2, 1/4, ... is:", option_a:"1", option_b:"2", option_c:"3", option_d:"4", correct_option:"b", difficulty:"Easy", topic:"Series", rating:1080 },
    { id:"m4", subject:"mathematics", exam:"jee", question_text:"det([[1,2],[3,4]]) = ?", option_a:"-2", option_b:"2", option_c:"10", option_d:"-10", correct_option:"a", difficulty:"Easy", topic:"Matrices", rating:1100 },
  ],
};

const OPTION_KEYS = ["a","b","c","d"];

function normalizeQuestion(q) {
  if (!q) return null;
  const options = [q.option_a, q.option_b, q.option_c, q.option_d];
  const correctIndex = OPTION_KEYS.indexOf(q.correct_option?.toLowerCase?.());
  return {
    id: q.id,
    subject: q.subject,
    text: q.question_text || q.text,
    options,
    correct: correctIndex >= 0 ? correctIndex : 0,
    difficulty: q.difficulty,
    topic: q.topic,
    baseRating: q.rating || 1200,
  };
}

/* ── ELO ── */
function calcELO(playerRating, questionRating, correct, timeTaken) {
  const K = 32;
  const expected = 1 / (1 + Math.pow(10, (questionRating - playerRating) / 400));
  let delta = Math.round(K * ((correct ? 1 : 0) - expected));
  let speedBonus = 0;
  if (correct) {
    if (timeTaken < 20) speedBonus = 8;
    else if (timeTaken < 35) speedBonus = 5;
    else if (timeTaken < 55) speedBonus = 3;
  }
  delta = Math.max(delta, correct ? 1 : -25);
  return { delta, speedBonus, total: delta + speedBonus };
}

function getTier(r) {
  if (r >= 1800) return "Legend";
  if (r >= 1600) return "Master";
  if (r >= 1400) return "Grandmaster";
  if (r >= 1200) return "Expert";
  if (r >= 1000) return "Advanced";
  return "Beginner";
}

function todayStr() { return new Date().toISOString().slice(0,10); }

function calcStreak(currentStreak, lastSolvedDate) {
  const today = todayStr();
  if (!lastSolvedDate) return 1;
  if (lastSolvedDate === today) return currentStreak;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (lastSolvedDate === yesterday.toISOString().slice(0,10)) return currentStreak + 1;
  return 1;
}

/* ╔══════════════════════════════════════════════════════════════╗
   ║                         THEME                                 ║
   ╚══════════════════════════════════════════════════════════════╝ */
const T = {
  bg:"#060a06", sidebar:"#090d09", card:"#0d120d", cardBorder:"#162016",
  green:"#00ff41", glow:"rgba(0,255,65,0.1)",
  text:"#d8ecd8", muted:"#3d683d", dim:"#1e381e",
  red:"#ff4455", redBg:"rgba(255,68,85,0.07)",
  blue:"#44aaff", purple:"#aa55ff", gold:"#ffcc00",
};
const tierColors = { Legend:T.gold, Master:T.purple, Grandmaster:T.green, Expert:T.blue, Advanced:"#ff8844", Beginner:T.muted };
const diffColors = { Easy:T.green, Medium:T.gold, Hard:T.red };

/* ── UI PRIMITIVES ── */
function tag(color, text) {
  return <span style={{ display:"inline-block", padding:"2px 9px", borderRadius:4, fontSize:10, fontWeight:700, letterSpacing:1.2, background:`${color}18`, color, border:`1px solid ${color}33` }}>{text}</span>;
}
function ProgressBar({ pct, color=T.green, h=4 }) {
  return (
    <div style={{ height:h, background:T.cardBorder, borderRadius:h, overflow:"hidden" }}>
      <div style={{ width:`${Math.min(100,Math.max(0,pct))}%`, height:"100%", background:color, borderRadius:h, transition:"width 0.9s cubic-bezier(.4,0,.2,1)" }}/>
    </div>
  );
}
function Sparkline({ data, color=T.green, w=200, h=60 }) {
  if (!data || data.length < 2) return null;
  const max=Math.max(...data), min=Math.min(...data), range=max-min||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v-min)/range)*(h-10)-5}`).join(" ");
  const uid=color.replace("#","");
  return (
    <svg width={w} height={h} style={{ display:"block", overflow:"visible" }}>
      <defs>
        <linearGradient id={`sg${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#sg${uid})`}/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={(data.length-1)/(data.length-1)*w} cy={h-((data[data.length-1]-min)/range)*(h-10)-5} r="4" fill={color}/>
    </svg>
  );
}
function Card({ children, style={}, glow=false }) {
  return <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:12, padding:20, boxShadow:glow?`0 0 40px ${T.glow}`:"none", ...style }}>{children}</div>;
}
function Btn({ children, variant="primary", onClick, disabled, style={} }) {
  const variants = {
    primary:{ background:T.green, color:"#000" },
    outline:{ background:"transparent", color:T.green, border:`1px solid ${T.green}55` },
    danger:{ background:T.redBg, color:T.red, border:`1px solid ${T.red}44` },
    ghost:{ background:"transparent", color:T.muted, border:`1px solid ${T.dim}` },
  };
  return <button onClick={onClick} disabled={disabled} style={{ padding:"10px 20px", borderRadius:8, border:"none", cursor:disabled?"not-allowed":"pointer", fontFamily:"'Courier New',monospace", fontWeight:700, fontSize:12, letterSpacing:1.5, transition:"all 0.2s", opacity:disabled?0.4:1, textTransform:"uppercase", ...variants[variant], ...style }}>{children}</button>;
}
function Toast({ toasts }) {
  return (
    <div style={{ position:"fixed", top:16, right:16, zIndex:9999, display:"flex", flexDirection:"column", gap:8, pointerEvents:"none" }}>
      {toasts.map(t=>(
        <div key={t.id} style={{ padding:"10px 18px", borderRadius:8, fontSize:13, fontWeight:700, fontFamily:"'Courier New',monospace", background:t.type==="success"?`${T.green}18`:t.type==="error"?T.redBg:`${T.gold}18`, border:`1px solid ${t.type==="success"?T.green:t.type==="error"?T.red:T.gold}55`, color:t.type==="success"?T.green:t.type==="error"?T.red:T.gold, animation:"slideIn 0.3s ease" }}>{t.msg}</div>
      ))}
    </div>
  );
}

/* ╔══════════════════════════════════════════════════════════════╗
   ║                       AUTH PAGE                               ║
   ╚══════════════════════════════════════════════════════════════╝ */
function AuthPage({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name:"", email:"", password:"", confirm:"" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [focused, setFocused] = useState(null);

  const submit = async () => {
    setError("");
    if (!form.email.trim() || !form.password) return setError("Email and password are required.");

    if (mode === "signup") {
      if (!form.name.trim()) return setError("Full name is required.");
      if (form.password.length < 6) return setError("Password must be at least 6 characters.");
      if (form.password !== form.confirm) return setError("Passwords don't match.");
      setLoading(true);
      try {
        const { user, error: err } = await dbSignup(form.email, form.password, form.name);
        if (err) { setError(err); setLoading(false); return; }
        onLogin({
          userId: user.id,
          email: user.email,
          name: user.full_name || form.name.trim(),
          rating: user.rating || 1200,
          streak: user.streak || 0,
          lastSolvedDate: user.last_solved_date || null,
        });
      } catch (e) {
        setError("Connection error. Check your Supabase URL and key.");
      }
      setLoading(false);

    } else {
      setLoading(true);
      try {
        const { user, error: err } = await dbLogin(form.email, form.password);
        if (err) { setError(err); setLoading(false); return; }
        onLogin({
          userId: user.id,
          email: user.email,
          name: user.full_name || user.email.split("@")[0],
          rating: user.rating || 1200,
          streak: user.streak || 0,
          lastSolvedDate: user.last_solved_date || null,
        });
      } catch (e) {
        setError("Connection error. Check your Supabase URL and key.");
      }
      setLoading(false);
    }
  };

  const inp = (placeholder, key, type="text") => (
    <div style={{ position:"relative", marginBottom:14 }}>
      <input
        type={key==="password"||key==="confirm" ? (showPass?"text":"password") : type}
        placeholder={placeholder}
        value={form[key]}
        onChange={e => setForm(f=>({...f,[key]:e.target.value}))}
        onKeyDown={e => e.key==="Enter" && submit()}
        onFocus={() => setFocused(key)}
        onBlur={() => setFocused(null)}
        style={{ width:"100%", padding:"13px 16px", background:"#07090780", border:`1.5px solid ${focused===key?T.green:T.cardBorder}`, borderRadius:10, color:T.text, fontFamily:"'Courier New',monospace", fontSize:13, outline:"none", boxSizing:"border-box", transition:"border-color 0.2s, box-shadow 0.2s", boxShadow:focused===key?`0 0 0 3px ${T.green}15`:"none" }}
      />
      {(key==="password"||key==="confirm") && (
        <span onClick={()=>setShowPass(v=>!v)} style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", cursor:"pointer", fontSize:14, color:T.muted, userSelect:"none" }}>{showPass?"🙈":"👁"}</span>
      )}
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", fontFamily:"'Courier New',monospace", overflow:"hidden" }}>
      <style>{`
        @keyframes fadeUp { from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)} }
        @keyframes scanline { 0%{top:-2px}100%{top:100%} }
        @keyframes spin { to{transform:rotate(360deg)} }
      `}</style>

      {/* LEFT — branding */}
      <div style={{ flex:1, background:"linear-gradient(135deg,#060a06 0%,#0a180a 100%)", display:"flex", flexDirection:"column", justifyContent:"center", padding:"60px 70px", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", inset:0, opacity:0.04, backgroundImage:`linear-gradient(${T.green} 1px,transparent 1px),linear-gradient(90deg,${T.green} 1px,transparent 1px)`, backgroundSize:"32px 32px" }}/>
        <div style={{ position:"absolute", width:400, height:400, borderRadius:"50%", background:`radial-gradient(circle,${T.green}15 0%,transparent 70%)`, top:"5%", left:"-10%", pointerEvents:"none" }}/>
        <div style={{ position:"absolute", width:"100%", height:2, background:`linear-gradient(90deg,transparent,${T.green}30,transparent)`, animation:"scanline 7s linear infinite", pointerEvents:"none" }}/>

        <div style={{ position:"relative", zIndex:1 }}>
          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:56, animation:"fadeUp 0.5s ease both" }}>
            <div style={{ width:48, height:48, background:T.green, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, fontWeight:900, color:"#000" }}>R</div>
            <div>
              <div style={{ fontSize:20, fontWeight:900, color:"#fff", letterSpacing:2 }}>RANKUP</div>
              <div style={{ fontSize:10, color:T.muted, letterSpacing:3 }}>COMPETITIVE PREP</div>
            </div>
          </div>
          <div style={{ fontSize:42, fontWeight:900, lineHeight:1.15, color:"#fff", marginBottom:20, animation:"fadeUp 0.5s 0.1s ease both", opacity:0 }}>
            Climb the ranks.<br/>
            <span style={{ color:T.green }}>One question</span><br/>
            at a time.
          </div>
          <div style={{ fontSize:14, color:T.muted, lineHeight:1.8, maxWidth:360, marginBottom:48, animation:"fadeUp 0.5s 0.2s ease both", opacity:0 }}>
            JEE · NEET · GATE prep with an ELO rating system. Get ranked, track your progress, beat the leaderboard.
          </div>
          <div style={{ display:"flex", gap:32, animation:"fadeUp 0.5s 0.3s ease both", opacity:0 }}>
            {[["10K+","Questions"],["ELO","Rating System"],["Live","Leaderboard"]].map(([v,l])=>(
              <div key={l}>
                <div style={{ fontSize:18, fontWeight:900, color:T.green }}>{v}</div>
                <div style={{ fontSize:10, color:T.muted, letterSpacing:1.5, textTransform:"uppercase", marginTop:2 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT — form */}
      <div style={{ width:480, background:T.sidebar, borderLeft:`1px solid ${T.cardBorder}`, display:"flex", alignItems:"center", justifyContent:"center", padding:"48px 52px" }}>
        <div style={{ width:"100%", animation:"fadeUp 0.5s 0.1s ease both", opacity:0 }}>
          <div style={{ marginBottom:32 }}>
            <div style={{ fontSize:24, fontWeight:900, color:"#fff", marginBottom:6 }}>
              {mode==="login" ? "Welcome back" : "Create account"}
            </div>
            <div style={{ fontSize:13, color:T.muted }}>
              {mode==="login" ? "No account? " : "Already registered? "}
              <span onClick={()=>{setMode(mode==="login"?"signup":"login");setError("");}} style={{ color:T.green, cursor:"pointer", fontWeight:700, textDecoration:"underline" }}>
                {mode==="login" ? "Sign up free" : "Log in"}
              </span>
            </div>
          </div>

          {/* Mode toggle */}
          <div style={{ display:"flex", background:T.card, borderRadius:10, padding:4, marginBottom:28, border:`1px solid ${T.cardBorder}` }}>
            {["login","signup"].map(m=>(
              <button key={m} onClick={()=>{setMode(m);setError("");}} style={{ flex:1, padding:"9px 0", borderRadius:8, border:"none", cursor:"pointer", background:mode===m?T.green:"transparent", color:mode===m?"#000":T.muted, fontFamily:"'Courier New',monospace", fontWeight:700, fontSize:11, letterSpacing:2, textTransform:"uppercase", transition:"all 0.2s" }}>
                {m==="login" ? "Log In" : "Sign Up"}
              </button>
            ))}
          </div>

          {mode==="signup" && inp("Full Name","name")}
          {inp("Email Address","email","email")}
          {inp("Password","password","password")}
          {mode==="signup" && inp("Confirm Password","confirm","password")}

          {/* Password strength */}
          {mode==="signup" && form.password && (
            <div style={{ marginBottom:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                <span style={{ fontSize:10, color:T.muted }}>Password strength</span>
                <span style={{ fontSize:10, fontWeight:700, color:form.password.length>=10?T.green:form.password.length>=6?T.gold:T.red }}>
                  {form.password.length>=10?"Strong":form.password.length>=6?"Medium":"Weak"}
                </span>
              </div>
              <ProgressBar pct={Math.min(100,form.password.length*10)} color={form.password.length>=10?T.green:form.password.length>=6?T.gold:T.red} h={3}/>
            </div>
          )}

          {error && (
            <div style={{ padding:"10px 14px", background:T.redBg, border:`1px solid ${T.red}44`, borderRadius:8, color:T.red, fontSize:12, marginBottom:16, lineHeight:1.5 }}>
              ⚠ {error}
            </div>
          )}

          <button onClick={submit} disabled={loading} style={{ width:"100%", padding:"14px 0", background:loading?T.dim:T.green, color:loading?T.muted:"#000", border:"none", borderRadius:10, fontFamily:"'Courier New',monospace", fontWeight:900, fontSize:13, letterSpacing:2, cursor:loading?"not-allowed":"pointer", textTransform:"uppercase", transition:"all 0.2s", marginBottom:16 }}>
            {loading ? (
              <span style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                <span style={{ display:"inline-block", width:14, height:14, border:`2px solid transparent`, borderTop:`2px solid ${T.muted}`, borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
                {mode==="login" ? "Signing in..." : "Creating account..."}
              </span>
            ) : (mode==="login" ? "► Enter Platform" : "► Create Account")}
          </button>

          <div style={{ textAlign:"center", fontSize:10, color:T.dim, lineHeight:1.6 }}>
            Demo mode — passwords stored as plain text.<br/>
            Do not use real passwords.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ╔══════════════════════════════════════════════════════════════╗
   ║                     RESULT OVERLAY                            ║
   ╚══════════════════════════════════════════════════════════════╝ */
function ResultOverlay({ result, onNext, onStay }) {
  if (!result) return null;
  const { correct, delta, speedBonus, explanation } = result;
  const total = delta + (speedBonus||0);
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.9)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div style={{ width:490, animation:"popIn 0.35s cubic-bezier(.34,1.56,.64,1)" }}>
        <Card glow style={{ textAlign:"center" }}>
          <div style={{ fontSize:60, marginBottom:8 }}>{correct?"✅":"❌"}</div>
          <div style={{ fontSize:22, fontWeight:900, color:correct?T.green:T.red, marginBottom:6 }}>{correct?"Correct!":"Incorrect"}</div>
          <div style={{ fontSize:13, color:T.muted, marginBottom:24, lineHeight:1.65 }}>{explanation}</div>
          <div style={{ display:"flex", justifyContent:"center", gap:14, marginBottom:24, flexWrap:"wrap" }}>
            <div style={{ padding:"10px 18px", background:`${total>=0?T.green:T.red}12`, border:`1px solid ${total>=0?T.green:T.red}33`, borderRadius:8 }}>
              <div style={{ fontSize:10, color:T.muted, letterSpacing:1, marginBottom:4 }}>RATING</div>
              <div style={{ fontSize:22, fontWeight:900, color:total>=0?T.green:T.red }}>{total>=0?`+${total}`:total}</div>
            </div>
            {speedBonus>0&&(
              <div style={{ padding:"10px 18px", background:`${T.gold}12`, border:`1px solid ${T.gold}33`, borderRadius:8 }}>
                <div style={{ fontSize:10, color:T.muted, letterSpacing:1, marginBottom:4 }}>SPEED BONUS</div>
                <div style={{ fontSize:22, fontWeight:900, color:T.gold }}>+{speedBonus} ⚡</div>
              </div>
            )}
            {correct&&(
              <div style={{ padding:"10px 18px", background:`${T.green}12`, border:`1px solid ${T.green}33`, borderRadius:8 }}>
                <div style={{ fontSize:10, color:T.muted, letterSpacing:1, marginBottom:4 }}>STREAK</div>
                <div style={{ fontSize:22, fontWeight:900, color:T.green }}>+1 🔥</div>
              </div>
            )}
          </div>
          <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
            <Btn variant="outline" onClick={onStay}>Review Answer</Btn>
            <Btn onClick={onNext}>Next Question →</Btn>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ╔══════════════════════════════════════════════════════════════╗
   ║                       SOLVE PAGE                              ║
   ╚══════════════════════════════════════════════════════════════╝ */
function SolvePage({ user, onRatingChange, addToast, onAttempt }) {
  const [subject, setSubject] = useState("physics");
  const [question, setQuestion] = useState(null);
  const [questionKey, setQuestionKey] = useState(0); // forces re-animation on new question
  const [loading, setLoading] = useState(false);
  const [fadeIn, setFadeIn] = useState(false);
  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [showResult, setShowResult] = useState(false);
  const [timer, setTimer] = useState(90);
  const [timerActive, setTimerActive] = useState(false);
  const [startTime, setStartTime] = useState(null);

  // Refs to avoid stale closures
  const timerRef = useRef(null);
  const subjectRef = useRef(subject);
  const userRef = useRef(user);
  useEffect(() => { subjectRef.current = subject; }, [subject]);
  useEffect(() => { userRef.current = user; }, [user]);

  // Core: load a question for given subject, always uses ref to avoid stale closure
  const loadQuestion = useCallback(async (subj) => {
    const s = subj || subjectRef.current;

    // Stop timer immediately
    clearInterval(timerRef.current);

    // Fade out current question
    setFadeIn(false);

    // Short delay for fade-out, then load
    await new Promise(r => setTimeout(r, 150));

    setLoading(true);
    setSelected(null);
    setResult(null);
    setShowResult(false);
    setTimer(90);
    setTimerActive(false);

    try {
      let q = await dbGetRandomQuestion(s);
      if (!q) {
        const pool = MOCK_QUESTIONS[s] || MOCK_QUESTIONS.physics;
        q = pool[Math.floor(Math.random() * pool.length)];
      }
      setQuestion(normalizeQuestion(q));
      setQuestionKey(k => k + 1); // triggers re-animation
    } finally {
      setLoading(false);
      // Small delay then fade in
      setTimeout(() => setFadeIn(true), 50);
      // Start timer automatically after question loads
      setTimerActive(true);
      setStartTime(Date.now());
    }
  }, []);

  // Initial load
  useEffect(() => { loadQuestion("physics"); }, []);

  // Fade in on first load too
  useEffect(() => {
    if (!loading && question) setTimeout(() => setFadeIn(true), 50);
  }, [loading]);

  // Timer tick — restarts cleanly whenever timerActive flips to true
  useEffect(() => {
    clearInterval(timerRef.current);
    if (timerActive) {
      timerRef.current = setInterval(() => {
        setTimer(t => {
          if (t <= 1) { clearInterval(timerRef.current); return 0; }
          return t - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [timerActive]);

  const handleSubjectChange = (s) => {
    setSubject(s);
    subjectRef.current = s;
    loadQuestion(s);
  };

  const handleSelect = (i) => {
    if (!result) {
      setSelected(i);
      if (!timerActive) { setTimerActive(true); setStartTime(Date.now()); }
    }
  };

  const handleSubmit = async () => {
    if (selected === null || !question) return;
    setSubmitting(true);
    clearInterval(timerRef.current);
    setTimerActive(false);

    const u = userRef.current;
    const timeTaken = startTime ? Math.round((Date.now() - startTime) / 1000) : 90;
    const correct = selected === question.correct;
    const { delta, speedBonus, total } = calcELO(u.rating, question.baseRating, correct, timeTaken);
    const explanation = correct
      ? `✓ Correct! The answer is: ${question.options[question.correct]}`
      : `✗ Wrong! The correct answer was: ${question.options[question.correct]}`;

    const res = { correct, correctIndex: question.correct, delta, speedBonus, total, explanation };
    setResult(res);
    setShowResult(true);
    setSubmitting(false);

    // Update parent state immediately (don't await DB)
    onRatingChange(total, correct);
    onAttempt({
      questionId: question.id, questionText: question.text, subject: question.subject,
      topic: question.topic, difficulty: question.difficulty, selected, correct,
      ratingDelta: total, speedBonus, timeTaken, timestamp: Date.now(),
    });
    if (correct) addToast(`+${total} Rating${speedBonus > 0 ? ` ⚡ Speed +${speedBonus}` : ""}`, "success");
    else addToast(`${total} Rating`, "error");

    // Fire-and-forget DB writes — don't block UI
    const newRating = u.rating + total;
    const newStreak = correct ? calcStreak(u.streak, u.lastSolvedDate) : 0;
    const newDate = correct ? todayStr() : u.lastSolvedDate;
    Promise.all([
      dbSaveAttempt({ userId: u.userId, questionId: question.id, isCorrect: correct }),
      dbUpdateUserStats(u.userId, newRating, newStreak, newDate),
    ]).catch(() => {}); // silently ignore DB errors for demo
    // Update local user state to match DB
    setUser(prev => prev ? { ...prev, rating: newRating, streak: newStreak, lastSolvedDate: newDate } : prev);
  };

  const handleNext = () => {
    setShowResult(false);
    loadQuestion(subjectRef.current);
  };

  const timerPct = (timer / 90) * 100;
  const timerColor = timer > 45 ? T.green : timer > 20 ? T.gold : T.red;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <style>{`
        @keyframes questionFadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes optionSlideIn {
          from { opacity: 0; transform: translateX(-8px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      {showResult && <ResultOverlay result={result} onNext={handleNext} onStay={() => setShowResult(false)} />}

      {/* Subject tabs + skip */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
        <div style={{ display:"flex", gap:8 }}>
          {["physics","chemistry","mathematics"].map(s => (
            <button key={s} onClick={() => handleSubjectChange(s)} style={{ padding:"8px 14px", borderRadius:8, border:"none", cursor:"pointer", fontFamily:"'Courier New',monospace", fontWeight:700, fontSize:11, letterSpacing:1, textTransform:"capitalize", background:subject===s?T.green:T.card, color:subject===s?"#000":T.muted, outline:subject===s?"none":`1px solid ${T.cardBorder}`, transition:"all 0.2s" }}>{s}</button>
          ))}
        </div>
        <Btn variant="ghost" onClick={() => loadQuestion(subjectRef.current)} style={{ padding:"8px 14px" }}>↻ Skip</Btn>
      </div>

      {/* Loading state */}
      {loading && (
        <Card style={{ textAlign:"center", padding:60 }}>
          <div style={{ fontSize:13, color:T.muted, letterSpacing:2 }}>▌▌ LOADING QUESTION...</div>
        </Card>
      )}

      {/* Question — keyed so React fully remounts on each new question */}
      {!loading && question && (
        <div key={questionKey} style={{ opacity: fadeIn ? 1 : 0, transform: fadeIn ? "translateY(0)" : "translateY(10px)", transition: "opacity 0.25s ease, transform 0.25s ease" }}>

          {/* Tags */}
          <div style={{ display:"flex", gap:8, marginBottom:14, alignItems:"center", flexWrap:"wrap" }}>
            {tag(diffColors[question.difficulty] || T.green, question.difficulty)}
            {tag(T.blue, question.topic)}
            {tag(T.muted, `Q-ELO: ${question.baseRating}`)}
          </div>

          {/* Timer */}
          <Card style={{ marginBottom:14, padding:"14px 20px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:16 }}>
              <div style={{ fontSize:28, fontWeight:900, color:timerColor, minWidth:52, fontVariantNumeric:"tabular-nums" }}>
                {String(Math.floor(timer/60)).padStart(2,"0")}:{String(timer%60).padStart(2,"0")}
              </div>
              <div style={{ flex:1 }}><ProgressBar pct={timerPct} color={timerColor} h={6} /></div>
              {timerActive && <div style={{ fontSize:11, color:T.muted }}>⏱ Running</div>}
              {timer === 0 && !result && <div style={{ fontSize:11, color:T.red, fontWeight:700 }}>TIME'S UP!</div>}
            </div>
          </Card>

          {/* Question text */}
          <Card style={{ marginBottom:14 }}>
            <div style={{ fontSize:15, lineHeight:1.8, fontWeight:500, color:T.text }}>{question.text}</div>
          </Card>

          {/* Options — each staggered */}
          <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:20 }}>
            {question.options.map((opt, i) => {
              let bg = T.card, border = T.cardBorder, color = T.text;
              if (result) {
                if (i === result.correctIndex) { bg = `${T.green}12`; border = T.green; color = T.green; }
                else if (i === selected && !result.correct) { bg = T.redBg; border = T.red; color = T.red; }
                else { color = T.muted; }
              } else if (selected === i) { bg = T.glow; border = T.green; color = T.green; }
              return (
                <div
                  key={i}
                  onClick={() => handleSelect(i)}
                  style={{
                    padding:"14px 20px", background:bg, border:`1px solid ${border}`, borderRadius:10,
                    color, cursor:result?"default":"pointer", display:"flex", alignItems:"center", gap:14,
                    transition:"background 0.2s, border-color 0.2s, color 0.2s",
                    fontFamily:"'Courier New',monospace",
                    animation:`optionSlideIn 0.3s ${i * 0.07}s ease both`,
                  }}
                >
                  <div style={{ width:26, height:26, borderRadius:6, border:`1px solid ${border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:900, flexShrink:0, background:selected===i&&!result?T.green:"transparent", color:selected===i&&!result?"#000":color, transition:"all 0.2s" }}>
                    {["A","B","C","D"][i]}
                  </div>
                  <div style={{ fontSize:13, fontWeight:500 }}>{opt}</div>
                  {result && i === result.correctIndex && <div style={{ marginLeft:"auto", fontSize:18 }}>✓</div>}
                  {result && i === selected && !result.correct && <div style={{ marginLeft:"auto", fontSize:18 }}>✗</div>}
                </div>
              );
            })}
          </div>

          {/* Actions */}
          {!result ? (
            <Btn onClick={handleSubmit} disabled={selected === null || submitting} style={{ padding:"13px 32px" }}>
              {submitting ? "▌▌ Checking..." : "Submit Answer"}
            </Btn>
          ) : (
            <div style={{ display:"flex", gap:10 }}>
              <Btn onClick={handleNext}>Next Question →</Btn>
              <Btn variant="outline" onClick={() => setShowResult(true)}>View Result</Btn>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ╔══════════════════════════════════════════════════════════════╗
   ║                      LEADERBOARD PAGE                         ║
   ╚══════════════════════════════════════════════════════════════╝ */
function LeaderboardPage({ user, attempts }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    dbGetLeaderboard().then(rows=>{
      setEntries(rows.map((r,i)=>({
        rank:i+1, userId:r.id,
        name:r.full_name||r.email?.split("@")[0]||"Anonymous",
        rating:r.rating||1200, tier:getTier(r.rating||1200),
        streak:r.streak||0, avatar:(r.full_name||r.email||"A")[0].toUpperCase(),
      })));
      setLoading(false);
    });
  },[]);

  const tier = getTier(user.rating);
  // Merge current user in
  const all = [...entries.filter(e=>e.userId!==user.userId), {
    rank:99, userId:user.userId,
    name:user.name||"You", rating:user.rating, tier,
    streak:user.streak||0,
    delta:attempts.reduce((s,a)=>s+a.ratingDelta,0),
    avatar:(user.name||"Y")[0].toUpperCase(),
  }].sort((a,b)=>b.rating-a.rating).map((u,i)=>({...u,rank:i+1}));
  const myRank = all.find(u=>u.userId===user.userId)?.rank||"–";

  if (loading) return <Card style={{ textAlign:"center", padding:60 }}><div style={{ color:T.muted, letterSpacing:2 }}>▌▌ LOADING...</div></Card>;

  return (
    <div>
      <div style={{ fontSize:20, fontWeight:900, marginBottom:20 }}>Global Leaderboard</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:20 }}>
        {[
          {l:"Your Rank", v:`#${myRank}`, s:typeof myRank==="number"?`Top ${Math.round((myRank/all.length)*100)}% globally`:"Unranked"},
          {l:"Your Rating", v:user.rating, s:tier},
          {l:"Solved", v:attempts.length, s:"This session"},
        ].map(s=>(
          <Card key={s.l} style={{ textAlign:"center" }}>
            <div style={{ fontSize:9, color:T.muted, letterSpacing:1.5, textTransform:"uppercase" }}>{s.l}</div>
            <div style={{ fontSize:26, fontWeight:900, color:"#fff", marginTop:4 }}>{s.v}</div>
            <div style={{ fontSize:11, color:T.muted, marginTop:2 }}>{s.s}</div>
          </Card>
        ))}
      </div>
      <Card style={{ padding:0, overflow:"hidden" }}>
        <div style={{ display:"grid", gridTemplateColumns:"44px 1fr 80px 90px 70px 80px", gap:12, padding:"10px 16px", borderBottom:`1px solid ${T.cardBorder}` }}>
          {["#","Player","Rating","Tier","Streak","Session Δ"].map(h=><div key={h} style={{ fontSize:9, color:T.muted, letterSpacing:1.5, textTransform:"uppercase" }}>{h}</div>)}
        </div>
        {all.map((u,i)=>{
          const isMe = u.userId===user.userId;
          return (
            <div key={u.rank} style={{ display:"grid", gridTemplateColumns:"44px 1fr 80px 90px 70px 80px", gap:12, padding:"14px 16px", borderBottom:`1px solid ${T.cardBorder}`, alignItems:"center", background:isMe?`${T.green}08`:i%2===0?`${T.cardBorder}33`:"transparent" }}>
              <div style={{ fontWeight:900, fontSize:15, color:i<3?["#ffd700","#c0c0c0","#cd7f32"][i]:T.muted }}>{i<3?["🥇","🥈","🥉"][i]:u.rank}</div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ width:30, height:30, borderRadius:"50%", background:`${isMe?T.green:T.muted}20`, border:`1px solid ${isMe?T.green:T.dim}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:900, color:isMe?T.green:T.muted }}>{u.avatar}</div>
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:isMe?T.green:T.text }}>{u.name}{isMe&&" (You)"}</div>
                  <div style={{ fontSize:10, color:T.muted }}>{u.streak}d streak</div>
                </div>
              </div>
              <div style={{ fontSize:15, fontWeight:900, color:isMe?T.green:"#fff" }}>{u.rating}</div>
              {tag(tierColors[u.tier]||T.green, u.tier)}
              <div style={{ color:T.green, fontSize:13 }}>🔥 {u.streak}</div>
              <div style={{ fontWeight:900, color:(u.delta||0)>=0?T.green:T.red }}>{(u.delta||0)>=0?`+${u.delta||0}`:u.delta||0}</div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

/* ╔══════════════════════════════════════════════════════════════╗
   ║                     ATTEMPT HISTORY                           ║
   ╚══════════════════════════════════════════════════════════════╝ */
function AttemptHistory({ attempts }) {
  const [filter, setFilter] = useState("all");
  const filtered = filter==="all" ? attempts : attempts.filter(a=>a.subject===filter);
  const acc = attempts.length ? Math.round(attempts.filter(a=>a.correct).length/attempts.length*100) : 0;
  const net = attempts.reduce((s,a)=>s+a.ratingDelta,0);
  const avgTime = attempts.length ? Math.round(attempts.reduce((s,a)=>s+(a.timeTaken||45),0)/attempts.length) : 0;

  return (
    <div>
      <div style={{ fontSize:20, fontWeight:900, marginBottom:20 }}>Attempt History</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:20 }}>
        {[{l:"Total",v:attempts.length,c:T.green},{l:"Accuracy",v:`${acc}%`,c:T.blue},{l:"Net Rating",v:`${net>=0?"+":""}${net}`,c:net>=0?T.green:T.red},{l:"Avg Time",v:`${avgTime}s`,c:T.purple}].map(s=>(
          <Card key={s.l} style={{ textAlign:"center", padding:16 }}>
            <div style={{ fontSize:9, color:T.muted, letterSpacing:1.5, textTransform:"uppercase", marginBottom:6 }}>{s.l}</div>
            <div style={{ fontSize:22, fontWeight:900, color:s.c }}>{s.v}</div>
          </Card>
        ))}
      </div>
      <div style={{ display:"flex", gap:8, marginBottom:14 }}>
        {["all","physics","chemistry","mathematics"].map(f=>(
          <button key={f} onClick={()=>setFilter(f)} style={{ padding:"6px 14px", borderRadius:20, cursor:"pointer", fontFamily:"'Courier New',monospace", fontSize:11, fontWeight:700, letterSpacing:1, textTransform:"capitalize", background:filter===f?T.green:T.card, color:filter===f?"#000":T.muted, border:filter===f?"none":`1px solid ${T.cardBorder}`, transition:"all 0.2s" }}>{f}</button>
        ))}
      </div>
      {filtered.length===0 ? (
        <Card style={{ textAlign:"center", padding:60 }}><div style={{ fontSize:13, color:T.muted }}>No attempts yet. Go solve some questions!</div></Card>
      ) : (
        <Card style={{ padding:0, overflow:"hidden" }}>
          <div style={{ display:"grid", gridTemplateColumns:"36px 1fr 100px 80px 70px 60px 70px", gap:12, padding:"10px 16px", borderBottom:`1px solid ${T.cardBorder}` }}>
            {["","Question","Topic","Diff","Time","Rating","Speed"].map(h=><div key={h} style={{ fontSize:9, color:T.muted, letterSpacing:1.5, textTransform:"uppercase" }}>{h}</div>)}
          </div>
          {filtered.slice().reverse().map((a,i)=>(
            <div key={i} style={{ display:"grid", gridTemplateColumns:"36px 1fr 100px 80px 70px 60px 70px", gap:12, padding:"12px 16px", borderBottom:`1px solid ${T.cardBorder}`, alignItems:"center", background:i%2===0?`${T.cardBorder}33`:"transparent" }}>
              <div style={{ width:24, height:24, borderRadius:"50%", background:a.correct?`${T.green}20`:T.redBg, border:`1px solid ${a.correct?T.green:T.red}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, color:a.correct?T.green:T.red }}>{a.correct?"✓":"✗"}</div>
              <div style={{ fontSize:12, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.questionText}</div>
              <div style={{ fontSize:11, color:T.muted }}>{a.topic}</div>
              {tag(diffColors[a.difficulty]||T.green, a.difficulty)}
              <div style={{ fontSize:12, color:T.muted }}>{a.timeTaken||"—"}s</div>
              <div style={{ fontSize:13, fontWeight:700, color:a.ratingDelta>=0?T.green:T.red }}>{a.ratingDelta>=0?`+${a.ratingDelta}`:a.ratingDelta}</div>
              {a.speedBonus>0?tag(T.gold,`⚡+${a.speedBonus}`):<span style={{ color:T.dim, fontSize:11 }}>—</span>}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

/* ╔══════════════════════════════════════════════════════════════╗
   ║                        DASHBOARD                              ║
   ╚══════════════════════════════════════════════════════════════╝ */
function Dashboard({ user, attempts, ratingHistory }) {
  const history = ratingHistory.length>1 ? ratingHistory : [user.rating-50,user.rating-20,user.rating];
  const tier = getTier(user.rating);
  const tMin = {Beginner:0,Advanced:1000,Expert:1200,Grandmaster:1400,Master:1600,Legend:1800}[tier]||0;
  const tMax = {Beginner:1000,Advanced:1200,Expert:1400,Grandmaster:1600,Master:1800,Legend:2400}[tier]||2400;
  const tierPct = Math.min(100,((user.rating-tMin)/(tMax-tMin))*100);
  const days = ["MON","TUE","WED","THU","FRI","SAT","SUN"];
  const subjectAttempts = {
    physics:attempts.filter(a=>a.subject==="physics"),
    chemistry:attempts.filter(a=>a.subject==="chemistry"),
    mathematics:attempts.filter(a=>a.subject==="mathematics"),
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1.5fr", gap:16 }}>
        <Card>
          <div style={{ fontSize:9, letterSpacing:2, color:T.muted, textTransform:"uppercase", marginBottom:6 }}>Rating Overview</div>
          <div style={{ display:"flex", alignItems:"baseline", gap:10 }}>
            <div style={{ fontSize:38, fontWeight:900, color:"#fff", lineHeight:1 }}>{user.rating}</div>
            <div style={{ color:tierColors[tier]||T.green, fontSize:12, fontWeight:700 }}>{tier}</div>
          </div>
          <div style={{ marginTop:8, marginBottom:14 }}>
            <ProgressBar pct={tierPct} color={tierColors[tier]||T.green} h={5}/>
            <div style={{ fontSize:9, color:T.dim, marginTop:3 }}>{tMax!==2400?`${tMax-user.rating} pts to next tier`:"MAX TIER REACHED"}</div>
          </div>
          <Sparkline data={history} w={240} h={65}/>
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
            {days.map(d=><span key={d} style={{ fontSize:9, color:T.muted }}>{d}</span>)}
          </div>
        </Card>
        <div style={{ background:T.green, borderRadius:12, padding:24, color:"#000", position:"relative", overflow:"hidden" }}>
          <div style={{ position:"absolute", right:16, top:"50%", transform:"translateY(-50%)", opacity:0.12, fontSize:100, fontWeight:900 }}>R</div>
          <div style={{ fontSize:22, fontWeight:900, marginBottom:8, maxWidth:280 }}>Keep Your Streak Alive</div>
          <div style={{ fontSize:12, marginBottom:18, opacity:0.7, maxWidth:280 }}>Solve daily to maintain your streak and climb the leaderboard.</div>
          <div style={{ display:"flex", gap:24, marginBottom:20 }}>
            {[["STREAK",`${user.streak}d 🔥`],["SOLVED",`${attempts.length}`],["ACCURACY",`${attempts.length?Math.round(attempts.filter(a=>a.correct).length/attempts.length*100):0}%`]].map(([l,v])=>(
              <div key={l}><div style={{ fontSize:9, opacity:0.6, letterSpacing:1 }}>{l}</div><div style={{ fontWeight:700, fontSize:15 }}>{v}</div></div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <div style={{ fontWeight:700, fontSize:16, marginBottom:14 }}>Subject Performance</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14 }}>
          {[{name:"Physics",icon:"⚡",color:T.blue,key:"physics"},{name:"Chemistry",icon:"⚗",color:"#00ddaa",key:"chemistry"},{name:"Mathematics",icon:"∑",color:T.purple,key:"mathematics"}].map(s=>{
            const sa=subjectAttempts[s.key]||[];
            const acc=sa.length?Math.round(sa.filter(a=>a.correct).length/sa.length*100):0;
            const net=sa.reduce((x,a)=>x+a.ratingDelta,0);
            return (
              <Card key={s.name}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div style={{ width:36, height:36, borderRadius:8, background:`${s.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>{s.icon}</div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:9, color:T.muted, letterSpacing:1.5, textTransform:"uppercase" }}>Net</div>
                    <div style={{ fontSize:18, fontWeight:900, color:net>=0?T.green:T.red }}>{net>=0?`+${net}`:net}</div>
                  </div>
                </div>
                <div style={{ fontWeight:700, fontSize:15, marginTop:10, marginBottom:8 }}>{s.name}</div>
                <ProgressBar pct={acc} color={s.color}/>
                <div style={{ fontSize:10, color:T.muted, marginTop:4 }}>{acc}% accuracy · {sa.length} attempts</div>
              </Card>
            );
          })}
        </div>
      </div>

      {attempts.length>0&&(
        <Card>
          <div style={{ fontWeight:700, fontSize:15, marginBottom:14 }}>Recent Activity</div>
          {attempts.slice(-5).reverse().map((a,i)=>(
            <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:i<4?`1px solid ${T.cardBorder}`:"none" }}>
              <div style={{ width:26, height:26, borderRadius:"50%", background:a.correct?`${T.green}20`:T.redBg, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, color:a.correct?T.green:T.red, flexShrink:0 }}>{a.correct?"✓":"✗"}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:12, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.questionText}</div>
                <div style={{ fontSize:10, color:T.muted, marginTop:2, textTransform:"uppercase", letterSpacing:1 }}>{a.subject} · {a.topic}</div>
              </div>
              <div style={{ fontWeight:900, fontSize:14, color:a.ratingDelta>=0?T.green:T.red }}>{a.ratingDelta>=0?`+${a.ratingDelta}`:a.ratingDelta}</div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

/* ╔══════════════════════════════════════════════════════════════╗
   ║                       PROGRESS PAGE                           ║
   ╚══════════════════════════════════════════════════════════════╝ */
function ProgressPage({ attempts, user }) {
  const correct = attempts.filter(a=>a.correct).length;
  const acc = attempts.length?Math.round(correct/attempts.length*100):0;
  const milestones=[
    {name:"Beginner",min:0,max:1000},{name:"Advanced",min:1000,max:1200},
    {name:"Expert",min:1200,max:1400},{name:"Grandmaster",min:1400,max:1600},
    {name:"Master",min:1600,max:1800},{name:"Legend",min:1800,max:2400},
  ];
  const subjectMap={physics:[],chemistry:[],mathematics:[]};
  attempts.forEach(a=>{ if(subjectMap[a.subject]) subjectMap[a.subject].push(a); });

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      <div style={{ fontSize:20, fontWeight:900 }}>Progress Tracker</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14 }}>
        {[{l:"Solved",v:attempts.length,c:T.green},{l:"Correct",v:correct,c:T.blue},{l:"Accuracy",v:`${acc}%`,c:T.gold},{l:"Speed Bonuses",v:attempts.reduce((s,a)=>s+(a.speedBonus||0),0),c:T.purple}].map(s=>(
          <Card key={s.l} style={{ textAlign:"center" }}>
            <div style={{ fontSize:9, color:T.muted, letterSpacing:1.5, textTransform:"uppercase" }}>{s.l}</div>
            <div style={{ fontSize:22, fontWeight:900, color:s.c, marginTop:4 }}>{s.v}</div>
          </Card>
        ))}
      </div>
      <Card>
        <div style={{ fontWeight:700, fontSize:15, marginBottom:16 }}>Subject Breakdown</div>
        {Object.entries(subjectMap).map(([subj,arr])=>{
          const a=arr.filter(x=>x.correct).length;
          const pct=arr.length?Math.round(a/arr.length*100):0;
          const icons={physics:"⚡",chemistry:"⚗",mathematics:"∑"};
          const colors={physics:T.blue,chemistry:"#00ddaa",mathematics:T.purple};
          return (
            <div key={subj} style={{ marginBottom:16 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                <div style={{ fontSize:13, fontWeight:600 }}>{icons[subj]} {subj.charAt(0).toUpperCase()+subj.slice(1)}</div>
                <div style={{ fontSize:12, color:T.muted }}>{a}/{arr.length} correct · {pct}%</div>
              </div>
              <ProgressBar pct={pct} color={colors[subj]} h={8}/>
            </div>
          );
        })}
      </Card>
      <Card>
        <div style={{ fontWeight:700, fontSize:15, marginBottom:14 }}>Rating Milestones</div>
        {milestones.map((m,i)=>{
          const done=user.rating>=m.max;
          const current=user.rating>=m.min&&user.rating<m.max;
          const pct=current?Math.round(((user.rating-m.min)/(m.max-m.min))*100):done?100:0;
          return (
            <div key={i} style={{ padding:"12px 0", borderBottom:i<milestones.length-1?`1px solid ${T.cardBorder}`:"none" }}>
              <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:current?8:0 }}>
                <div style={{ width:24, height:24, borderRadius:"50%", border:`2px solid ${done?T.green:current?T.gold:T.cardBorder}`, background:done?T.green:"transparent", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, color:done?"#000":current?T.gold:T.muted, flexShrink:0 }}>{done?"✓":current?"◉":"○"}</div>
                <div style={{ flex:1, fontSize:13, color:done?T.text:current?T.gold:T.muted, fontWeight:current?700:400 }}>
                  {m.name} ({m.min}–{m.max}){current&&<span style={{ fontSize:10, color:T.green, marginLeft:8 }}>← You are here</span>}
                </div>
                {current&&<div style={{ fontSize:11, color:T.gold }}>{pct}%</div>}
              </div>
              {current&&<div style={{ paddingLeft:36 }}><ProgressBar pct={pct} color={T.gold} h={4}/></div>}
            </div>
          );
        })}
      </Card>
    </div>
  );
}

/* ╔══════════════════════════════════════════════════════════════╗
   ║                          BADGES                               ║
   ╚══════════════════════════════════════════════════════════════╝ */
const BADGE_DEFS = [
  {id:"first",icon:"⚡",name:"First Blood",desc:"Answer your first question",cond:a=>a.length>=1},
  {id:"streak3",icon:"🔥",name:"On Fire",desc:"3 correct in a row",cond:a=>{let c=0,m=0;a.forEach(x=>{if(x.correct){c++;m=Math.max(m,c);}else c=0;});return m>=3;}},
  {id:"streak5",icon:"💥",name:"Unstoppable",desc:"5 correct in a row",cond:a=>{let c=0,m=0;a.forEach(x=>{if(x.correct){c++;m=Math.max(m,c);}else c=0;});return m>=5;}},
  {id:"speed",icon:"💨",name:"Speedster",desc:"Earn a speed bonus",cond:a=>a.some(x=>(x.speedBonus||0)>0)},
  {id:"ten",icon:"🎯",name:"Sharp Shooter",desc:"Solve 10 questions",cond:a=>a.length>=10},
  {id:"acc",icon:"🏅",name:"Precision",desc:"80%+ accuracy (min 5)",cond:a=>a.length>=5&&a.filter(x=>x.correct).length/a.length>=0.8},
  {id:"multi",icon:"🌐",name:"All-Rounder",desc:"Attempt all 3 subjects",cond:a=>new Set(a.map(x=>x.subject)).size>=3},
  {id:"hard",icon:"💎",name:"Hard Mode",desc:"Solve a Hard question correctly",cond:a=>a.some(x=>x.difficulty==="Hard"&&x.correct)},
  {id:"25",icon:"🏆",name:"Grinder",desc:"Solve 25 questions",cond:a=>a.length>=25},
];
function BadgesPage({ attempts }) {
  const earned = BADGE_DEFS.filter(b=>b.cond(attempts));
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
        <div style={{ fontSize:20, fontWeight:900 }}>Badges & Achievements</div>
        <div style={{ fontSize:13, color:T.muted }}>{earned.length}/{BADGE_DEFS.length} Earned</div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14 }}>
        {BADGE_DEFS.map(b=>{
          const e=b.cond(attempts);
          return (
            <Card key={b.id} style={{ textAlign:"center", padding:24, opacity:e?1:0.4, border:e?`1px solid ${T.green}44`:`1px solid ${T.cardBorder}`, background:e?`${T.green}06`:T.card }}>
              <div style={{ fontSize:40, marginBottom:10 }}>{b.icon}</div>
              <div style={{ fontWeight:900, fontSize:14, marginBottom:4 }}>{b.name}</div>
              <div style={{ fontSize:11, color:T.muted, lineHeight:1.5 }}>{b.desc}</div>
              <div style={{ marginTop:10, fontSize:11, color:e?T.green:T.dim, fontWeight:700, letterSpacing:1 }}>{e?"EARNED ✓":"LOCKED"}</div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ╔══════════════════════════════════════════════════════════════╗
   ║                         ROOT APP                              ║
   ╚══════════════════════════════════════════════════════════════╝ */
export default function App() {
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("Dashboard");
  const [attempts, setAttempts] = useState([]);
  const [ratingHistory, setRatingHistory] = useState([1200]);
  const [toasts, setToasts] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);

  const addToast = (msg, type="success") => {
    const id = Date.now();
    setToasts(t=>[...t,{id,msg,type}]);
    setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)),3000);
  };

  const handleLogin = (userData) => {
    setUser(userData);
    setRatingHistory([userData.rating||1200]);
    setAttempts([]);
    setAuthed(true);
  };

  const handleRatingChange = (delta, correct) => {
    setUser(u => {
      const newRating = u.rating + delta;
      const newStreak = correct ? calcStreak(u.streak, u.lastSolvedDate) : u.streak;
      const newDate = correct ? todayStr() : u.lastSolvedDate;
      setRatingHistory(h => [...h.slice(-29), newRating]);
      return { ...u, rating: newRating, streak: newStreak, lastSolvedDate: newDate };
    });
  };

  const handleAttempt = (attempt) => setAttempts(a=>[...a,attempt]);

  const handleLogout = () => {
    setAuthed(false); setUser(null);
    setPage("Dashboard"); setAttempts([]);
    setRatingHistory([1200]);
  };

  const nav = [
    {id:"Dashboard",icon:"⊞"},{id:"Solve",icon:"⊙"},{id:"Leaderboard",icon:"▦"},
    {id:"History",icon:"◫"},{id:"Progress",icon:"▲"},{id:"Badges",icon:"✦"},{id:"Profile",icon:"◯"},
  ];

  const earnedBadges = BADGE_DEFS.filter(b=>b.cond(attempts)).length;
  const tier = getTier(user?.rating||1200);

  const renderPage = () => {
    if (!user) return null;
    switch(page) {
      case "Dashboard":   return <Dashboard user={user} attempts={attempts} ratingHistory={ratingHistory}/>;
      case "Solve":       return <SolvePage user={user} onRatingChange={handleRatingChange} addToast={addToast} onAttempt={handleAttempt}/>;
      case "Leaderboard": return <LeaderboardPage user={user} attempts={attempts}/>;
      case "History":     return <AttemptHistory attempts={attempts}/>;
      case "Progress":    return <ProgressPage attempts={attempts} user={user}/>;
      case "Badges":      return <BadgesPage attempts={attempts}/>;
      case "Profile":     return (
        <div style={{ maxWidth:580, margin:"0 auto" }}>
          <div style={{ fontSize:20, fontWeight:900, marginBottom:20 }}>Profile</div>
          <Card style={{ textAlign:"center", marginBottom:16 }}>
            <div style={{ width:64, height:64, borderRadius:"50%", background:`${T.green}20`, border:`3px solid ${T.green}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, fontWeight:900, color:T.green, margin:"0 auto 12px" }}>
              {(user.name||"U")[0].toUpperCase()}
            </div>
            <div style={{ fontSize:20, fontWeight:900 }}>{user.name}</div>
            <div style={{ color:T.muted, fontSize:12, marginTop:4 }}>{user.email}</div>
            <div style={{ marginTop:10, display:"flex", gap:8, justifyContent:"center" }}>
              {tag(tierColors[tier]||T.green, tier.toUpperCase())}
              {tag(T.blue, `${user.rating} ELO`)}
            </div>
          </Card>
          <Card style={{ marginBottom:16 }}>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:14 }}>Stats</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
              {[
                ["Rating",user.rating],["Streak",`${user.streak}d 🔥`],
                ["Solved This Session",attempts.length],
                ["Accuracy",attempts.length?`${Math.round(attempts.filter(a=>a.correct).length/attempts.length*100)}%`:"—"],
                ["Badges Earned",`${earnedBadges}/${BADGE_DEFS.length}`],["Tier",tier],
              ].map(([l,v])=>(
                <div key={l} style={{ padding:"12px 0", borderBottom:`1px solid ${T.cardBorder}` }}>
                  <div style={{ fontSize:9, color:T.muted, letterSpacing:1.5, textTransform:"uppercase" }}>{l}</div>
                  <div style={{ fontSize:16, fontWeight:700, marginTop:4 }}>{v}</div>
                </div>
              ))}
            </div>
          </Card>
          <button onClick={handleLogout} style={{ width:"100%", padding:14, background:T.redBg, border:`1px solid ${T.red}33`, borderRadius:8, color:T.red, fontFamily:"'Courier New',monospace", fontWeight:700, fontSize:12, cursor:"pointer", letterSpacing:1.5 }}>⏻ LOG OUT</button>
        </div>
      );
      default: return null;
    }
  };

  if (!authed) return <AuthPage onLogin={handleLogin}/>;

  return (
    <div style={{ display:"flex", height:"100vh", background:T.bg, fontFamily:"'Courier New',monospace", color:T.text, overflow:"hidden" }}>
      <style>{`
        @keyframes popIn{from{transform:scale(0.85);opacity:0}to{transform:scale(1);opacity:1}}
        @keyframes slideIn{from{transform:translateX(40px);opacity:0}to{transform:translateX(0);opacity:1}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${T.dim};border-radius:2px}
        button:not(:disabled):hover{filter:brightness(1.12)}
      `}</style>
      <Toast toasts={toasts}/>
      <div style={{ position:"fixed", inset:0, opacity:0.025, backgroundImage:`linear-gradient(${T.green} 1px,transparent 1px),linear-gradient(90deg,${T.green} 1px,transparent 1px)`, backgroundSize:"40px 40px", pointerEvents:"none", zIndex:0 }}/>

      {/* SIDEBAR */}
      <div style={{ width:210, background:T.sidebar, borderRight:`1px solid ${T.cardBorder}`, display:"flex", flexDirection:"column", padding:"20px 0", position:"relative", zIndex:2, flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"0 18px 22px", borderBottom:`1px solid ${T.cardBorder}`, marginBottom:14 }}>
          <div style={{ width:34, height:34, background:T.green, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, color:"#000", fontSize:16, flexShrink:0 }}>R</div>
          <div>
            <div style={{ fontWeight:700, fontSize:13, color:"#fff" }}>RankUp</div>
            <div style={{ fontSize:10, color:T.muted }}>JEE/NEET/GATE</div>
          </div>
        </div>
        {nav.map(n=>{
          const active=page===n.id;
          return (
            <div key={n.id} onClick={()=>setPage(n.id)} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 18px", cursor:"pointer", borderRadius:"0 10px 10px 0", marginRight:10, marginBottom:2, background:active?T.glow:"transparent", borderLeft:`3px solid ${active?T.green:"transparent"}`, color:active?T.green:T.muted, fontSize:13, fontWeight:active?700:400, transition:"all 0.15s" }}>
              <span style={{ fontSize:14 }}>{n.icon}</span>
              <span>{n.id}</span>
              {n.id==="Badges"&&earnedBadges>0&&<span style={{ marginLeft:"auto", background:T.green, color:"#000", borderRadius:10, padding:"1px 7px", fontSize:10, fontWeight:900 }}>{earnedBadges}</span>}
            </div>
          );
        })}
        <div style={{ margin:"auto 14px 0", background:`${T.green}08`, border:`1px solid ${T.green}22`, borderRadius:10, padding:"12px 14px", textAlign:"center" }}>
          <div style={{ fontSize:9, fontWeight:900, color:tierColors[tier]||T.green, letterSpacing:1.5, textTransform:"uppercase" }}>{tier}</div>
          <div style={{ fontSize:20, fontWeight:900, color:"#fff", marginTop:2 }}>{user?.rating}</div>
          <div style={{ fontSize:9, color:T.muted, marginTop:2 }}>🔥 {user?.streak} day streak</div>
        </div>
      </div>

      {/* MAIN */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", position:"relative", zIndex:1 }}>
        <div style={{ height:58, background:T.sidebar, borderBottom:`1px solid ${T.cardBorder}`, display:"flex", alignItems:"center", padding:"0 24px", gap:20, flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div>
              <div style={{ fontSize:9, color:T.muted, letterSpacing:1.5, textTransform:"uppercase" }}>Rating</div>
              <div style={{ fontSize:18, fontWeight:900, color:"#fff" }}>{user?.rating}</div>
            </div>
            <div style={{ width:60, height:5, background:T.cardBorder, borderRadius:3, overflow:"hidden" }}>
              <div style={{ width:`${Math.min(100,Math.max(0,((user?.rating-1200)/600)*100))}%`, height:"100%", background:T.green, borderRadius:3, transition:"width 0.5s ease" }}/>
            </div>
          </div>
          <div style={{ width:1, height:28, background:T.cardBorder }}/>
          <div style={{ color:T.green, fontWeight:700, fontSize:13 }}>🔥 {user?.streak} Day Streak</div>
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:14 }}>
            <div onClick={()=>setNotifOpen(o=>!o)} style={{ position:"relative", cursor:"pointer" }}>
              <div style={{ width:32, height:32, borderRadius:"50%", border:`1px solid ${T.cardBorder}`, display:"flex", alignItems:"center", justifyContent:"center", color:T.muted, fontSize:14 }}>🔔</div>
              {attempts.length>0&&<div style={{ position:"absolute", top:-2, right:-2, width:8, height:8, borderRadius:"50%", background:T.red }}/>}
              {notifOpen&&(
                <div style={{ position:"absolute", top:40, right:0, width:280, background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:10, padding:14, zIndex:100 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:T.muted, marginBottom:10, letterSpacing:1 }}>RECENT ATTEMPTS</div>
                  {attempts.length===0 ? <div style={{ fontSize:12, color:T.dim }}>None yet.</div> :
                    attempts.slice(-4).reverse().map((a,i)=>(
                      <div key={i} style={{ padding:"8px 0", borderBottom:i<3?`1px solid ${T.cardBorder}`:"none", fontSize:12 }}>
                        <span style={{ color:a.correct?T.green:T.red }}>{a.correct?"✓":"✗"}</span>{" "}
                        {a.questionText?.slice(0,36)}...{" "}
                        <span style={{ color:a.ratingDelta>=0?T.green:T.red, fontWeight:700 }}>{a.ratingDelta>=0?`+${a.ratingDelta}`:a.ratingDelta}</span>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
            <div onClick={()=>setPage("Profile")} style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:12, fontWeight:700 }}>{user?.name}</div>
                <div style={{ fontSize:9, color:tierColors[tier]||T.green, letterSpacing:1.5 }}>{tier.toUpperCase()}</div>
              </div>
              <div style={{ width:34, height:34, borderRadius:"50%", background:`${T.green}20`, border:`2px solid ${T.green}`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, color:T.green, fontSize:13 }}>
                {(user?.name||"U")[0].toUpperCase()}
              </div>
            </div>
          </div>
        </div>
        <div style={{ flex:1, overflow:"auto", padding:24 }} onClick={()=>notifOpen&&setNotifOpen(false)}>
          {renderPage()}
        </div>
      </div>
    </div>
  );
}
