import { useState, useEffect, useRef } from "react";

// ─── Hunt schedule ─────────────────────────────────────────────────────────
const HUNT_START = new Date("2026-03-06T08:00:00");
const HUNT_END   = new Date("2026-03-13T10:00:00");
const REVEAL_DATES = {
  1:"2026-03-06T08:00:00", 2:"2026-03-07T08:00:00", 3:"2026-03-08T08:00:00",
  4:"2026-03-09T08:00:00", 5:"2026-03-10T08:00:00", 6:"2026-03-11T08:00:00",
  7:"2026-03-12T08:00:00",
};
const DEFAULT_CLUES = [
  { id:1,day:"Friday",   date:"Mar 6", tier:"free",text:"The treasure rests in a Texas town that still remembers its roots — where old meets charming and locals know every face." },
  { id:2,day:"Saturday", date:"Mar 7", tier:"free",text:"Venture to the heart of the old town. The kind of place with covered porches and ghost signs on wood." },
  { id:3,day:"Sunday",   date:"Mar 8", tier:"free",text:"Seek the street named for a tree that stands tall in every forest. The treasure is near." },
  { id:4,day:"Monday",   date:"Mar 9", tier:"free",text:"A mercantile spirit lingers here — the smell of burlap, ranch dust, and history. You’re close to something special." },
  { id:5,day:"Tuesday",  date:"Mar 10",tier:"pro", text:"The Burlap Ranch keeps its secrets well. Face the street and look to the earth between the road and the drive." },
  { id:6,day:"Wednesday",date:"Mar 11",tier:"pro", text:"Four stones stand in a row like sentinels. The first one guards the prize — lift it gently, pirate." },
  { id:7,day:"Thursday", date:"Mar 12",tier:"pro", text:"Where the stones meet the grass at the edge of the old mercantile driveway — the first sentinel holds your fortune.",isPhoto:true,photoUrl:null },
];
const DEFAULT_HUNT = { weekOf:"March 6–13, 2026", prize:"$20 Cash", clues:DEFAULT_CLUES };

// ─── Active hunts across cities ────────────────────────────────────────────
const ACTIVE_HUNTS = [
  {
    id:"tomball-1",
    city:"Tomball, TX",
    area:"Downtown Tomball",
    prize:"$20 Cash",
    weekOf:"March 6–13, 2026",
    status:"active",
    cluesRevealed:2,
    totalClues:7,
    endsAt:HUNT_END,
    startsAt:HUNT_START,
    pirate:"CaptainTex",
    difficulty:"Medium",
    clues:DEFAULT_CLUES,
  },
  {
    id:"houston-1",
    city:"Houston, TX",
    area:"Heights District",
    prize:"$50 Cash",
    weekOf:"March 6–13, 2026",
    status:"active",
    cluesRevealed:2,
    totalClues:7,
    endsAt:HUNT_END,
    startsAt:HUNT_START,
    pirate:"BayouBandit",
    difficulty:"Hard",
    clues:DEFAULT_CLUES,
  },
  {
    id:"austin-1",
    city:"Austin, TX",
    area:"South Congress",
    prize:"$30 Cash",
    weekOf:"March 6–13, 2026",
    status:"active",
    cluesRevealed:2,
    totalClues:7,
    endsAt:HUNT_END,
    startsAt:HUNT_START,
    pirate:"KeepAustinHidden",
    difficulty:"Easy",
    clues:DEFAULT_CLUES,
  },
  {
    id:"dallas-1",
    city:"Dallas, TX",
    area:"Deep Ellum",
    prize:"$40 Cash",
    weekOf:"March 6–13, 2026",
    status:"active",
    cluesRevealed:2,
    totalClues:7,
    endsAt:HUNT_END,
    startsAt:HUNT_START,
    pirate:"LoneStarLoot",
    difficulty:"Medium",
    clues:DEFAULT_CLUES,
  },
  {
    id:"sanantonio-1",
    city:"San Antonio, TX",
    area:"Pearl District",
    prize:"$25 Cash",
    weekOf:"March 6–13, 2026",
    status:"active",
    cluesRevealed:2,
    totalClues:7,
    endsAt:HUNT_END,
    startsAt:HUNT_START,
    pirate:"AlamoPirate",
    difficulty:"Easy",
    clues:DEFAULT_CLUES,
  },
];
const LEADERBOARD = [
  {rank:1,name:"ShadowFox_88",  finds:4,streak:"🔥 3 weeks"},
  {rank:2,name:"MargaretK",     finds:3,streak:"🔥 2 weeks"},
  {rank:3,name:"TreasureTrail99",finds:2,streak:""},
  {rank:4,name:"UrbanSeeker",   finds:1,streak:""},
  {rank:5,name:"Downtown_D",    finds:1,streak:""},
];
const US_CITIES = ["New York, NY","Los Angeles, CA","Chicago, IL","Houston, TX","Phoenix, AZ","Philadelphia, PA","San Antonio, TX","San Diego, CA","Dallas, TX","Austin, TX","Jacksonville, FL","Fort Worth, TX","Columbus, OH","Charlotte, NC","Indianapolis, IN","San Francisco, CA","Seattle, WA","Denver, CO","Nashville, TN","Oklahoma City, OK","Portland, OR","Las Vegas, NV","Memphis, TN","Louisville, KY","Baltimore, MD","Milwaukee, WI","Albuquerque, NM","Tucson, AZ","Fresno, CA","Sacramento, CA","Atlanta, GA","Boston, MA","Miami, FL","Minneapolis, MN","New Orleans, LA","Tampa, FL","Arlington, TX","Bakersfield, CA","Honolulu, HI","Anaheim, CA"];

// ─── Helpers ───────────────────────────────────────────────────────────────
const isRevealed = (id, now) => now >= new Date(REVEAL_DATES[id]);
const isNew = (id, now) => { const r=new Date(REVEAL_DATES[id]); return now>=r && (now-r)<7200000; };
function nextReveal(now) {
  return Object.values(REVEAL_DATES).map(d=>new Date(d)).filter(d=>d>now).sort((a,b)=>a-b)[0]||null;
}
function fmtHMS(ms) {
  if(ms<=0)return"00:00:00";
  return[Math.floor(ms/3600000),Math.floor((ms%3600000)/60000),Math.floor((ms%60000)/1000)].map(n=>String(n).padStart(2,"0")).join(":");
}
function fmtDHMS(ms) {
  if(ms<=0)return"HUNT OVER";
  const d=Math.floor(ms/86400000),h=Math.floor((ms%86400000)/3600000),m=Math.floor((ms%3600000)/60000),s=Math.floor((ms%60000)/1000);
  return`${d}d  ${h}h  ${m}m  ${s}s`;
}
function initials(name) {
  if(!name)return"?";
  return name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
}
function avatarColor(name) {
  const colors=["#c8860a","#4caf50","#5b8dee","#e05599","#aa55e0","#e07733"];
  let h=0; for(let c of(name||"")) h=(h*31+c.charCodeAt(0))%colors.length;
  return colors[h];
}

// ─── Themes ────────────────────────────────────────────────────────────────
const T = {
  dark:{
    bg:"#080604",bgCard:"linear-gradient(135deg,#12090a,#1e1008)",bgLocked:"linear-gradient(135deg,#0e0e0e,#181818)",bgFuture:"linear-gradient(135deg,#0a0a0a,#141414)",
    headerBg:"rgba(10,8,3,0.96)",headerBorder:"#1a1200",
    prizeBg:"linear-gradient(135deg,#0f0a02,#1a1000)",prizeBorder:"#2a1800",
    timerBg:"linear-gradient(135deg,#1a0a00,#2d1200)",
    nextBg:"linear-gradient(135deg,#0a0a14,#0f0f20)",nextBorder:"#2a2a60",
    mapBg:"linear-gradient(135deg,#0a0f0a,#0f1a0f)",mapBorder:"#2a5a2a",mapInner:"#1a3a1a",
    panelBg:"#0c0c0a",panelBorder:"#2a1800",
    inputBg:"#111",inputBorder:"#2a2a22",inputFocus:"#c8860a",
    surfaceBg:"#0d0d0b",surfaceBorder:"#1a1a14",
    modalBg:"linear-gradient(180deg,#1a1000,#0f0a02)",
    upgradeBg:"linear-gradient(135deg,#1a1000,#2a1800)",
    authBg:"#0a0804",authCard:"linear-gradient(180deg,#0f0a02,#080604)",
    cardBorder:"#7a4f10",cardBorderLocked:"#252520",cardBorderFuture:"#1e1e1e",
    text:"#fff8e7",textMuted:"#666",textDim:"#444",textSubtle:"#888",
    textClue:"#fff8f0",textDate:"#8a6a30",zoneName:"#e8d5b0",
    accent:"#c8860a",accentHover:"#e6a020",green:"#4caf50",blue:"#5b8dee",red:"#e05555",
    toggleBg:"#1a1a1a",toggleBorder:"#333",
    gridLine:"rgba(76,175,80,0.07)",
    shimmer:"linear-gradient(90deg,#c8860a,#fff8e7,#c8860a)",
    danger:"#e05555",dangerBg:"rgba(224,85,85,0.1)",
    simBg:"#0a0a14",simBorder:"#2a2a5a",
    divider:"#1e1e18",
  },
  light:{
    bg:"#fdf8f0",bgCard:"linear-gradient(135deg,#fffdf5,#fff8e8)",bgLocked:"linear-gradient(135deg,#f5f5f0,#eeeee8)",bgFuture:"linear-gradient(135deg,#f8f8f5,#f0f0ec)",
    headerBg:"rgba(253,248,240,0.96)",headerBorder:"#e8d8b0",
    prizeBg:"linear-gradient(135deg,#fffcf0,#fff8e0)",prizeBorder:"#e8d090",
    timerBg:"linear-gradient(135deg,#fff8e0,#fff0cc)",
    nextBg:"linear-gradient(135deg,#f0f0ff,#e8e8f8)",nextBorder:"#b0b0e0",
    mapBg:"linear-gradient(135deg,#f0f7f0,#e8f5e8)",mapBorder:"#5aaf5a",mapInner:"#c0e0c0",
    panelBg:"#fffcf5",panelBorder:"#e8d090",
    inputBg:"#ffffff",inputBorder:"#ddd0a0",inputFocus:"#b07008",
    surfaceBg:"#ffffff",surfaceBorder:"#e8d8b0",
    modalBg:"linear-gradient(180deg,#fff8e0,#fffcf5)",
    upgradeBg:"linear-gradient(135deg,#fff8e0,#fff0cc)",
    authBg:"#fdf8f0",authCard:"linear-gradient(180deg,#ffffff,#fdf8f0)",
    cardBorder:"#c8860a",cardBorderLocked:"#ddd",cardBorderFuture:"#e0e0d8",
    text:"#1a0a00",textMuted:"#888",textDim:"#bbb",textSubtle:"#777",
    textClue:"#3a2000",textDate:"#9a7030",zoneName:"#2a1800",
    accent:"#b07008",accentHover:"#c88010",green:"#2a9a38",blue:"#3a6ecc",red:"#cc3333",
    toggleBg:"#f0e8d0",toggleBorder:"#d4c090",
    gridLine:"rgba(76,175,80,0.12)",
    shimmer:"linear-gradient(90deg,#b07008,#3a2000,#b07008)",
    danger:"#cc3333",dangerBg:"rgba(204,51,51,0.08)",
    simBg:"#f0f0ff",simBorder:"#c0c0e8",
    divider:"#ede0c0",
  },
};

// ─── HUNT BROWSER (HOME SCREEN) ───────────────────────────────────────────
function HuntBrowser({ onSelectHunt, t, isDark }) {
  const [cityFilter, setCityFilter] = useState("All");
  const [searchText, setSearchText] = useState("");
  const [hoveredId, setHoveredId] = useState(null);
  const now = new Date();

  const cities = ["All", ...new Set(ACTIVE_HUNTS.map(h => h.city))];
  const filtered = ACTIVE_HUNTS.filter(h => {
    if (cityFilter !== "All" && h.city !== cityFilter) return false;
    if (searchText && !h.city.toLowerCase().includes(searchText.toLowerCase()) && !h.area.toLowerCase().includes(searchText.toLowerCase())) return false;
    return true;
  });

  const diffColor = (d) => d === "Easy" ? t.green : d === "Hard" ? "#e05555" : t.accent;

  return (
    <div style={{ minHeight:"100vh",background:t.bg,fontFamily:"'DM Sans',sans-serif",color:t.text,transition:"background .3s,color .3s" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,400&family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
        @keyframes slideIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:.6}50%{opacity:1}}
      `}</style>

      {/* Header */}
      <div style={{ background:t.headerBg,borderBottom:`1px solid ${t.headerBorder}`,padding:"0 20px",position:"sticky",top:0,zIndex:100,backdropFilter:"blur(14px)" }}>
        <div style={{ maxWidth:"560px",margin:"0 auto",padding:"14px 0",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
          <div style={{ display:"flex",alignItems:"center",gap:"9px" }}>
            <div style={{ width:"34px",height:"34px",borderRadius:"10px",background:`linear-gradient(135deg,${t.accent},${t.accentHover})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"18px",boxShadow:`0 2px 12px ${t.accent}44` }}>🔍</div>
            <div>
              <div style={{ fontSize:"18px",fontFamily:"'Playfair Display',serif",fontWeight:"700",lineHeight:1.1,background:t.shimmer,backgroundSize:"200% auto",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",animation:"shimmer 5s linear infinite" }}>
                Finder<span style={{ fontStyle:"italic" }}>Seek</span>
              </div>
              <div style={{ color:t.textDim,fontSize:"9px",letterSpacing:"0.8px" }}>finderseek.com</div>
            </div>
          </div>
          <div style={{ color:t.textMuted,fontSize:"12px",display:"flex",alignItems:"center",gap:"6px" }}>
            <span style={{ width:"7px",height:"7px",borderRadius:"50%",background:t.green,display:"inline-block",animation:"pulse 2s infinite" }} />
            {ACTIVE_HUNTS.length} active hunts
          </div>
        </div>
      </div>

      <div style={{ maxWidth:"560px",margin:"0 auto",padding:"20px 16px 52px" }}>

        {/* Hero */}
        <div style={{ textAlign:"center",marginBottom:"24px",animation:"fadeUp .6s ease both" }}>
          <div style={{ fontSize:"28px",marginBottom:"8px" }}>🏴‍☠️</div>
          <div style={{ fontSize:"24px",fontFamily:"'Playfair Display',serif",fontWeight:"700",color:t.text,marginBottom:"6px" }}>Active Treasure Hunts</div>
          <div style={{ color:t.textMuted,fontSize:"14px",lineHeight:1.6 }}>Real cash hidden in real cities. Pick a hunt and start solving.</div>
        </div>

        {/* Search bar */}
        <div style={{ marginBottom:"14px",animation:"fadeUp .6s .1s ease both",opacity:0 }}>
          <div style={{ position:"relative" }}>
            <span style={{ position:"absolute",left:"14px",top:"50%",transform:"translateY(-50%)",fontSize:"16px",opacity:.5 }}>🔍</span>
            <input
              value={searchText} onChange={e=>setSearchText(e.target.value)}
              placeholder="Search city or area…"
              style={{ width:"100%",background:t.inputBg,border:`1.5px solid ${t.inputBorder}`,borderRadius:"12px",padding:"13px 14px 13px 40px",color:t.text,fontSize:"14px",outline:"none",fontFamily:"'DM Sans',sans-serif",transition:"border-color .2s" }}
              onFocus={e=>e.target.style.borderColor=t.inputFocus}
              onBlur={e=>e.target.style.borderColor=t.inputBorder}
            />
          </div>
        </div>

        {/* City filter pills */}
        <div style={{ display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"20px",animation:"fadeUp .6s .15s ease both",opacity:0 }}>
          {cities.map(c => (
            <button key={c} onClick={()=>setCityFilter(c)}
              style={{
                background:cityFilter===c ? `linear-gradient(135deg,${t.accent},${t.accentHover})` : `${t.accent}0a`,
                border:`1.5px solid ${cityFilter===c ? t.accent : t.inputBorder}`,
                color:cityFilter===c ? "#fff" : t.textMuted,
                borderRadius:"20px", padding:"7px 16px", fontSize:"12px", fontWeight:cityFilter===c?"700":"500",
                cursor:"pointer", transition:"all .2s", fontFamily:"'DM Sans',sans-serif",
                boxShadow:cityFilter===c ? `0 2px 12px ${t.accent}44` : "none",
              }}
            >
              {c === "All" ? "🌎 All" : `📍 ${c}`}
            </button>
          ))}
        </div>

        {/* Hunt cards */}
        <div style={{ display:"flex",flexDirection:"column",gap:"12px" }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign:"center",padding:"40px 20px",color:t.textMuted }}>
              <div style={{ fontSize:"32px",marginBottom:"10px",opacity:.4 }}>🗺️</div>
              <div style={{ fontSize:"15px" }}>No hunts found in this area yet.</div>
              <div style={{ fontSize:"12px",marginTop:"4px",color:t.textDim }}>Check back soon — new hunts drop every Friday!</div>
            </div>
          ) : filtered.map((hunt, idx) => {
            const msLeft = hunt.endsAt - now;
            const timeLeft = msLeft > 0 ? fmtDHMS(msLeft) : "Ended";
            const revCount = hunt.clues.filter(c => isRevealed(c.id, now)).length;
            const isHov = hoveredId === hunt.id;

            return (
              <div
                key={hunt.id}
                onClick={() => onSelectHunt(hunt)}
                onMouseEnter={() => setHoveredId(hunt.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  background: t.bgCard,
                  border: `1.5px solid ${isHov ? t.accent : t.cardBorder}`,
                  borderRadius: "16px",
                  padding: "20px",
                  cursor: "pointer",
                  transition: "all .2s",
                  transform: isHov ? "translateY(-3px)" : "none",
                  boxShadow: isHov ? `0 10px 36px ${t.accent}22` : "none",
                  position: "relative",
                  overflow: "hidden",
                  animation: `fadeUp .5s ${0.2 + idx * 0.08}s ease both`,
                  opacity: 0,
                }}
              >
                {/* Top accent line */}
                <div style={{ position:"absolute",top:0,left:0,right:0,height:"2px",background:`linear-gradient(90deg,transparent,${t.accent},transparent)`,opacity:isHov?1:.4,transition:"opacity .2s" }} />

                {/* Row 1: City + Prize */}
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"14px" }}>
                  <div>
                    <div style={{ color:t.text,fontSize:"17px",fontWeight:"700",marginBottom:"3px" }}>{hunt.city}</div>
                    <div style={{ color:t.textMuted,fontSize:"12px",display:"flex",alignItems:"center",gap:"6px" }}>
                      <span>📍 {hunt.area}</span>
                      <span style={{ color:t.textDim }}>·</span>
                      <span>🏴‍☠️ {hunt.pirate}</span>
                    </div>
                  </div>
                  <div style={{ textAlign:"right",flexShrink:0 }}>
                    <div style={{ color:t.accent,fontSize:"18px",fontWeight:"700",fontFamily:"'Playfair Display',serif" }}>{hunt.prize}</div>
                    <span style={{ background:diffColor(hunt.difficulty)+"18",border:`1px solid ${diffColor(hunt.difficulty)}44`,color:diffColor(hunt.difficulty),fontSize:"10px",fontWeight:"600",padding:"2px 8px",borderRadius:"10px",letterSpacing:"0.5px" }}>{hunt.difficulty}</span>
                  </div>
                </div>

                {/* Row 2: Progress + Timer */}
                <div style={{ display:"flex",gap:"12px",alignItems:"center",marginBottom:"12px" }}>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex",justifyContent:"space-between",marginBottom:"4px" }}>
                      <span style={{ color:t.textSubtle,fontSize:"10px",letterSpacing:"1.5px",textTransform:"uppercase" }}>Clues</span>
                      <span style={{ color:t.text,fontSize:"11px",fontWeight:"700",fontFamily:"'DM Mono',monospace" }}>{revCount}/{hunt.totalClues}</span>
                    </div>
                    <div style={{ height:"4px",background:isDark?"#1a1a14":"#e8e0c8",borderRadius:"2px",overflow:"hidden" }}>
                      <div style={{ height:"100%",width:`${(revCount/hunt.totalClues)*100}%`,background:`linear-gradient(90deg,${t.accent},${t.green})`,borderRadius:"2px",transition:"width 1s" }} />
                    </div>
                  </div>
                  <div style={{ background:`${t.accent}10`,border:`1px solid ${t.accent}30`,borderRadius:"8px",padding:"5px 10px",textAlign:"center",flexShrink:0 }}>
                    <div style={{ color:t.accent,fontSize:"8px",letterSpacing:"1.5px",textTransform:"uppercase",marginBottom:"1px" }}>Ends in</div>
                    <div style={{ color:t.text,fontSize:"12px",fontWeight:"700",fontFamily:"'DM Mono',monospace" }}>{timeLeft}</div>
                  </div>
                </div>

                {/* Row 3: CTA */}
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                  <div style={{ color:t.textDim,fontSize:"11px" }}>{hunt.weekOf}</div>
                  <div style={{ color:t.accent,fontSize:"13px",fontWeight:"700",display:"flex",alignItems:"center",gap:"4px" }}>
                    Join Hunt <span style={{ fontSize:"16px",transition:"transform .2s",transform:isHov?"translateX(3px)":"none" }}>→</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom CTA */}
        <div style={{ marginTop:"28px",textAlign:"center",animation:"fadeUp .6s .5s ease both",opacity:0 }}>
          <div style={{ color:t.textDim,fontSize:"12px",marginBottom:"8px" }}>Want to hide treasure in your city?</div>
          <button style={{ background:"transparent",border:`1.5px solid ${t.blue}`,color:t.blue,borderRadius:"12px",padding:"10px 22px",fontSize:"13px",fontWeight:"600",cursor:"pointer",fontFamily:"'DM Sans',sans-serif" }}>
            🏴‍☠️ Become a Pirate
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── AUTH SCREENS ──────────────────────────────────────────────────────────

function SocialBtn({ icon, label, onClick, t }) {
  const [hov,setHov]=useState(false);
  return (
    <button onClick={onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{ width:"100%",background:hov?`${t.accent}10`:"transparent",border:`1.5px solid ${hov?t.accent:t.inputBorder}`,borderRadius:"12px",padding:"13px 16px",display:"flex",alignItems:"center",gap:"12px",cursor:"pointer",transition:"all .18s",color:t.text,fontSize:"14px",fontWeight:"500",fontFamily:"'DM Sans',sans-serif" }}>
      <span style={{ fontSize:"20px",flexShrink:0 }}>{icon}</span>
      <span style={{ flex:1,textAlign:"left" }}>{label}</span>
      <span style={{ color:t.textMuted,fontSize:"16px" }}>›</span>
    </button>
  );
}

function InputField({ label, type="text", value, onChange, placeholder, error, t, autoFocus }) {
  const [focused,setFocused]=useState(false);
  return (
    <div style={{ marginBottom:"14px" }}>
      {label && <label style={{ display:"block",color:t.textSubtle,fontSize:"11px",letterSpacing:"1.5px",textTransform:"uppercase",marginBottom:"6px" }}>{label}</label>}
      <input type={type} value={value} onChange={onChange} placeholder={placeholder} autoFocus={autoFocus}
        onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)}
        style={{ width:"100%",background:t.inputBg,border:`1.5px solid ${error?t.danger:focused?t.inputFocus:t.inputBorder}`,borderRadius:"10px",padding:"12px 14px",color:t.text,fontSize:"14px",outline:"none",fontFamily:"'DM Sans',sans-serif",transition:"border-color .2s" }}
      />
      {error && <div style={{ color:t.danger,fontSize:"12px",marginTop:"4px" }}>{error}</div>}
    </div>
  );
}

// Welcome / choose method screen
function AuthWelcome({ onMethod, onGuest, onBack, t, isDark }) {
  return (
    <div style={{ minHeight:"100vh",background:t.authBg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px" }}>
      <div style={{ width:"100%",maxWidth:"360px" }}>
        {onBack && <button onClick={onBack} style={{ background:"transparent",border:"none",color:t.textMuted,fontSize:"13px",cursor:"pointer",padding:"0 0 20px",display:"flex",alignItems:"center",gap:"6px" }}>← Back to hunts</button>}
        {/* Logo */}
        <div style={{ textAlign:"center",marginBottom:"36px" }}>
          <div style={{ width:"64px",height:"64px",borderRadius:"20px",background:`linear-gradient(135deg,${t.accent},${t.accentHover})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"32px",margin:"0 auto 16px",boxShadow:`0 4px 24px ${t.accent}55` }}>🔍</div>
          <div style={{ fontSize:"28px",fontFamily:"'Playfair Display',serif",fontWeight:"700",background:t.shimmer,backgroundSize:"200% auto",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",animation:"shimmer 5s linear infinite" }}>
            Finder<span style={{ fontStyle:"italic" }}>Seek</span>
          </div>
          <div style={{ color:t.textMuted,fontSize:"13px",marginTop:"6px" }}>City treasure hunts. Real prizes.</div>
        </div>

        {/* Social login buttons */}
        <div style={{ display:"flex",flexDirection:"column",gap:"10px",marginBottom:"20px" }}>
          <SocialBtn icon="🍎" label="Continue with Apple" onClick={()=>onMethod("apple")} t={t} />
          <SocialBtn icon="🌐" label="Continue with Google" onClick={()=>onMethod("google")} t={t} />
          <SocialBtn icon="📱" label="Continue with Phone" onClick={()=>onMethod("phone")} t={t} />
        </div>

        {/* Divider */}
        <div style={{ display:"flex",alignItems:"center",gap:"12px",marginBottom:"20px" }}>
          <div style={{ flex:1,height:"1px",background:t.divider }} />
          <span style={{ color:t.textMuted,fontSize:"12px" }}>or</span>
          <div style={{ flex:1,height:"1px",background:t.divider }} />
        </div>

        {/* Email */}
        <button onClick={()=>onMethod("email")} style={{ width:"100%",background:`linear-gradient(135deg,${t.accent},${t.accentHover})`,color:"#fff",border:"none",borderRadius:"12px",padding:"14px",fontSize:"15px",fontWeight:"700",cursor:"pointer",letterSpacing:"0.5px",boxShadow:`0 4px 20px ${t.accent}44`,marginBottom:"14px" }}>
          Sign up with Email
        </button>
        <div style={{ textAlign:"center",marginBottom:"20px" }}>
          <span style={{ color:t.textMuted,fontSize:"13px" }}>Already have an account? </span>
          <button onClick={()=>onMethod("login")} style={{ background:"transparent",border:"none",color:t.accent,fontSize:"13px",fontWeight:"600",cursor:"pointer",padding:0 }}>Log in →</button>
        </div>

        {/* Guest */}
        <button onClick={onGuest} style={{ width:"100%",background:"transparent",border:`1px solid ${t.inputBorder}`,color:t.textMuted,borderRadius:"10px",padding:"11px",fontSize:"13px",cursor:"pointer" }}>
          Browse as guest (limited)
        </button>

        <div style={{ textAlign:"center",marginTop:"24px",color:t.textDim,fontSize:"11px",lineHeight:"1.6" }}>
          By continuing you agree to our Terms of Service<br/>and Privacy Policy.
        </div>
      </div>
    </div>
  );
}

// Email sign-up / login form
function AuthEmail({ mode, onBack, onDone, t }) {
  const isLogin = mode==="login";
  const [email,setEmail]=useState("");
  const [pass,setPass]=useState("");
  const [errors,setErrors]=useState({});
  const [loading,setLoading]=useState(false);

  const validate = () => {
    const e={};
    if(!email||!email.includes("@")) e.email="Enter a valid email address";
    if(pass.length<6) e.pass="Password must be at least 6 characters";
    return e;
  };
  const submit = () => {
    const e=validate(); setErrors(e);
    if(Object.keys(e).length) return;
    setLoading(true);
    setTimeout(()=>{ setLoading(false); onDone({email,name:email.split("@")[0]}); },1200);
  };

  return (
    <div style={{ minHeight:"100vh",background:t.authBg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px" }}>
      <div style={{ width:"100%",maxWidth:"360px" }}>
        <button onClick={onBack} style={{ background:"transparent",border:"none",color:t.textMuted,fontSize:"13px",cursor:"pointer",padding:"0 0 20px",display:"flex",alignItems:"center",gap:"6px" }}>← Back</button>
        <div style={{ background:t.authCard,border:`1.5px solid ${t.surfaceBorder}`,borderRadius:"18px",padding:"28px 24px" }}>
          <div style={{ marginBottom:"22px" }}>
            <div style={{ fontSize:"22px",fontFamily:"'Playfair Display',serif",fontWeight:"700",color:t.text,marginBottom:"4px" }}>{isLogin?"Welcome back":"Create account"}</div>
            <div style={{ color:t.textMuted,fontSize:"13px" }}>{isLogin?"Log in to your FinderSeek account":"Join the hunt — it's free"}</div>
          </div>
          <InputField label="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" error={errors.email} t={t} autoFocus />
          <InputField label="Password" type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder={isLogin?"Your password":"At least 6 characters"} error={errors.pass} t={t} />
          {isLogin && <div style={{ textAlign:"right",marginTop:"-8px",marginBottom:"16px" }}><button style={{ background:"transparent",border:"none",color:t.accent,fontSize:"12px",cursor:"pointer",padding:0 }}>Forgot password?</button></div>}
          <button onClick={submit} disabled={loading} style={{ width:"100%",background:`linear-gradient(135deg,${t.accent},${t.accentHover})`,color:"#fff",border:"none",borderRadius:"11px",padding:"14px",fontSize:"15px",fontWeight:"700",cursor:loading?"not-allowed":"pointer",opacity:loading?.7:1,boxShadow:`0 4px 20px ${t.accent}44`,display:"flex",alignItems:"center",justifyContent:"center",gap:"8px" }}>
            {loading?<><span style={{ animation:"spin 1s linear infinite",display:"inline-block" }}>⏳</span>Working…</>:(isLogin?"Log In →":"Create Account →")}
          </button>
        </div>
      </div>
    </div>
  );
}

// Phone / SMS screen
function AuthPhone({ onBack, onDone, t }) {
  const [step,setStep]=useState("number"); // "number" | "code"
  const [phone,setPhone]=useState("");
  const [code,setCode]=useState("");
  const [sent,setSent]=useState(false);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);

  const sendCode = () => {
    if(phone.replace(/\D/g,"").length<10){setError("Enter a valid 10-digit phone number");return;}
    setError(""); setLoading(true);
    setTimeout(()=>{ setLoading(false); setSent(true); setStep("code"); },1000);
  };
  const verifyCode = () => {
    if(code.length<4){setError("Enter the 6-digit code");return;}
    setError(""); setLoading(true);
    setTimeout(()=>{ setLoading(false); onDone({phone,name:""}); },1000);
  };

  return (
    <div style={{ minHeight:"100vh",background:t.authBg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px" }}>
      <div style={{ width:"100%",maxWidth:"360px" }}>
        <button onClick={onBack} style={{ background:"transparent",border:"none",color:t.textMuted,fontSize:"13px",cursor:"pointer",padding:"0 0 20px",display:"flex",alignItems:"center",gap:"6px" }}>← Back</button>
        <div style={{ background:t.authCard,border:`1.5px solid ${t.surfaceBorder}`,borderRadius:"18px",padding:"28px 24px" }}>
          <div style={{ marginBottom:"22px" }}>
            <div style={{ fontSize:"22px",fontFamily:"'Playfair Display',serif",fontWeight:"700",color:t.text,marginBottom:"4px" }}>📱 {step==="number"?"Enter your number":"Check your texts"}</div>
            <div style={{ color:t.textMuted,fontSize:"13px" }}>{step==="number"?"We'll send a one-time code":`Code sent to ${phone}`}</div>
          </div>
          {step==="number" ? (
            <>
              <InputField label="Phone Number" type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+1 (555) 000-0000" error={error} t={t} autoFocus />
              <button onClick={sendCode} disabled={loading} style={{ width:"100%",background:`linear-gradient(135deg,${t.accent},${t.accentHover})`,color:"#fff",border:"none",borderRadius:"11px",padding:"14px",fontSize:"15px",fontWeight:"700",cursor:"pointer",boxShadow:`0 4px 20px ${t.accent}44` }}>
                {loading?"Sending…":"Send Code →"}
              </button>
            </>
          ) : (
            <>
              <InputField label="Verification Code" type="number" value={code} onChange={e=>setCode(e.target.value)} placeholder="6-digit code" error={error} t={t} autoFocus />
              <button onClick={verifyCode} disabled={loading} style={{ width:"100%",background:`linear-gradient(135deg,${t.accent},${t.accentHover})`,color:"#fff",border:"none",borderRadius:"11px",padding:"14px",fontSize:"15px",fontWeight:"700",cursor:"pointer",boxShadow:`0 4px 20px ${t.accent}44`,marginBottom:"10px" }}>
                {loading?"Verifying…":"Verify Code →"}
              </button>
              <button onClick={()=>{setStep("number");setCode("");setError("");}} style={{ width:"100%",background:"transparent",border:"none",color:t.textMuted,fontSize:"13px",cursor:"pointer",padding:"8px" }}>Resend code</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Social SSO simulation
function AuthSocial({ provider, onBack, onDone, t }) {
  const [progress,setProgress]=useState(0);
  useEffect(()=>{
    const id=setInterval(()=>setProgress(p=>{ if(p>=100){ clearInterval(id); onDone({name:provider==="google"?"Alex Johnson":"Alex",email:provider==="google"?"alex@gmail.com":""}); return 100; } return p+8; }),80);
    return ()=>clearInterval(id);
  },[]);
  return (
    <div style={{ minHeight:"100vh",background:t.authBg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px",gap:"24px" }}>
      <div style={{ fontSize:"48px" }}>{provider==="google"?"🌐":"🍎"}</div>
      <div style={{ color:t.text,fontSize:"16px",fontWeight:"600" }}>Connecting to {provider==="google"?"Google":"Apple"}…</div>
      <div style={{ width:"200px",height:"4px",background:t.divider,borderRadius:"2px",overflow:"hidden" }}>
        <div style={{ height:"100%",width:`${progress}%`,background:`linear-gradient(90deg,${t.accent},${t.accentHover})`,transition:"width .1s" }} />
      </div>
      <button onClick={onBack} style={{ background:"transparent",border:"none",color:t.textMuted,fontSize:"13px",cursor:"pointer" }}>Cancel</button>
    </div>
  );
}

// Profile setup — name + city picker
function ProfileSetup({ user, onDone, t }) {
  const [name,setName]=useState(user.name||"");
  const [city,setCity]=useState("");
  const [citySearch,setCitySearch]=useState("");
  const [showCities,setShowCities]=useState(false);
  const [error,setError]=useState("");

  const filtered = US_CITIES.filter(c=>c.toLowerCase().includes(citySearch.toLowerCase())).slice(0,6);

  const submit = () => {
    if(name.trim().length<2){setError("Enter a display name (at least 2 characters)");return;}
    onDone({...user,name:name.trim(),city,setupDone:true});
  };

  return (
    <div style={{ minHeight:"100vh",background:t.authBg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px" }}>
      <div style={{ width:"100%",maxWidth:"360px" }}>
        <div style={{ background:t.authCard,border:`1.5px solid ${t.surfaceBorder}`,borderRadius:"18px",padding:"28px 24px" }}>
          {/* Avatar preview */}
          <div style={{ textAlign:"center",marginBottom:"24px" }}>
            <div style={{ width:"64px",height:"64px",borderRadius:"50%",background:avatarColor(name||"?"),display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:"22px",fontWeight:"700",color:"#fff",marginBottom:"10px",boxShadow:`0 2px 16px ${avatarColor(name||"?")}55`,transition:"background .3s" }}>
              {initials(name)||"?"}
            </div>
            <div style={{ color:t.text,fontSize:"20px",fontFamily:"'Playfair Display',serif",fontWeight:"700" }}>Set up your profile</div>
            <div style={{ color:t.textMuted,fontSize:"13px",marginTop:"4px" }}>Hunters will see this on the leaderboard</div>
          </div>

          <InputField label="Display Name *" value={name} onChange={e=>{setName(e.target.value);setError("");}} placeholder="e.g. ShadowFox_88" error={error} t={t} autoFocus />

          {/* City picker */}
          <div style={{ marginBottom:"20px",position:"relative" }}>
            <label style={{ display:"block",color:t.textSubtle,fontSize:"11px",letterSpacing:"1.5px",textTransform:"uppercase",marginBottom:"6px" }}>Your City</label>
            <input value={citySearch||city} onChange={e=>{setCitySearch(e.target.value);setCity("");setShowCities(true);}} onFocus={()=>setShowCities(true)}
              placeholder="Search your city…"
              style={{ width:"100%",background:t.inputBg,border:`1.5px solid ${showCities&&citySearch?t.inputFocus:t.inputBorder}`,borderRadius:"10px",padding:"12px 14px",color:t.text,fontSize:"14px",outline:"none",fontFamily:"'DM Sans',sans-serif",transition:"border-color .2s" }}
            />
            {showCities && citySearch && filtered.length>0 && (
              <div style={{ position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:t.inputBg,border:`1px solid ${t.inputBorder}`,borderRadius:"10px",marginTop:"4px",overflow:"hidden",boxShadow:"0 8px 24px rgba(0,0,0,.25)" }}>
                {filtered.map(c=>(
                  <button key={c} onClick={()=>{setCity(c);setCitySearch(c);setShowCities(false);}}
                    style={{ width:"100%",background:"transparent",border:"none",borderBottom:`1px solid ${t.divider}`,padding:"11px 14px",textAlign:"left",color:t.text,fontSize:"13px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif" }}
                    onMouseEnter={e=>e.currentTarget.style.background=`${t.accent}15`}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                  >{c}</button>
                ))}
              </div>
            )}
          </div>

          <button onClick={submit} style={{ width:"100%",background:`linear-gradient(135deg,${t.accent},${t.accentHover})`,color:"#fff",border:"none",borderRadius:"11px",padding:"14px",fontSize:"15px",fontWeight:"700",cursor:"pointer",boxShadow:`0 4px 20px ${t.accent}44` }}>
            Start Hunting →
          </button>
          <button onClick={()=>onDone({...user,name:user.name||"Hunter",setupDone:true})} style={{ width:"100%",background:"transparent",border:"none",color:t.textMuted,fontSize:"13px",cursor:"pointer",padding:"10px",marginTop:"4px" }}>
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}

// Account dropdown menu
function AccountMenu({ user, isPro, onUpgrade, onLogout, onEditProfile, t, isDark }) {
  const [open,setOpen]=useState(false);
  const ref=useRef();
  useEffect(()=>{
    const h=e=>{ if(ref.current&&!ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown",h); return ()=>document.removeEventListener("mousedown",h);
  },[]);

  return (
    <div ref={ref} style={{ position:"relative" }}>
      <button onClick={()=>setOpen(o=>!o)} style={{ width:"34px",height:"34px",borderRadius:"50%",background:avatarColor(user.name),border:`2px solid ${open?t.accent:t.inputBorder}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"13px",fontWeight:"700",color:"#fff",cursor:"pointer",transition:"border-color .2s",flexShrink:0 }}>
        {initials(user.name)}
      </button>
      {open && (
        <div style={{ position:"absolute",top:"calc(100% + 8px)",right:0,zIndex:200,background:t.inputBg,border:`1px solid ${t.inputBorder}`,borderRadius:"14px",padding:"6px",minWidth:"220px",boxShadow:"0 12px 40px rgba(0,0,0,.35)",animation:"slideIn .15s ease" }}>
          {/* User info */}
          <div style={{ padding:"12px 14px 10px",borderBottom:`1px solid ${t.divider}` }}>
            <div style={{ display:"flex",alignItems:"center",gap:"10px" }}>
              <div style={{ width:"38px",height:"38px",borderRadius:"50%",background:avatarColor(user.name),display:"flex",alignItems:"center",justifyContent:"center",fontSize:"14px",fontWeight:"700",color:"#fff",flexShrink:0 }}>{initials(user.name)}</div>
              <div>
                <div style={{ color:t.text,fontSize:"14px",fontWeight:"600" }}>{user.name||"Hunter"}</div>
                <div style={{ color:t.textMuted,fontSize:"11px" }}>{user.email||user.phone||"—"}</div>
                {user.city && <div style={{ color:t.textMuted,fontSize:"11px" }}>📍 {user.city}</div>}
              </div>
            </div>
            {isPro && <div style={{ marginTop:"8px",background:`${t.accent}15`,border:`1px solid ${t.accent}33`,borderRadius:"8px",padding:"4px 10px",color:t.accent,fontSize:"11px",fontWeight:"700",textAlign:"center",letterSpacing:"1px" }}>⭐ PRO MEMBER</div>}
          </div>
          {/* Menu items */}
          {[
            ["👤","Edit Profile",onEditProfile],
            ...(!isPro?[["⭐","Upgrade to Pro",onUpgrade]]:[]),
            ["🏆","My Hunt History",()=>{}],
            ["⚙️","Settings",()=>{}],
          ].map(([icon,label,fn])=>(
            <button key={label} onClick={()=>{fn();setOpen(false);}}
              style={{ width:"100%",background:"transparent",border:"none",borderRadius:"8px",padding:"10px 12px",display:"flex",alignItems:"center",gap:"10px",cursor:"pointer",color:t.text,fontSize:"13px",fontFamily:"'DM Sans',sans-serif",transition:"background .15s" }}
              onMouseEnter={e=>e.currentTarget.style.background=`${t.accent}15`}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}
            ><span>{icon}</span><span>{label}</span></button>
          ))}
          <div style={{ borderTop:`1px solid ${t.divider}`,marginTop:"4px",paddingTop:"4px" }}>
            <button onClick={()=>{onLogout();setOpen(false);}}
              style={{ width:"100%",background:"transparent",border:"none",borderRadius:"8px",padding:"10px 12px",display:"flex",alignItems:"center",gap:"10px",cursor:"pointer",color:t.danger,fontSize:"13px",fontFamily:"'DM Sans',sans-serif",transition:"background .15s" }}
              onMouseEnter={e=>e.currentTarget.style.background=t.dangerBg}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}
            ><span>🚪</span><span>Log Out</span></button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Hunt UI components ─────────────────────────────────────────────────────
function ThemeToggle({ isDark, onToggle, t }) {
  return (
    <button onClick={onToggle} style={{ background:t.toggleBg,border:`1px solid ${t.toggleBorder}`,borderRadius:"22px",padding:"5px 8px 5px 7px",display:"flex",alignItems:"center",gap:"6px",cursor:"pointer",transition:"all .25s" }}>
      <span style={{ fontSize:"14px",lineHeight:1 }}>{isDark?"🌙":"☀️"}</span>
      <div style={{ width:"30px",height:"17px",borderRadius:"9px",background:`linear-gradient(135deg,${t.accent},${t.accentHover})`,position:"relative",flexShrink:0 }}>
        <div style={{ position:"absolute",top:"2.5px",left:isDark?"15px":"2.5px",width:"12px",height:"12px",background:"#fff",borderRadius:"50%",transition:"left .25s",boxShadow:"0 1px 4px rgba(0,0,0,.3)" }} />
      </div>
    </button>
  );
}

function NextClueBanner({ now, t }) {
  const next=nextReveal(now); if(!next)return null;
  const ms=next-now;
  const clueId=Object.entries(REVEAL_DATES).find(([,d])=>new Date(d).getTime()===next.getTime())?.[0];
  const clue=DEFAULT_CLUES.find(c=>c.id===Number(clueId)); if(!clue)return null;
  return (
    <div style={{ background:t.nextBg,border:`1.5px solid ${t.nextBorder}`,borderRadius:"12px",padding:"13px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:"12px" }}>
      <div>
        <div style={{ color:t.blue,fontSize:"10px",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"3px" }}>{clue.tier==="free"?"Next Free Clue":"⭐ Next Pro Clue"}</div>
        <div style={{ color:t.text,fontSize:"13px",fontWeight:"600" }}>Clue {clue.id} · {clue.day}</div>
      </div>
      <div style={{ textAlign:"right",flexShrink:0 }}>
        <div style={{ color:t.blue,fontSize:"10px",letterSpacing:"1px",textTransform:"uppercase",marginBottom:"2px" }}>Drops in</div>
        <div style={{ color:t.text,fontSize:"20px",fontFamily:"'DM Mono',monospace",fontWeight:"700",letterSpacing:"2px" }}>{fmtHMS(ms)}</div>
      </div>
    </div>
  );
}

function ClueCard({ clue, isPro, now, t }) {
  const tierLocked=clue.tier==="pro"&&!isPro;
  const timeLocked=!isRevealed(clue.id,now);
  const showNew=isNew(clue.id,now)&&!timeLocked;
  const revDate=new Date(REVEAL_DATES[clue.id]);
  const msUntil=revDate-now;
  const unlocked=!timeLocked&&!tierLocked;
  const dayColors={"1":"#4caf50","2":"#5b8dee","3":"#9b59b6","4":"#e8c840","5":"#e87c33","6":"#e05555","7":"#e05555"};
  const dc=dayColors[String(clue.id)]||t.accent;
  return (
    <div
      onMouseEnter={e=>{ if(unlocked){e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow=`0 10px 36px ${dc}30`;} }}
      onMouseLeave={e=>{ e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="none"; }}
      style={{ background:timeLocked?t.bgFuture:tierLocked?t.bgLocked:t.bgCard,border:`1.5px solid ${timeLocked?t.cardBorderFuture:tierLocked?t.cardBorderLocked:dc}`,borderRadius:"16px",padding:0,position:"relative",overflow:"hidden",opacity:timeLocked?.45:tierLocked?.65:1,transition:"transform .2s,box-shadow .2s" }}>
      {/* Top glow bar for revealed clues */}
      {unlocked&&<div style={{ height:"3px",background:`linear-gradient(90deg,transparent,${dc},transparent)` }} />}
      {showNew&&<div style={{ position:"absolute",top:"14px",right:"14px",background:dc,color:"#fff",fontSize:"9px",fontWeight:"800",letterSpacing:"1.5px",padding:"3px 10px",borderRadius:"10px",animation:"newPulse 1.5s ease-in-out infinite",zIndex:2 }}>NEW</div>}

      <div style={{ padding:"16px 18px",display:"flex",gap:"14px" }}>
        {/* Clue number badge */}
        <div style={{ width:"42px",height:"42px",borderRadius:"12px",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"18px",fontWeight:"800",fontFamily:"'DM Mono',monospace",
          background:unlocked?`linear-gradient(135deg,${dc},${dc}cc)`:timeLocked?`${t.textDim}18`:`${dc}15`,
          color:unlocked?"#fff":t.textDim,
          boxShadow:unlocked?`0 3px 12px ${dc}44`:"none",
        }}>{clue.id}</div>

        {/* Content */}
        <div style={{ flex:1,minWidth:0 }}>
          {/* Header row */}
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:unlocked?"10px":"6px" }}>
            <div style={{ display:"flex",alignItems:"center",gap:"8px" }}>
              <span style={{ color:unlocked?t.text:t.textMuted,fontSize:"13px",fontWeight:"600" }}>{clue.day}</span>
              <span style={{ color:t.textDim,fontSize:"11px" }}>{clue.date}</span>
            </div>
            <span style={{ background:clue.tier==="pro"?`${t.accent}20`:`${t.text}08`,border:`1px solid ${clue.tier==="pro"?`${t.accent}55`:t.cardBorderLocked}`,color:clue.tier==="pro"?t.accent:t.textMuted,fontSize:"9px",letterSpacing:"1.5px",textTransform:"uppercase",padding:"2px 8px",borderRadius:"10px",fontWeight:"600" }}>
              {clue.tier==="pro"?"⭐ PRO":"FREE"}
            </span>
          </div>

          {/* Body */}
          {timeLocked ? (
            <div style={{ display:"flex",alignItems:"center",gap:"10px" }}>
              <span style={{ fontSize:"16px",opacity:.5 }}>⏳</span>
              <div>
                <div style={{ color:t.textMuted,fontSize:"12px",fontWeight:"500" }}>Drops {clue.day} at 8 AM</div>
                <div style={{ color:t.textDim,fontSize:"11px",fontFamily:"'DM Mono',monospace" }}>{fmtHMS(msUntil)}</div>
              </div>
            </div>
          ):tierLocked?(
            <div style={{ display:"flex",alignItems:"center",gap:"10px" }}>
              <span style={{ fontSize:"18px" }}>🔒</span>
              <div style={{ color:t.textDim,fontSize:"13px" }}>Upgrade to Pro to unlock</div>
            </div>
          ):clue.isPhoto?(
            clue.photoUrl?(
              <div style={{ borderRadius:"10px",overflow:"hidden",border:`1px solid ${t.accent}` }}>
                <img src={clue.photoUrl} alt="photo clue" style={{ width:"100%",display:"block",maxHeight:"180px",objectFit:"cover" }} />
                <div style={{ background:`${t.accent}15`,padding:"8px 14px",color:t.accent,fontSize:"11px",fontWeight:"600" }}>📸 Photo Clue</div>
              </div>
            ):(
              <div style={{ background:`${t.accent}0c`,border:`1px dashed ${t.accent}44`,borderRadius:"10px",padding:"14px",textAlign:"center" }}>
                <div style={{ fontSize:"20px",marginBottom:"4px" }}>📸</div>
                <div style={{ color:t.accent,fontSize:"12px",fontWeight:"600" }}>Photo clue drops Thursday 8 AM</div>
              </div>
            )
          ):(
            <p style={{ color:t.textClue,fontSize:"15px",lineHeight:"1.7",fontFamily:"'DM Sans',sans-serif",fontWeight:"400",margin:0 }}>"{clue.text}"</p>
          )}
        </div>
      </div>
    </div>
  );
}

function MapSection({ isPro, t }) {
  return (
    <div style={{ background:t.mapBg,border:`1.5px solid ${t.mapBorder}`,borderRadius:"14px",overflow:"hidden" }}>
      <div style={{ padding:"16px 22px",borderBottom:`1px solid ${t.mapInner}`,display:"flex",justifyContent:"space-between",alignItems:"center" }}>
        <div>
          <div style={{ color:t.green,fontSize:"12px",letterSpacing:"2px",textTransform:"uppercase" }}>Hunt Map</div>
          <div style={{ color:t.textSubtle,fontSize:"12px",marginTop:"2px" }}>{isPro?"Zoomed-in · ~200m accuracy":"General area — upgrade for close-up"}</div>
        </div>
        {isPro&&<span style={{ background:`${t.green}22`,border:`1px solid ${t.green}`,color:t.green,fontSize:"10px",padding:"3px 10px",borderRadius:"20px" }}>⭐ PRO</span>}
      </div>
      <div style={{ height:"200px",position:"relative",display:"flex",alignItems:"center",justifyContent:"center" }}>
        {[...Array(5)].map((_,i)=><div key={`h${i}`} style={{ position:"absolute",left:0,right:0,top:`${(i+1)*16}%`,height:"1px",background:t.gridLine }} />)}
        {[...Array(7)].map((_,i)=><div key={`v${i}`} style={{ position:"absolute",top:0,bottom:0,left:`${(i+1)*12}%`,width:"1px",background:t.gridLine }} />)}
        {isPro?(
          <>
            <div style={{ position:"absolute",left:"58%",top:"48%",width:"64px",height:"64px",background:`radial-gradient(circle,${t.green}44,transparent)`,borderRadius:"50%",transform:"translate(-50%,-50%)",animation:"pulse 2s infinite" }} />
            <div style={{ position:"absolute",left:"58%",top:"48%",transform:"translate(-50%,-50%)",fontSize:"24px",filter:`drop-shadow(0 0 8px ${t.green})` }}>📍</div>
            <div style={{ position:"absolute",bottom:"12px",right:"12px",background:"rgba(0,0,0,0.65)",border:`1px solid ${t.green}`,color:t.green,fontSize:"11px",padding:"4px 10px",borderRadius:"6px" }}>~200m radius zone</div>
          </>
        ):(
          <div style={{ textAlign:"center" }}>
            <div style={{ fontSize:"34px",opacity:.3,marginBottom:"8px" }}>🗺️</div>
            <div style={{ color:t.textDim,fontSize:"13px" }}>Upgrade to Pro for zoomed map</div>
          </div>
        )}
      </div>
    </div>
  );
}

function UpgradeBanner({ onUpgrade, t }) {
  return (
    <div style={{ background:t.upgradeBg,border:`2px solid ${t.accent}`,borderRadius:"16px",padding:"22px 24px",position:"relative",overflow:"hidden" }}>
      <div style={{ position:"absolute",top:"-40px",right:"-40px",width:"110px",height:"110px",background:`radial-gradient(circle,${t.accent}18,transparent)`,borderRadius:"50%" }} />
      <div style={{ position:"relative" }}>
        <div style={{ fontSize:"20px",marginBottom:"6px" }}>⭐</div>
        <div style={{ color:t.text,fontSize:"16px",fontFamily:"'Playfair Display',serif",fontWeight:"700",marginBottom:"5px" }}>Go Pro — Find It First</div>
        <div style={{ color:t.textDate,fontSize:"13px",lineHeight:"1.6",marginBottom:"12px" }}>
          Get <strong style={{ color:t.accent }}>6 clues</strong>, a zoomed map, and a <strong style={{ color:t.accent }}>Thursday photo clue</strong>.
        </div>
        <div style={{ display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"14px" }}>
          {["6 Clues","Zoomed Map","Photo Clue","Early Access"].map(f=>(
            <span key={f} style={{ background:`${t.accent}15`,border:`1px solid ${t.accent}44`,color:t.accent,fontSize:"11px",padding:"3px 10px",borderRadius:"20px" }}>✓ {f}</span>
          ))}
        </div>
        <button onClick={onUpgrade} style={{ background:`linear-gradient(135deg,${t.accent},${t.accentHover})`,color:"#fff",border:"none",borderRadius:"10px",padding:"11px 26px",fontSize:"14px",fontWeight:"700",cursor:"pointer",boxShadow:`0 4px 20px ${t.accent}44` }}>
          UNLOCK PRO — $4.99/mo
        </button>
      </div>
    </div>
  );
}


// ─── Claim Tab ─────────────────────────────────────────────────────────────
function ClaimTab({ hunt, t, isDark }) {
  const [digits, setDigits] = useState(["","","","","",""]);
  const [status, setStatus] = useState("idle");
  const [showConfetti, setShowConfetti] = useState(false);
  const inputRefs = useRef([]);
  const handleDigit = (i, val) => {
    if(!/^[0-9]?$/.test(val)) return;
    const next = [...digits]; next[i] = val; setDigits(next);
    if(val && i < 5) inputRefs.current[i+1]?.focus();
  };
  const handleKeyDown = (i, e) => { if(e.key==="Backspace" && !digits[i] && i > 0) inputRefs.current[i-1]?.focus(); };
  const handlePaste = (e) => { const paste = e.clipboardData.getData("text").replace(/\D/g,"").slice(0,6); if(paste.length === 6) { setDigits(paste.split("")); inputRefs.current[5]?.focus(); } };
  const code = digits.join("");
  const submit = async () => {
    if(code.length < 6) return; setStatus("checking");
    await new Promise(r => setTimeout(r, 1400));
    if(code.startsWith("4")) { setStatus("success"); setShowConfetti(true); setTimeout(() => setShowConfetti(false), 5000); }
    else if(code === "000000") { setStatus("used"); }
    else { setStatus("error"); setTimeout(() => setStatus("idle"), 2500); }
  };
  return (
    <div style={{ display:"flex",flexDirection:"column",gap:"16px",animation:"slideIn .3s ease" }}>
      {showConfetti && (
        <div style={{ position:"fixed",inset:0,pointerEvents:"none",zIndex:200,overflow:"hidden" }}>
          {Array.from({length:60}).map((_,i) => {
            const colors = ["#c8860a","#e8a820","#4caf50","#5b8dee","#e05599","#fff8e7","#ff6b6b"];
            const color = colors[i % colors.length]; const left = Math.random()*100; const delay = Math.random()*2; const dur = 2.5 + Math.random()*2; const size = 6 + Math.random()*8;
            return (<div key={i} style={{ position:"absolute",top:"-10px",left:`${left}%`,width:`${size}px`,height:`${size}px`,background:color,borderRadius:i%3===0?"50%":"2px",animation:`confettiFall ${dur}s ${delay}s linear forwards`,transform:`rotate(${Math.random()*360}deg)` }} />);
          })}
        </div>
      )}
      <div style={{ background:t.prizeBg,border:`1px solid ${t.prizeBorder}`,borderRadius:"16px",padding:"18px 20px",textAlign:"center" }}>
        <div style={{ fontSize:"36px",marginBottom:"8px" }}>✉️</div>
        <div style={{ color:t.text,fontSize:"18px",fontFamily:"'Playfair Display',serif",fontWeight:"700",marginBottom:"4px" }}>Found the Envelope?</div>
        <div style={{ color:t.textMuted,fontSize:"13px",lineHeight:1.6 }}>Enter the 6-digit code inside to claim your prize. Each code can only be used once.</div>
      </div>
      {status === "success" ? (
        <div style={{ background:`linear-gradient(135deg,${t.green}18,${t.green}08)`,border:`2px solid ${t.green}`,borderRadius:"20px",padding:"28px 20px",textAlign:"center" }}>
          <div style={{ fontSize:"56px",marginBottom:"12px" }}>🏆</div>
          <div style={{ color:t.green,fontSize:"22px",fontFamily:"'Playfair Display',serif",fontWeight:"700",marginBottom:"6px" }}>You found it!</div>
          <div style={{ color:t.text,fontSize:"20px",fontFamily:"'Playfair Display',serif",fontWeight:"700",marginBottom:"4px" }}>{hunt.prize}</div>
          <div style={{ color:t.textMuted,fontSize:"13px",marginBottom:"24px" }}>Your claim has been confirmed. Payment instructions below.</div>
          <div style={{ background:t.surfaceBg,border:`1px solid ${t.surfaceBorder}`,borderRadius:"14px",padding:"18px",textAlign:"left",marginBottom:"16px" }}>
            <div style={{ color:t.accent,fontSize:"10px",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"14px",textAlign:"center" }}>💸 Choose Your Payment Method</div>
            {[{name:"Zelle",icon:"💙",color:"#4c8ef7",desc:"Send your Zelle registered phone or email to the Pirate to receive payment.",action:"Copy Zelle Info"},{name:"Venmo",icon:"💚",color:"#3d95ce",desc:"Send your Venmo @username to the Pirate to receive payment.",action:"Copy Venmo Info"}].map(method => (
              <div key={method.name} style={{ background:`${method.color}10`,border:`1px solid ${method.color}30`,borderRadius:"12px",padding:"14px 16px",marginBottom:"10px" }}>
                <div style={{ display:"flex",alignItems:"center",gap:"10px",marginBottom:"8px" }}><span style={{ fontSize:"22px" }}>{method.icon}</span><div style={{ color:t.text,fontSize:"15px",fontWeight:"700" }}>{method.name}</div></div>
                <div style={{ color:t.textMuted,fontSize:"12px",lineHeight:1.6,marginBottom:"10px" }}>{method.desc}</div>
                <button style={{ background:`${method.color}22`,border:`1px solid ${method.color}55`,color:method.color,padding:"7px 16px",borderRadius:"8px",cursor:"pointer",fontSize:"12px",fontWeight:"600",width:"100%" }}>{method.action}</button>
              </div>
            ))}
          </div>
          <div style={{ background:`${t.accent}10`,border:`1px solid ${t.accent}30`,borderRadius:"10px",padding:"12px 14px",textAlign:"left" }}>
            <div style={{ color:t.accent,fontSize:"11px",fontWeight:"700",marginBottom:"4px" }}>⏰ Payment Timeline</div>
            <div style={{ color:t.textMuted,fontSize:"12px",lineHeight:1.6 }}>Pirates using <strong style={{ color:t.text }}>FinderSeek Escrow</strong> pay instantly. Honor System Pirates have <strong style={{ color:t.text }}>48 hours</strong> to send payment.</div>
          </div>
        </div>
      ) : (
        <div style={{ background:t.surfaceBg,border:`1.5px solid ${t.surfaceBorder}`,borderRadius:"18px",padding:"24px 20px" }}>
          <div style={{ color:t.textSubtle,fontSize:"10px",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"16px",textAlign:"center" }}>Enter 6-Digit Code</div>
          <div style={{ display:"flex",gap:"8px",justifyContent:"center",marginBottom:"20px" }} onPaste={handlePaste}>
            {digits.map((d,i) => (
              <input key={i} ref={el=>inputRefs.current[i]=el} type="text" inputMode="numeric" maxLength={1} value={d} onChange={e=>handleDigit(i,e.target.value)} onKeyDown={e=>handleKeyDown(i,e)}
                style={{ width:"44px",height:"56px",textAlign:"center",fontSize:"24px",fontWeight:"700",fontFamily:"'DM Mono',monospace",background:status==="error"?`${t.danger}18`:d?`${t.accent}15`:t.inputBg,border:`2px solid ${status==="error"?t.danger:d?t.accent:t.inputBorder}`,borderRadius:"12px",color:t.text,outline:"none",transition:"border-color .15s,background .15s",boxShadow:d?`0 0 12px ${t.accent}33`:"none" }} />
            ))}
          </div>
          {status==="error"&&<div style={{ background:`${t.danger}15`,border:`1px solid ${t.danger}40`,borderRadius:"10px",padding:"10px 14px",marginBottom:"14px",textAlign:"center",color:t.danger,fontSize:"13px",fontWeight:"600" }}>❌ Code not found. Double-check and try again.</div>}
          {status==="used"&&<div style={{ background:`${t.accent}15`,border:`1px solid ${t.accent}40`,borderRadius:"10px",padding:"10px 14px",marginBottom:"14px",textAlign:"center",color:t.accent,fontSize:"13px",fontWeight:"600" }}>⚠️ This code has already been claimed.</div>}
          <button onClick={submit} disabled={code.length<6||status==="checking"} style={{ width:"100%",background:code.length===6?`linear-gradient(135deg,${t.accent},${t.accentHover})`:t.inputBg,border:"none",borderRadius:"12px",padding:"15px",color:code.length===6?"#fff":t.textMuted,fontSize:"15px",fontWeight:"700",cursor:code.length===6?"pointer":"not-allowed",transition:"all .2s",boxShadow:code.length===6?`0 4px 20px ${t.accent}55`:"none",display:"flex",alignItems:"center",justifyContent:"center",gap:"8px" }}>
            {status==="checking"?<><span style={{ animation:"spin 1s linear infinite",display:"inline-block" }}>⏳</span> Checking…</>:"Claim Treasure →"}
          </button>
          <div style={{ marginTop:"14px",color:t.textDim,fontSize:"11px",textAlign:"center" }}>Tip: You can paste the full 6-digit code directly</div>
        </div>
      )}
      <div style={{ background:t.surfaceBg,border:`1px solid ${t.surfaceBorder}`,borderRadius:"12px",padding:"14px 16px" }}>
        <div style={{ color:t.accent,fontSize:"10px",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"10px" }}>How Claiming Works</div>
        {[["1","Find the hidden envelope in your city"],["2","Open it — there's a 6-digit code inside"],["3","Enter the code here to claim your prize"],["4","Receive payment via Zelle or Venmo"]].map(([num,text]) => (
          <div key={num} style={{ display:"flex",alignItems:"center",gap:"12px",padding:"6px 0",borderBottom:`1px solid ${t.divider}` }}>
            <div style={{ width:"22px",height:"22px",borderRadius:"50%",background:`${t.accent}20`,border:`1px solid ${t.accent}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,color:t.accent,fontSize:"11px",fontWeight:"700" }}>{num}</div>
            <div style={{ color:t.textMuted,fontSize:"13px" }}>{text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Admin panel (condensed)
function AdminPanel({ t, isDark, onPublish, simOffset, setSimOffset }) {
  const [form,setForm]=useState({address:"",hidingSpot:"",landmarks:"",areaDescription:"",hidingMethod:"",redHerrings:"",prizeDescription:"",weekOf:""});
  const [photoPreview,setPhotoPreview]=useState(null);
  const [photoFile,setPhotoFile]=useState(null);
  const [generating,setGenerating]=useState(false);
  const [generated,setGenerated]=useState(null);
  const [editingId,setEditingId]=useState(null);
  const [editText,setEditText]=useState("");
  const [status,setStatus]=useState("");
  const [published,setPublished]=useState(false);
  const fileRef=useRef();
  const totalHours=Math.round((HUNT_END-HUNT_START)/3600000);
  const simNow=simOffset!==null?new Date(HUNT_START.getTime()+simOffset*3600000):new Date();

  const fi=(key,label,ph,multi=false)=>(
    <div style={{ marginBottom:"12px" }}>
      <label style={{ display:"block",color:t.textSubtle,fontSize:"10px",letterSpacing:"1.5px",textTransform:"uppercase",marginBottom:"5px" }}>{label}</label>
      {multi
        ?<textarea value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))} placeholder={ph} rows={2} style={{ width:"100%",background:t.inputBg,border:`1px solid ${t.inputBorder}`,borderRadius:"8px",padding:"9px 12px",color:t.text,fontSize:"13px",resize:"vertical",outline:"none",fontFamily:"'DM Sans',sans-serif" }} onFocus={e=>e.target.style.borderColor=t.inputFocus} onBlur={e=>e.target.style.borderColor=t.inputBorder} />
        :<input value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))} placeholder={ph} style={{ width:"100%",background:t.inputBg,border:`1px solid ${t.inputBorder}`,borderRadius:"8px",padding:"9px 12px",color:t.text,fontSize:"13px",outline:"none",fontFamily:"'DM Sans',sans-serif" }} onFocus={e=>e.target.style.borderColor=t.inputFocus} onBlur={e=>e.target.style.borderColor=t.inputBorder} />
      }
    </div>
  );

  const generate=async()=>{
    if(!form.address||!form.hidingSpot||!form.landmarks){setStatus("⚠️ Fill in Address, Hiding Spot, and Landmarks first.");return;}
    setGenerating(true);setStatus("");setGenerated(null);
    const prompt=`You are writing clues for FinderSeek city treasure hunt. Write exactly 6 clues.
Location: ${form.address}
Hiding Spot: ${form.hidingSpot}
Landmarks: ${form.landmarks}
Area: ${form.areaDescription||"n/a"}
Method: ${form.hidingMethod||"n/a"}
Red Herrings: ${form.redHerrings||"none"}
Clue 1 (Fri FREE): Very vague, poetic, no street names.
Clue 2 (Sat FREE): General area/landmark type only.
Clue 3 (Sun FREE): Specific feature type without naming it.
Clue 4 (Mon FREE): Named landmark hinted cryptically.
Clue 5 (Tue PRO): Clear directional with named landmark.
Clue 6 (Wed PRO): Within 10-20 feet, nearly gives it away.
Respond ONLY with JSON array, no markdown: [{"id":1,"clue":"..."},...,{"id":6,"clue":"..."}]`;
    try {
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,messages:[{role:"user",content:prompt}]})});
      const data=await res.json();
      const raw=data.content?.find(b=>b.type==="text")?.text||"";
      setGenerated(JSON.parse(raw.replace(/```json|```/g,"").trim()));
      setStatus("✅ Clues generated! Review and publish.");
    } catch { setStatus("❌ Generation failed. Try again."); }
    finally { setGenerating(false); }
  };

  const publish=()=>{
    if(!generated){setStatus("⚠️ Generate clues first.");return;}
    const days=["Friday","Saturday","Sunday","Monday","Tuesday","Wednesday"],dates=["Mar 6","Mar 7","Mar 8","Mar 9","Mar 10","Mar 11"];
    const newClues=[...generated.map((c,i)=>({id:i+1,day:days[i],date:dates[i],tier:i<4?"free":"pro",text:c.clue})),{id:7,day:"Thursday",date:"Mar 12",tier:"pro",text:"",isPhoto:true,photoUrl:photoPreview||null}];
    onPublish({clues:newClues,prize:form.prizeDescription||DEFAULT_HUNT.prize,weekOf:form.weekOf||DEFAULT_HUNT.weekOf});
    setPublished(true);setStatus("🎉 Hunt published!");
  };

  const dayLabels=["Friday (Free)","Saturday (Free)","Sunday (Free)","Monday (Free)","Tuesday (Pro)","Wednesday (Pro)"];

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:"14px" }}>
      <div style={{ background:t.panelBg,border:`1.5px solid ${t.accent}`,borderRadius:"16px",padding:"16px 20px",position:"relative",overflow:"hidden" }}>
        <div style={{ position:"absolute",top:0,left:0,right:0,height:"3px",background:`linear-gradient(90deg,${t.accent},${t.accentHover},${t.accent})` }} />
        <div style={{ color:t.text,fontSize:"16px",fontFamily:"'Playfair Display',serif",fontWeight:"700",marginBottom:"4px" }}>🔐 Admin Panel</div>
        <div style={{ color:t.textMuted,fontSize:"12px" }}>Enter location → generate clues → publish.</div>
      </div>

      {/* Time simulator */}
      <div style={{ background:t.simBg,border:`1.5px solid ${t.simBorder}`,borderRadius:"12px",padding:"16px 18px" }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px" }}>
          <div style={{ color:t.blue,fontSize:"10px",letterSpacing:"2px",textTransform:"uppercase" }}>🧪 Time Simulator</div>
          <button onClick={()=>setSimOffset(null)} style={{ background:"transparent",border:`1px solid ${t.inputBorder}`,color:t.textMuted,fontSize:"10px",padding:"2px 8px",borderRadius:"6px",cursor:"pointer" }}>Real Time</button>
        </div>
        <div style={{ color:t.text,fontSize:"12px",marginBottom:"8px",fontFamily:"'DM Mono',monospace" }}>
          <strong style={{ color:t.accent }}>{simNow.toLocaleString("en-US",{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</strong>
        </div>
        <input type="range" min={0} max={totalHours} step={0.25} value={simOffset??0} onChange={e=>setSimOffset(Number(e.target.value))} style={{ width:"100%",accentColor:t.accent,cursor:"pointer",marginBottom:"6px" }} />
        <div style={{ display:"flex",gap:"5px",flexWrap:"wrap" }}>
          {DEFAULT_CLUES.map(c=>{ const hrs=(new Date(REVEAL_DATES[c.id])-HUNT_START)/3600000; return (
            <button key={c.id} onClick={()=>setSimOffset(hrs+0.1)} style={{ background:`${c.tier==="pro"?t.accent:t.blue}18`,border:`1px solid ${c.tier==="pro"?t.accent:t.blue}44`,color:c.tier==="pro"?t.accent:t.blue,fontSize:"10px",padding:"2px 8px",borderRadius:"6px",cursor:"pointer",fontWeight:"600" }}>{c.day.slice(0,3)}</button>
          );})}
        </div>
      </div>

      {/* Schedule */}
      <div style={{ background:t.panelBg,border:`1px solid ${t.panelBorder}`,borderRadius:"12px",padding:"14px 18px" }}>
        <div style={{ color:t.accent,fontSize:"10px",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"10px" }}>📅 Release Schedule</div>
        {DEFAULT_CLUES.map(c=>{ const rev=isRevealed(c.id,simNow),next=nextReveal(simNow)&&new Date(REVEAL_DATES[c.id]).getTime()===nextReveal(simNow).getTime(); return (
          <div key={c.id} style={{ display:"flex",alignItems:"center",gap:"10px",padding:"5px 0",borderBottom:`1px solid ${t.divider}` }}>
            <div style={{ width:"7px",height:"7px",borderRadius:"50%",flexShrink:0,background:rev?t.green:next?t.accent:t.textDim,boxShadow:rev?`0 0 6px ${t.green}88`:next?`0 0 6px ${t.accent}88`:"none" }} />
            <span style={{ flex:1,color:rev?t.text:t.textMuted,fontSize:"12px" }}>Clue {c.id} · {c.day}{c.isPhoto?" 📸":""}</span>
            {next&&<span style={{ background:`${t.accent}20`,border:`1px solid ${t.accent}`,color:t.accent,fontSize:"9px",fontWeight:"700",padding:"1px 6px",borderRadius:"6px" }}>NEXT</span>}
            <span style={{ color:rev?t.green:t.textDim,fontSize:"10px" }}>{rev?"✓ Live":`8AM ${c.day.slice(0,3)}`}</span>
            <span style={{ color:c.tier==="pro"?t.accent:t.textSubtle,fontSize:"9px",letterSpacing:"1px" }}>{c.tier==="pro"?"PRO":"FREE"}</span>
          </div>
        );})}
      </div>

      {/* Hunt + Location */}
      <div style={{ background:t.panelBg,border:`1px solid ${t.panelBorder}`,borderRadius:"12px",padding:"14px 18px" }}>
        <div style={{ color:t.accent,fontSize:"10px",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"10px" }}>📋 Hunt Details</div>
        {fi("weekOf","Week Label","e.g. March 6–13, 2026")}
        {fi("prizeDescription","Prize","e.g. $300 Cash + $50 Gift Card")}
      </div>
      <div style={{ background:t.panelBg,border:`1px solid ${t.panelBorder}`,borderRadius:"12px",padding:"14px 18px" }}>
        <div style={{ color:t.accent,fontSize:"10px",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"10px" }}>📍 Location</div>
        {fi("address","Address / Intersection *","e.g. Corner of Main St & 3rd Ave")}
        {fi("hidingSpot","Exact Hiding Spot *","e.g. Taped under middle bench armrest",true)}
        {fi("landmarks","Nearby Landmarks *","e.g. Blue heron mural, dry fountain",true)}
        {fi("areaDescription","Area Description","e.g. Busy plaza, quiet park path",true)}
        {fi("hidingMethod","Hiding Method","e.g. Magnetic box, ziplock bag")}
        {fi("redHerrings","Red Herrings","e.g. There are two fountains — not the big one",true)}
      </div>

      {/* Photo upload */}
      <div style={{ background:t.panelBg,border:`1px solid ${t.panelBorder}`,borderRadius:"12px",padding:"14px 18px" }}>
        <div style={{ color:t.accent,fontSize:"10px",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"4px" }}>📸 Thursday Photo</div>
        <div style={{ color:t.textMuted,fontSize:"12px",marginBottom:"10px" }}>Shown to Pro members Thursday 8 AM.</div>
        <input ref={fileRef} type="file" accept="image/*" onChange={e=>{ const f=e.target.files[0];if(!f)return;setPhotoFile(f);const r=new FileReader();r.onload=ev=>setPhotoPreview(ev.target.result);r.readAsDataURL(f); }} style={{ display:"none" }} />
        {photoPreview?(
          <div style={{ borderRadius:"10px",overflow:"hidden",border:`1px solid ${t.accent}` }}>
            <img src={photoPreview} alt="preview" style={{ width:"100%",maxHeight:"160px",objectFit:"cover",display:"block" }} />
            <div style={{ background:`${t.accent}18`,padding:"7px 12px",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              <span style={{ color:t.accent,fontSize:"11px",fontWeight:"600" }}>📸 {photoFile?.name||"Photo"}</span>
              <div style={{ display:"flex",gap:"6px" }}>
                <button onClick={()=>fileRef.current.click()} style={{ background:t.accent,color:"#fff",border:"none",borderRadius:"5px",padding:"2px 8px",cursor:"pointer",fontSize:"11px" }}>Replace</button>
                <button onClick={()=>{setPhotoFile(null);setPhotoPreview(null);}} style={{ background:"transparent",border:`1px solid ${t.inputBorder}`,color:t.textMuted,borderRadius:"5px",padding:"2px 6px",cursor:"pointer",fontSize:"13px" }}>×</button>
              </div>
            </div>
          </div>
        ):(
          <button onClick={()=>fileRef.current.click()} style={{ width:"100%",background:"transparent",border:`2px dashed ${t.inputBorder}`,borderRadius:"10px",padding:"20px",cursor:"pointer",textAlign:"center",transition:"all .2s" }} onMouseEnter={e=>{e.currentTarget.style.borderColor=t.accent;e.currentTarget.style.background=`${t.accent}08`;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=t.inputBorder;e.currentTarget.style.background="transparent";}}>
            <div style={{ fontSize:"24px",marginBottom:"4px" }}>📷</div>
            <div style={{ color:t.textSubtle,fontSize:"13px",fontWeight:"600" }}>Click to upload Thursday photo</div>
            <div style={{ color:t.textDim,fontSize:"11px",marginTop:"2px" }}>JPG, PNG, WEBP</div>
          </button>
        )}
      </div>

      <button onClick={generate} disabled={generating} style={{ background:generating?`${t.accent}55`:`linear-gradient(135deg,${t.accent},${t.accentHover})`,color:"#fff",border:"none",borderRadius:"12px",padding:"14px",fontSize:"15px",fontWeight:"700",cursor:generating?"not-allowed":"pointer",letterSpacing:"1px",boxShadow:generating?"none":`0 4px 24px ${t.accent}44`,display:"flex",alignItems:"center",justifyContent:"center",gap:"10px" }}>
        {generating?<><span style={{ animation:"spin 1s linear infinite",display:"inline-block" }}>⏳</span>Generating…</>:"✨ Generate 6 Clues with AI"}
      </button>

      {status&&<div style={{ background:status.startsWith("❌")?t.dangerBg:status.startsWith("⚠️")?`${t.accent}12`:`${t.green}12`,border:`1px solid ${status.startsWith("❌")?t.danger:status.startsWith("⚠️")?t.accent:t.green}`,borderRadius:"10px",padding:"11px 14px",color:status.startsWith("❌")?t.danger:status.startsWith("⚠️")?t.accent:t.green,fontSize:"13px" }}>{status}</div>}

      {generated&&(
        <div style={{ background:t.panelBg,border:`1px solid ${t.green}44`,borderRadius:"12px",padding:"14px 18px" }}>
          <div style={{ color:t.green,fontSize:"10px",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"10px" }}>✅ Review & Edit</div>
          <div style={{ display:"flex",flexDirection:"column",gap:"9px" }}>
            {generated.map((c,i)=>(
              <div key={c.id} style={{ background:isDark?"#111":"#fafaf5",border:`1px solid ${i>=4?`${t.accent}55`:t.inputBorder}`,borderRadius:"9px",padding:"11px 14px" }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"6px" }}>
                  <div style={{ display:"flex",gap:"6px",alignItems:"center" }}>
                    <span style={{ background:i>=4?`${t.accent}20`:`${t.text}0a`,border:`1px solid ${i>=4?t.accent:t.inputBorder}`,color:i>=4?t.accent:t.textMuted,fontSize:"9px",letterSpacing:"1.5px",textTransform:"uppercase",padding:"2px 7px",borderRadius:"10px" }}>{i>=4?"⭐ PRO":"FREE"}</span>
                    <span style={{ color:t.textSubtle,fontSize:"11px" }}>{dayLabels[i]}</span>
                  </div>
                  {editingId===c.id
                    ?<div style={{ display:"flex",gap:"5px" }}><button onClick={()=>{setGenerated(p=>p.map(x=>x.id===c.id?{...x,clue:editText}:x));setEditingId(null);}} style={{ background:t.green,color:"#fff",border:"none",borderRadius:"5px",padding:"2px 8px",cursor:"pointer",fontSize:"11px",fontWeight:"600" }}>Save</button><button onClick={()=>setEditingId(null)} style={{ background:"transparent",border:`1px solid ${t.inputBorder}`,color:t.textMuted,borderRadius:"5px",padding:"2px 7px",cursor:"pointer",fontSize:"11px" }}>✕</button></div>
                    :<button onClick={()=>{setEditingId(c.id);setEditText(c.clue);}} style={{ background:"transparent",border:`1px solid ${t.inputBorder}`,color:t.textSubtle,borderRadius:"5px",padding:"2px 8px",cursor:"pointer",fontSize:"10px" }}>✏️</button>
                  }
                </div>
                {editingId===c.id
                  ?<textarea value={editText} onChange={e=>setEditText(e.target.value)} rows={2} style={{ width:"100%",background:t.inputBg,border:`1px solid ${t.inputFocus}`,borderRadius:"7px",padding:"8px 10px",color:t.text,fontSize:"13px",lineHeight:"1.5",resize:"vertical",outline:"none",fontFamily:"'DM Sans',sans-serif" }} />
                  :<p style={{ color:t.textClue,fontSize:"13px",lineHeight:"1.6",fontFamily:"'Playfair Display',serif",fontStyle:"italic",margin:0 }}>"{c.clue}"</p>
                }
              </div>
            ))}
          </div>
          <button onClick={publish} style={{ marginTop:"12px",width:"100%",background:`linear-gradient(135deg,${t.green},#66bb6a)`,color:"#fff",border:"none",borderRadius:"10px",padding:"13px",fontSize:"14px",fontWeight:"700",cursor:"pointer",boxShadow:`0 4px 20px ${t.green}44` }}>
            {published?"🔄 Re-Publish":"🚀 Publish This Week's Hunt"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── ROOT APP ──────────────────────────────────────────────────────────────
export default function FinderSeekApp() {
  // Auth state
  const [authScreen, setAuthScreen] = useState("browse"); // browse|welcome|email|login|phone|google|apple|setup|app
  const [user,       setUser]       = useState(null);  // null = not logged in
  const [isGuest,    setIsGuest]    = useState(false);

  // App state
  const [isPro,      setIsPro]      = useState(false);
  const [activeTab,  setActiveTab]  = useState("hunt");
  const [showModal,  setShowModal]  = useState(false);
  const [isDark,     setIsDark]     = useState(true);
  const [isAdmin,    setIsAdmin]    = useState(false);
  const [adminCode,  setAdminCode]  = useState("");
  const [adminErr,   setAdminErr]   = useState("");
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [hunt,       setHunt]       = useState(DEFAULT_HUNT);
  const [simOffset,  setSimOffset]  = useState(null);
  const [,setTick]                  = useState(0);
  const [editingProfile, setEditingProfile] = useState(false);
  const [selectedHunt, setSelectedHunt] = useState(null); // hunt clicked from browser

  useEffect(()=>{ const id=setInterval(()=>setTick(n=>n+1),1000); return ()=>clearInterval(id); },[]);

  const t = isDark ? T.dark : T.light;
  const now = simOffset!==null ? new Date(HUNT_START.getTime()+simOffset*3600000) : new Date();
  const huntOver = now>=HUNT_END;
  const revealedCount = hunt.clues.filter(c=>isRevealed(c.id,now)).length;
  const freeClues = hunt.clues.filter(c=>c.tier==="free");
  const proClues  = hunt.clues.filter(c=>c.tier==="pro");

  const handleAdminLogin = () => {
    if(adminCode==="findseek2026"){setIsAdmin(true);setShowAdminLogin(false);setActiveTab("admin");setAdminErr("");}
    else setAdminErr("Incorrect code.");
  };

  const tabs = [["hunt","🏴‍☠️ Hunt"],["map","🗺️ Map"],["leaderboard","🏆 Hunters"],...(isAdmin?[["admin","🔐 Admin"]]:[])] ;

  // ── Handle hunt selection from browser ──
  const handleSelectHunt = (h) => {
    setSelectedHunt(h);
    setHunt({ weekOf: h.weekOf, prize: h.prize, clues: h.clues });
    if (user) {
      // Already logged in — go straight to hunt
      setAuthScreen("app");
      setActiveTab("hunt");
    } else {
      // Not logged in — show auth
      setAuthScreen("welcome");
    }
  };

  // After auth completes, go to hunt
  const handleAuthDone = (u) => {
    setUser(u);
    setAuthScreen("setup");
  };
  const handleSetupDone = (u) => {
    setUser(u);
    setAuthScreen("app");
    setActiveTab("hunt");
    setEditingProfile(false);
  };

  // ── AUTH ROUTING ──
  if(authScreen==="google")  return <AuthSocial provider="google" onBack={()=>setAuthScreen("welcome")} onDone={handleAuthDone} t={t} />;
  if(authScreen==="apple")   return <AuthSocial provider="apple"  onBack={()=>setAuthScreen("welcome")} onDone={handleAuthDone} t={t} />;
  if(authScreen==="phone")   return <AuthPhone  onBack={()=>setAuthScreen("welcome")} onDone={handleAuthDone} t={t} />;
  if(authScreen==="email")   return <AuthEmail  mode="email" onBack={()=>setAuthScreen("welcome")} onDone={handleAuthDone} t={t} />;
  if(authScreen==="login")   return <AuthEmail  mode="login" onBack={()=>setAuthScreen("welcome")} onDone={handleAuthDone} t={t} />;
  if(authScreen==="setup"||editingProfile) return <ProfileSetup user={user||{}} onDone={handleSetupDone} t={t} />;
  if(authScreen==="welcome") return (
    <AuthWelcome
      onMethod={m=>setAuthScreen(m)}
      onGuest={()=>{setIsGuest(true);setUser({name:"Guest",isGuest:true});setAuthScreen("app");setActiveTab("hunt");}}
      onBack={()=>setAuthScreen("browse")}
      t={t} isDark={isDark}
    />
  );
  if(authScreen==="browse") return (
    <HuntBrowser onSelectHunt={handleSelectHunt} t={t} isDark={isDark} />
  );

  // ── MAIN APP ──
  return (
    <div style={{ minHeight:"100vh",background:t.bg,fontFamily:"'DM Sans',sans-serif",color:t.text,transition:"background .3s,color .3s" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,400&family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        @keyframes pulse{0%,100%{opacity:.4;transform:translate(-50%,-50%) scale(1)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.35)}}
        @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
        @keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
        @keyframes newPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.7;transform:scale(1.08)}}
        @keyframes slideIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes confettiFall{0%{transform:translateY(-10px) rotate(0deg);opacity:1}100%{transform:translateY(100vh) rotate(720deg);opacity:0}}
        textarea,input{color-scheme:${isDark?"dark":"light"};}
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ background:t.headerBg,borderBottom:`1px solid ${t.headerBorder}`,padding:"0 20px",position:"sticky",top:0,zIndex:100,backdropFilter:"blur(14px)" }}>
        <div style={{ maxWidth:"520px",margin:"0 auto",padding:"12px 0",display:"flex",justifyContent:"space-between",alignItems:"center",gap:"10px" }}>
          {/* Logo */}
          <div style={{ display:"flex",alignItems:"center",gap:"9px",flexShrink:0 }}>
            <div style={{ width:"34px",height:"34px",borderRadius:"10px",background:`linear-gradient(135deg,${t.accent},${t.accentHover})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"18px",boxShadow:`0 2px 12px ${t.accent}44`,flexShrink:0 }}>🔍</div>
            <div>
              <div style={{ fontSize:"18px",fontFamily:"'Playfair Display',serif",fontWeight:"700",lineHeight:1.1,background:t.shimmer,backgroundSize:"200% auto",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",animation:"shimmer 5s linear infinite" }}>
                Finder<span style={{ fontStyle:"italic" }}>Seek</span>
              </div>
              <div style={{ color:t.textDim,fontSize:"9px",letterSpacing:"0.8px" }}>finderseek.com</div>
            </div>
          </div>
          {/* Right controls */}
          <div style={{ display:"flex",alignItems:"center",gap:"8px" }}>
            {simOffset!==null&&<span style={{ background:`${t.blue}20`,border:`1px solid ${t.blue}`,color:t.blue,fontSize:"9px",fontWeight:"700",padding:"2px 7px",borderRadius:"8px",letterSpacing:"1px" }}>SIM</span>}
            <ThemeToggle isDark={isDark} onToggle={()=>setIsDark(d=>!d)} t={t} />
            {!isAdmin&&<button onClick={()=>setShowAdminLogin(true)} style={{ background:"transparent",border:`1px solid ${t.inputBorder}`,color:t.textMuted,fontSize:"11px",padding:"5px 10px",borderRadius:"20px",cursor:"pointer" }}>🔐</button>}
            {isPro
              ?<span style={{ background:`linear-gradient(135deg,${t.accent},${t.accentHover})`,color:"#fff",fontSize:"11px",fontWeight:"700",padding:"5px 12px",borderRadius:"20px",letterSpacing:"1px",whiteSpace:"nowrap" }}>⭐ PRO</span>
              :<button onClick={()=>setShowModal(true)} style={{ background:"transparent",border:`1.5px solid ${t.accent}`,color:t.accent,fontSize:"11px",fontWeight:"600",padding:"5px 12px",borderRadius:"20px",cursor:"pointer",whiteSpace:"nowrap" }}>UPGRADE</button>
            }
            {user&&(
              <AccountMenu user={user} isPro={isPro} t={t} isDark={isDark}
                onUpgrade={()=>setShowModal(true)}
                onLogout={()=>{setUser(null);setIsGuest(false);setIsPro(false);setAuthScreen("browse");setSelectedHunt(null);}}
                onEditProfile={()=>setEditingProfile(true)}
              />
            )}
          </div>
        </div>
        {/* Progress bar */}
        <div style={{ height:"2px",background:isDark?"#1a1a14":"#e8e0c8",position:"relative" }}>
          <div style={{ position:"absolute",left:0,top:0,height:"100%",width:`${(revealedCount/hunt.clues.length)*100}%`,background:`linear-gradient(90deg,${t.accent},${t.green})`,transition:"width 1s" }} />
        </div>
        {/* Tabs */}
        <div style={{ maxWidth:"520px",margin:"0 auto",display:"flex",borderTop:`1px solid ${t.headerBorder}` }}>
          {tabs.map(([id,label])=>(
            <button key={id} onClick={()=>setActiveTab(id)} style={{ flex:1,padding:"10px 4px",background:"transparent",border:"none",borderBottom:activeTab===id?`2.5px solid ${id==="admin"?t.green:t.accent}`:"2.5px solid transparent",color:activeTab===id?(id==="admin"?t.green:t.accent):t.textMuted,fontSize:"11px",fontWeight:activeTab===id?"700":"400",cursor:"pointer",transition:"all .18s",whiteSpace:"nowrap" }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth:"520px",margin:"0 auto",padding:"20px 16px 52px" }}>

        {/* HUNT TAB */}
        {activeTab==="hunt"&&(
          <div style={{ display:"flex",flexDirection:"column",gap:"16px",animation:"slideIn .3s ease" }}>
            {huntOver?(
              <div style={{ background:t.prizeBg,border:`2px solid ${t.accent}`,borderRadius:"20px",padding:"32px 24px",textAlign:"center",position:"relative",overflow:"hidden" }}>
                <div style={{ position:"absolute",inset:0,background:`radial-gradient(circle at 30% 20%,${t.accent}12,transparent 60%)`,pointerEvents:"none" }} />
                <div style={{ fontSize:"48px",marginBottom:"12px" }}>🏁</div>
                <div style={{ color:t.text,fontSize:"22px",fontFamily:"'Playfair Display',serif",fontWeight:"700",marginBottom:"8px" }}>Hunt Has Ended</div>
                <div style={{ color:t.textMuted,fontSize:"14px" }}>Check back Friday for the next hunt!</div>
              </div>
            ):(
              <>
                {/* Prize hero card */}
                <div style={{ background:t.prizeBg,border:`2px solid ${t.accent}`,borderRadius:"20px",padding:"24px",position:"relative",overflow:"hidden" }}>
                  <div style={{ position:"absolute",inset:0,background:`radial-gradient(circle at 80% 20%,${t.accent}18,transparent 50%)`,pointerEvents:"none" }} />
                  <div style={{ position:"absolute",top:"-20px",right:"-20px",fontSize:"80px",opacity:.08,transform:"rotate(15deg)",pointerEvents:"none" }}>💰</div>
                  <div style={{ position:"relative" }}>
                    <div style={{ display:"flex",alignItems:"center",gap:"8px",marginBottom:"8px" }}>
                      <span style={{ fontSize:"20px" }}>🏴‍☠️</span>
                      <span style={{ color:t.accent,fontSize:"10px",letterSpacing:"3px",textTransform:"uppercase",fontWeight:"700" }}>This Week's Treasure</span>
                    </div>
                    <div style={{ color:t.text,fontSize:"32px",fontFamily:"'Playfair Display',serif",fontWeight:"700",marginBottom:"4px" }}>{hunt.prize}</div>
                    <div style={{ color:t.textMuted,fontSize:"12px" }}>{hunt.weekOf} · Hidden somewhere in your city</div>
                  </div>
                </div>

                {/* Countdown timer — dramatic */}
                <div style={{ background:`linear-gradient(135deg,${isDark?"#1a0500":"#fff5e6"},${isDark?"#2a1000":"#ffe8cc"})`,border:`2px solid ${t.accent}`,borderRadius:"16px",padding:"20px",textAlign:"center",position:"relative",overflow:"hidden",boxShadow:`0 0 40px ${t.accent}15` }}>
                  <div style={{ position:"absolute",inset:0,background:`radial-gradient(circle at 50% 50%,${t.accent}0d,transparent 70%)`,pointerEvents:"none" }} />
                  <div style={{ position:"relative" }}>
                    <div style={{ color:t.accent,fontSize:"11px",letterSpacing:"3px",textTransform:"uppercase",marginBottom:"10px",fontWeight:"600" }}>⏰ Hunt Ends In</div>
                    <div style={{ color:t.text,fontSize:"34px",fontFamily:"'DM Mono',monospace",fontWeight:"700",letterSpacing:"3px",textShadow:isDark?`0 0 20px ${t.accent}44`:"none" }}>{fmtDHMS(HUNT_END-now)}</div>
                    <div style={{ color:t.textDate,fontSize:"11px",marginTop:"8px" }}>Friday, March 13 · 10:00 AM</div>
                  </div>
                </div>

                {/* Next clue + progress row */}
                <div style={{ display:"flex",gap:"10px" }}>
                  {/* Next clue mini */}
                  {(()=>{
                    const next=nextReveal(now);
                    if(!next) return null;
                    const ms=next-now;
                    const clueId=Object.entries(REVEAL_DATES).find(([,d])=>new Date(d).getTime()===next.getTime())?.[0];
                    const clue=DEFAULT_CLUES.find(c=>c.id===Number(clueId));
                    if(!clue) return null;
                    return (
                      <div style={{ flex:1,background:t.nextBg,border:`1.5px solid ${t.nextBorder}`,borderRadius:"14px",padding:"14px 16px" }}>
                        <div style={{ color:t.blue,fontSize:"9px",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"4px" }}>{clue.tier==="free"?"Next Free":"⭐ Next Pro"}</div>
                        <div style={{ color:t.text,fontSize:"12px",fontWeight:"600",marginBottom:"6px" }}>Clue {clue.id} · {clue.day}</div>
                        <div style={{ color:t.text,fontSize:"18px",fontFamily:"'DM Mono',monospace",fontWeight:"700",letterSpacing:"1px" }}>{fmtHMS(ms)}</div>
                      </div>
                    );
                  })()}
                  {/* Progress */}
                  <div style={{ flex:1,background:t.surfaceBg,border:`1px solid ${t.surfaceBorder}`,borderRadius:"14px",padding:"14px 16px",display:"flex",flexDirection:"column",justifyContent:"center" }}>
                    <div style={{ color:t.textSubtle,fontSize:"9px",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"8px" }}>Clues Unlocked</div>
                    <div style={{ display:"flex",gap:"4px",marginBottom:"6px" }}>
                      {(()=>{const dc=["#4caf50","#5b8dee","#9b59b6","#e8c840","#e87c33","#e05555","#e05555"];return hunt.clues.map((c,i)=>(
                        <div key={i} style={{ flex:1,height:"6px",borderRadius:"3px",background:isRevealed(c.id,now)?dc[i]:isDark?"#1a1a14":"#e8e0c8",transition:"background .5s" }} />
                      ))})()}
                    </div>
                    <div style={{ color:t.text,fontSize:"16px",fontWeight:"700",fontFamily:"'DM Mono',monospace" }}>{revealedCount}<span style={{ color:t.textMuted,fontSize:"11px",fontWeight:"400" }}> / {hunt.clues.length}</span></div>
                  </div>
                </div>
              </>
            )}

            {/* Free clues section */}
            <div>
              <div style={{ display:"flex",alignItems:"center",gap:"8px",marginBottom:"12px",paddingLeft:"2px" }}>
                <span style={{ fontSize:"16px" }}>🗺️</span>
                <span style={{ color:t.textSubtle,fontSize:"11px",letterSpacing:"2px",textTransform:"uppercase",fontWeight:"600" }}>Free Clues · Fri–Mon</span>
              </div>
              <div style={{ display:"flex",flexDirection:"column",gap:"10px" }}>{freeClues.map(c=><ClueCard key={c.id} clue={c} isPro={isPro} now={now} t={t} />)}</div>
            </div>

            {/* Pro clues section */}
            <div>
              <div style={{ display:"flex",alignItems:"center",gap:"8px",marginBottom:"12px",paddingLeft:"2px" }}>
                <span style={{ fontSize:"16px" }}>⭐</span>
                <span style={{ color:t.accent,fontSize:"11px",letterSpacing:"2px",textTransform:"uppercase",fontWeight:"600" }}>Pro Clues · Tue–Thu</span>
              </div>
              <div style={{ display:"flex",flexDirection:"column",gap:"10px" }}>{proClues.map(c=><ClueCard key={c.id} clue={c} isPro={isPro} now={now} t={t} />)}</div>
            </div>

            {!isPro&&<UpgradeBanner onUpgrade={()=>setShowModal(true)} t={t} />}

            {/* How it works — compact */}
            <div style={{ background:t.surfaceBg,border:`1px solid ${t.surfaceBorder}`,borderRadius:"16px",padding:"18px 20px" }}>
              <div style={{ display:"flex",alignItems:"center",gap:"8px",marginBottom:"12px" }}>
                <span style={{ fontSize:"16px" }}>📜</span>
                <span style={{ color:t.textSubtle,fontSize:"10px",letterSpacing:"2px",textTransform:"uppercase",fontWeight:"600" }}>How It Works</span>
              </div>
              {[["🌱","Friday","Treasure planted · Clue 1 drops"],["📜","Daily","New clue each morning at 8 AM"],["⭐","Tue–Thu","3 extra Pro clues + photo"],["🏁","Fri 10AM","Hunt ends · prize rolls over"]].map(([icon,time,desc])=>(
                <div key={time} style={{ display:"flex",gap:"12px",marginBottom:"10px",alignItems:"center" }}>
                  <span style={{ fontSize:"16px",width:"24px",textAlign:"center" }}>{icon}</span>
                  <div>
                    <span style={{ color:t.accent,fontSize:"12px",fontWeight:"700" }}>{time}</span>
                    <span style={{ color:t.textMuted,fontSize:"12px" }}> — {desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MAP TAB */}
        {activeTab==="map"&&(
          <div style={{ display:"flex",flexDirection:"column",gap:"14px",animation:"slideIn .3s ease" }}>
            <MapSection isPro={isPro} t={t} />
            {!isPro&&<div style={{ background:t.surfaceBg,border:`1px solid ${t.surfaceBorder}`,borderRadius:"12px",padding:"14px 18px",textAlign:"center" }}>
              <div style={{ color:t.textMuted,fontSize:"13px",marginBottom:"10px" }}>Pro members see a zoomed-in map within ~200m of the treasure</div>
              <button onClick={()=>setShowModal(true)} style={{ background:"transparent",border:`1px solid ${t.accent}`,color:t.accent,padding:"9px 22px",borderRadius:"8px",cursor:"pointer",fontSize:"13px",fontWeight:"600" }}>Unlock Pro Map →</button>
            </div>}
            <div style={{ background:t.surfaceBg,border:`1px solid ${t.surfaceBorder}`,borderRadius:"14px",padding:"16px 20px" }}>
              <div style={{ color:t.textSubtle,fontSize:"10px",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"10px" }}>Search Zones</div>
              {[{zone:"Downtown Tomball",hint:"Historic Main Street area",hot:true},{zone:"Elm Street Corridor",hint:"Near shops & mercantiles",hot:true},{zone:"Tomball Depot & Railroad",hint:"Possible but less likely",hot:false}].map((z,i,arr)=>(
                <div key={z.zone} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:i<arr.length-1?`1px solid ${t.divider}`:"none" }}>
                  <div>
                    <div style={{ color:t.zoneName,fontSize:"14px" }}>{z.zone}</div>
                    <div style={{ color:t.textDim,fontSize:"12px" }}>{z.hint}</div>
                  </div>
                  {z.hot&&<span style={{ background:`${t.accent}15`,border:`1px solid ${t.accent}`,color:t.accent,fontSize:"10px",padding:"2px 8px",borderRadius:"10px" }}>🔥 HOT</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* LEADERBOARD TAB */}
        {activeTab==="leaderboard"&&(
          <div style={{ display:"flex",flexDirection:"column",gap:"14px",animation:"slideIn .3s ease" }}>
            <div style={{ background:t.prizeBg,border:`1px solid ${t.prizeBorder}`,borderRadius:"14px",padding:"18px 22px",textAlign:"center" }}>
              <div style={{ fontSize:"28px",marginBottom:"5px" }}>🏆</div>
              <div style={{ color:t.text,fontFamily:"'Playfair Display',serif",fontSize:"19px",fontWeight:"700" }}>Hall of Hunters</div>
              <div style={{ color:t.textMuted,fontSize:"12px",marginTop:"3px" }}>All-time finds leaderboard</div>
            </div>
            {/* Current user row */}
            {user&&!user.isGuest&&(
              <div style={{ background:t.surfaceBg,border:`1.5px solid ${t.accent}33`,borderRadius:"12px",padding:"13px 18px",display:"flex",alignItems:"center",gap:"12px" }}>
                <div style={{ width:"30px",height:"30px",borderRadius:"50%",background:avatarColor(user.name),display:"flex",alignItems:"center",justifyContent:"center",fontSize:"12px",fontWeight:"700",color:"#fff",flexShrink:0 }}>{initials(user.name)}</div>
                <div style={{ flex:1 }}>
                  <div style={{ color:t.text,fontSize:"13px",fontWeight:"600" }}>{user.name}</div>
                  {user.city&&<div style={{ color:t.textMuted,fontSize:"11px" }}>📍 {user.city}</div>}
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ color:t.accent,fontSize:"14px",fontWeight:"700" }}>0</div>
                  <div style={{ color:t.textDim,fontSize:"10px" }}>your finds</div>
                </div>
              </div>
            )}
            <div style={{ background:t.surfaceBg,border:`1px solid ${t.surfaceBorder}`,borderRadius:"14px",overflow:"hidden" }}>
              {LEADERBOARD.map((h,i)=>(
                <div key={h.rank} style={{ display:"flex",alignItems:"center",gap:"12px",padding:"13px 18px",borderBottom:i<LEADERBOARD.length-1?`1px solid ${t.divider}`:"none",background:i===0?`${t.accent}08`:"transparent" }}>
                  <div style={{ width:"28px",height:"28px",borderRadius:"50%",flexShrink:0,background:i===0?`linear-gradient(135deg,${t.accent},${t.accentHover})`:i===1?"linear-gradient(135deg,#888,#bbb)":i===2?"linear-gradient(135deg,#a0522d,#cd853f)":isDark?"#222":"#eee",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",fontWeight:"700",color:i<3?"#fff":t.textMuted }}>{h.rank}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ color:t.text,fontSize:"13px",fontWeight:"500" }}>{h.name}</div>
                    {h.streak&&<div style={{ color:t.textSubtle,fontSize:"11px" }}>{h.streak}</div>}
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ color:t.accent,fontSize:"14px",fontWeight:"700" }}>{h.finds}</div>
                    <div style={{ color:t.textDim,fontSize:"10px" }}>finds</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ background:t.surfaceBg,border:`1px dashed ${isDark?"#2a2a2a":"#d4c090"}`,borderRadius:"12px",padding:"18px",textAlign:"center" }}>
              <div style={{ color:t.textDim,fontSize:"13px" }}>Found the treasure? Report your find!</div>
              <button onClick={()=>setActiveTab("claim")} style={{ marginTop:"10px",background:`linear-gradient(135deg,${t.green},#66bb6a)`,border:"none",color:"#fff",padding:"9px 22px",borderRadius:"8px",cursor:"pointer",fontSize:"13px",fontWeight:"700",boxShadow:`0 4px 16px ${t.green}44` }}>🔢 Enter Claim Code</button>
            </div>
          </div>
        )}

        {/* ADMIN TAB */}
        {activeTab==="claim"&&(
          <ClaimTab hunt={hunt} t={t} isDark={isDark} />
        )}

        {activeTab==="admin"&&isAdmin&&(
          <AdminPanel t={t} isDark={isDark} onPublish={d=>setHunt(p=>({...p,...d}))} simOffset={simOffset} setSimOffset={v=>setSimOffset(v===null?null:v)} />
        )}
      </div>

      {/* ── ADMIN LOGIN ── */}
      {showAdminLogin&&(
        <div onClick={()=>setShowAdminLogin(false)} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:"20px" }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:t.surfaceBg,border:`2px solid ${t.green}`,borderRadius:"18px",padding:"26px 24px",width:"100%",maxWidth:"320px" }}>
            <div style={{ textAlign:"center",marginBottom:"18px" }}>
              <div style={{ fontSize:"28px",marginBottom:"6px" }}>🔐</div>
              <div style={{ color:t.text,fontSize:"17px",fontFamily:"'Playfair Display',serif",fontWeight:"700" }}>Admin Access</div>
            </div>
            <input type="password" value={adminCode} onChange={e=>setAdminCode(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAdminLogin()} placeholder="Admin code…" autoFocus style={{ width:"100%",background:t.inputBg,border:`1.5px solid ${adminErr?t.danger:t.inputBorder}`,borderRadius:"10px",padding:"11px 13px",color:t.text,fontSize:"14px",outline:"none",marginBottom:"10px",fontFamily:"'DM Sans',sans-serif" }} />
            {adminErr&&<div style={{ color:t.danger,fontSize:"12px",marginBottom:"10px" }}>{adminErr}</div>}
            <button onClick={handleAdminLogin} style={{ width:"100%",background:`linear-gradient(135deg,${t.green},#66bb6a)`,color:"#fff",border:"none",borderRadius:"10px",padding:"12px",fontSize:"14px",fontWeight:"700",cursor:"pointer",marginBottom:"8px" }}>Enter →</button>
            <button onClick={()=>{setShowAdminLogin(false);setAdminCode("");setAdminErr("");}} style={{ width:"100%",background:"transparent",border:"none",color:t.textMuted,fontSize:"13px",padding:"6px",cursor:"pointer" }}>Cancel</button>
            <div style={{ marginTop:"10px",background:`${t.accent}10`,border:`1px solid ${t.accent}30`,borderRadius:"8px",padding:"7px 10px",color:t.textMuted,fontSize:"11px",textAlign:"center" }}>Demo: <strong style={{ color:t.accent }}>findseek2026</strong></div>
          </div>
        </div>
      )}

      {/* ── UPGRADE MODAL ── */}
      {showModal&&(
        <div onClick={()=>setShowModal(false)} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:"20px" }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:t.modalBg,border:`2px solid ${t.accent}`,borderRadius:"20px",padding:"26px 22px",width:"100%",maxWidth:"420px",marginBottom:"16px" }}>
            <div style={{ textAlign:"center",marginBottom:"18px" }}>
              <div style={{ fontSize:"34px",marginBottom:"8px" }}>⭐</div>
              <div style={{ color:t.text,fontSize:"20px",fontFamily:"'Playfair Display',serif",fontWeight:"700" }}>Unlock Pro Membership</div>
              <div style={{ color:t.textDate,fontSize:"13px",marginTop:"4px" }}>Get the full advantage every week</div>
            </div>
            <div style={{ display:"flex",flexDirection:"column",gap:"8px",marginBottom:"18px" }}>
              {[["📜","6 Clues/Week","Tue–Thu clues only for Pro"],["🗺️","Zoomed Map","~200m radius pinpoint"],["📸","Thursday Photo","Photo clue at 8 AM"],["⚡","Daily 8 AM Access","Clues the moment they drop"]].map(([icon,title,desc])=>(
                <div key={title} style={{ display:"flex",gap:"12px",alignItems:"center",background:`${t.accent}0e`,borderRadius:"10px",padding:"10px 13px" }}>
                  <span style={{ fontSize:"18px" }}>{icon}</span>
                  <div><div style={{ color:t.text,fontSize:"13px",fontWeight:"600" }}>{title}</div><div style={{ color:t.textMuted,fontSize:"12px" }}>{desc}</div></div>
                </div>
              ))}
            </div>
            <button onClick={()=>{setIsPro(true);setShowModal(false);}} style={{ width:"100%",background:`linear-gradient(135deg,${t.accent},${t.accentHover})`,color:"#fff",border:"none",borderRadius:"12px",padding:"14px",fontSize:"15px",fontWeight:"700",cursor:"pointer",marginBottom:"10px",boxShadow:`0 6px 28px ${t.accent}55` }}>
              START PRO — $4.99/mo
            </button>
            <button onClick={()=>setShowModal(false)} style={{ width:"100%",background:"transparent",border:"none",color:t.textMuted,fontSize:"13px",padding:"8px",cursor:"pointer" }}>Maybe later</button>
          </div>
        </div>
      )}
    </div>
  );
}
