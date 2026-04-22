import { useState, useMemo } from "react";

// ─── Seed Data ────────────────────────────────────────────────────────────────
const SERVICES = [
  { id: "s1", name: "Full Highlights",     duration: 120, emoji: "✨", desc: "Full colour transformation" },
  { id: "s2", name: "Balayage",            duration: 150, emoji: "🌅", desc: "Sun-kissed hand-painted colour" },
  { id: "s3", name: "Cut & Style",         duration: 60,  emoji: "✂️",  desc: "Precision cut & blowdry" },
  { id: "s4", name: "Keratin Treatment",   duration: 180, emoji: "💎", desc: "Smoothing & frizz control" },
  { id: "s5", name: "Deep Condition",      duration: 45,  emoji: "🌿", desc: "Intensive moisture repair" },
  { id: "s6", name: "Blowout",             duration: 30,  emoji: "💨", desc: "Volume & shine finish" },
];

// Techs are internal — client only sees service availability
const TECHS = [
  { id: "t1", services: ["s1","s2","s3","s6"] },
  { id: "t2", services: ["s1","s3","s4","s5"] },
  { id: "t3", services: ["s2","s3","s5","s6"] },
  { id: "t4", services: ["s1","s2","s4","s6"] },
];

const BLOCKED = {
  t1: new Set(["2025-06-14|09:00","2025-06-14|09:30","2025-06-14|10:00","2025-06-14|14:00","2025-06-14|14:30"]),
  t2: new Set(["2025-06-14|10:00","2025-06-14|10:30","2025-06-14|11:00","2025-06-14|15:00"]),
  t3: new Set(["2025-06-14|09:00","2025-06-14|13:00","2025-06-14|13:30","2025-06-14|16:00"]),
  t4: new Set(["2025-06-14|11:00","2025-06-14|11:30","2025-06-14|14:00","2025-06-14|16:30"]),
};

const HOURS = [];
for (let h = 9; h <= 17; h++) {
  HOURS.push(`${String(h).padStart(2,"0")}:00`);
  if (h < 17) HOURS.push(`${String(h).padStart(2,"0")}:30`);
}

const TODAY = "2025-06-14";

// Find any tech who can do this service and is free for the full duration
function serviceHasAvailableSlot(serviceId, dateKey, time) {
  const svc = SERVICES.find(s => s.id === serviceId);
  if (!svc) return false;
  return TECHS.filter(t => t.services.includes(serviceId)).some(tech => {
    const slots = Math.ceil(svc.duration / 30);
    const [hh, mm] = time.split(":").map(Number);
    let mins = hh * 60 + mm;
    for (let i = 0; i < slots; i++) {
      const key = `${dateKey}|${String(Math.floor(mins/60)).padStart(2,"0")}:${String(mins%60).padStart(2,"0")}`;
      if (BLOCKED[tech.id]?.has(key)) return false;
      mins += 30;
    }
    return true;
  });
}

function slotAvailableForAll(serviceIds, dateKey, time) {
  return serviceIds.every(sid => serviceHasAvailableSlot(sid, dateKey, time));
}

// ─── STEP INDICATORS ─────────────────────────────────────────────────────────
function StepDots({ current, total }) {
  return (
    <div style={{ display:"flex", gap:6, justifyContent:"center", marginBottom:32 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          height: 4, borderRadius: 2,
          width: i === current ? 24 : 8,
          background: i <= current ? "#c8a97a" : "#222",
          transition: "all 0.3s"
        }} />
      ))}
    </div>
  );
}

// ─── WELCOME / MODE SELECT ────────────────────────────────────────────────────
function WelcomeScreen({ onSolo, onGroup }) {
  return (
    <div style={{ animation: "fadeUp 0.5s ease both" }}>
      <div style={{ textAlign:"center", marginBottom: 40 }}>
        <div style={{
          width: 64, height: 64, borderRadius: "50%",
          background: "linear-gradient(135deg,#c8a97a22,#8b6b4422)",
          border: "1px solid #c8a97a44",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize: 28, margin: "0 auto 20px"
        }}>✦</div>
        <h1 style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 34, fontWeight: 600, color: "#f5ede0",
          letterSpacing: "-0.5px", lineHeight: 1.1, marginBottom: 8
        }}>Book your visit</h1>
        <p style={{ color: "#6a5a4a", fontSize: 14 }}>How many people are joining today?</p>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap: 12 }}>
        <button onClick={onSolo} style={{
          padding: "20px 24px", borderRadius: 16,
          border: "1px solid #2a2418", background: "#0e0b08",
          cursor: "pointer", textAlign: "left", transition: "all 0.2s",
          fontFamily: "inherit"
        }}
          onMouseOver={e => e.currentTarget.style.borderColor = "#c8a97a55"}
          onMouseOut={e => e.currentTarget.style.borderColor = "#2a2418"}
        >
          <div style={{ display:"flex", alignItems:"center", gap: 14 }}>
            <span style={{ fontSize: 26 }}>🪑</span>
            <div>
              <p style={{ color:"#f0e8da", fontSize:15, fontWeight:600, marginBottom:3 }}>Just me</p>
              <p style={{ color:"#5a4a3a", fontSize:12 }}>Single appointment</p>
            </div>
            <span style={{ marginLeft:"auto", color:"#3a2e22", fontSize:18 }}>›</span>
          </div>
        </button>

        <button onClick={onGroup} style={{
          padding: "20px 24px", borderRadius: 16,
          border: "1px solid #c8a97a55",
          background: "linear-gradient(135deg,#c8a97a0d,#8b6b440a)",
          cursor: "pointer", textAlign: "left", transition: "all 0.2s",
          fontFamily: "inherit", position:"relative", overflow:"hidden"
        }}
          onMouseOver={e => e.currentTarget.style.background = "linear-gradient(135deg,#c8a97a18,#8b6b4412)"}
          onMouseOut={e => e.currentTarget.style.background = "linear-gradient(135deg,#c8a97a0d,#8b6b440a)"}
        >
          <div style={{ display:"flex", alignItems:"center", gap: 14 }}>
            <span style={{ fontSize: 26 }}>👥</span>
            <div>
              <div style={{ display:"flex", alignItems:"center", gap: 8, marginBottom:3 }}>
                <p style={{ color:"#f0e8da", fontSize:15, fontWeight:600 }}>Book for a group</p>
                <span style={{
                  fontSize:9, fontWeight:700, color:"#c8a97a", background:"#c8a97a18",
                  padding:"2px 7px", borderRadius:10, border:"1px solid #c8a97a33",
                  textTransform:"uppercase", letterSpacing:0.8
                }}>New</span>
              </div>
              <p style={{ color:"#5a4a3a", fontSize:12 }}>Everyone picks their service, one shared time</p>
            </div>
            <span style={{ marginLeft:"auto", color:"#c8a97a88", fontSize:18 }}>›</span>
          </div>
        </button>
      </div>
    </div>
  );
}

// ─── GROUP SIZE PICKER ────────────────────────────────────────────────────────
function GroupSizePicker({ onConfirm }) {
  const [size, setSize] = useState(2);
  return (
    <div style={{ animation:"fadeUp 0.4s ease both" }}>
      <h2 style={{
        fontFamily:"'Cormorant Garamond',serif", fontSize:26, color:"#f5ede0",
        marginBottom:8, fontWeight:600
      }}>How many people?</h2>
      <p style={{ color:"#5a4a3a", fontSize:13, marginBottom:32 }}>You can add up to 6 people</p>

      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap: 28, marginBottom:40 }}>
        <button onClick={() => setSize(s => Math.max(2, s-1))} style={{
          width:44, height:44, borderRadius:"50%", border:"1px solid #2a2418",
          background:"#0e0b08", color:"#c8a97a", fontSize:22, cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center",
          opacity: size <= 2 ? 0.3 : 1, fontFamily:"inherit"
        }}>−</button>
        <div style={{ textAlign:"center" }}>
          <div style={{
            fontFamily:"'Cormorant Garamond',serif", fontSize:72, fontWeight:600,
            color:"#c8a97a", lineHeight:1
          }}>{size}</div>
          <div style={{ color:"#5a4a3a", fontSize:12 }}>people</div>
        </div>
        <button onClick={() => setSize(s => Math.min(6, s+1))} style={{
          width:44, height:44, borderRadius:"50%", border:"1px solid #2a2418",
          background:"#0e0b08", color:"#c8a97a", fontSize:22, cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center",
          opacity: size >= 6 ? 0.3 : 1, fontFamily:"inherit"
        }}>+</button>
      </div>

      <button onClick={() => onConfirm(size)} style={{
        width:"100%", padding:"15px 0", borderRadius:14,
        background:"linear-gradient(135deg,#c8a97a,#a07848)",
        border:"none", color:"#1a0f02", fontWeight:700, fontSize:15,
        cursor:"pointer", fontFamily:"inherit",
        boxShadow:"0 8px 28px rgba(200,169,122,0.25)"
      }}>Continue with {size} people</button>
    </div>
  );
}

// ─── SERVICE TABS ─────────────────────────────────────────────────────────────
function ServiceTabs({ members, onUpdate }) {
  const [active, setActive] = useState(0);
  const member = members[active];

  return (
    <div style={{ animation:"fadeUp 0.4s ease both" }}>
      <h2 style={{
        fontFamily:"'Cormorant Garamond',serif", fontSize:26, color:"#f5ede0",
        marginBottom:4, fontWeight:600
      }}>Choose services</h2>
      <p style={{ color:"#5a4a3a", fontSize:13, marginBottom:20 }}>Select one service per person</p>

      {/* Tab row */}
      <div style={{
        display:"flex", gap:6, marginBottom:24, overflowX:"auto",
        paddingBottom:4, scrollbarWidth:"none"
      }}>
        {members.map((m, i) => {
          const done = !!m.serviceId;
          return (
            <button key={i} onClick={() => setActive(i)} style={{
              flexShrink:0, padding:"8px 14px", borderRadius:24,
              border: active===i ? "1.5px solid #c8a97a" : "1px solid #2a2418",
              background: active===i ? "#c8a97a18" : "transparent",
              color: active===i ? "#c8a97a" : done ? "#8a7a6a" : "#4a3a2a",
              fontSize:12, fontWeight:600, cursor:"pointer",
              display:"flex", alignItems:"center", gap:6, fontFamily:"inherit",
              transition:"all 0.15s"
            }}>
              {done && <span style={{ fontSize:10 }}>✓</span>}
              {m.name || `Person ${i+1}`}
            </button>
          );
        })}
      </div>

      {/* Name input */}
      <div style={{
        background:"#0a0804", border:"1px solid #1e1a14", borderRadius:12,
        padding:"12px 16px", marginBottom:16, display:"flex", alignItems:"center", gap:10
      }}>
        <span style={{ color:"#4a3a2a", fontSize:13 }}>
          {active === 0 ? "Your name" : "Name"}
        </span>
        <input
          value={member.name}
          onChange={e => onUpdate(active, { name: e.target.value })}
          placeholder={active === 0 ? "Enter your name…" : `Person ${active+1}'s name…`}
          style={{
            flex:1, background:"transparent", border:"none", outline:"none",
            color:"#f0e8da", fontSize:14, fontWeight:500, fontFamily:"inherit",
            textAlign:"right"
          }}
        />
      </div>

      {/* Service grid */}
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {SERVICES.map(svc => {
          const sel = member.serviceId === svc.id;
          return (
            <button key={svc.id} onClick={() => onUpdate(active, { serviceId: svc.id })} style={{
              padding:"14px 16px", borderRadius:14,
              border: `1.5px solid ${sel ? "#c8a97a" : "#1e1a14"}`,
              background: sel ? "#c8a97a12" : "#0a0804",
              cursor:"pointer", textAlign:"left", transition:"all 0.15s",
              fontFamily:"inherit"
            }}>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <span style={{ fontSize:20, width:28, textAlign:"center" }}>{svc.emoji}</span>
                <div style={{ flex:1 }}>
                  <p style={{ color: sel ? "#f0e8da" : "#9a8a7a", fontSize:14, fontWeight:600, marginBottom:2 }}>{svc.name}</p>
                  <p style={{ color:"#4a3a2a", fontSize:11 }}>{svc.desc} · {svc.duration}min</p>
                </div>
                <div style={{
                  width:18, height:18, borderRadius:"50%",
                  border: `1.5px solid ${sel ? "#c8a97a" : "#2a2418"}`,
                  background: sel ? "#c8a97a" : "transparent",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  flexShrink:0
                }}>
                  {sel && <span style={{ color:"#1a0f02", fontSize:10, fontWeight:900 }}>✓</span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Progress hint */}
      <div style={{
        display:"flex", justifyContent:"space-between", marginTop:16,
        fontSize:11, color:"#4a3a2a"
      }}>
        <span>{members.filter(m => m.serviceId).length} of {members.length} selected</span>
        {active < members.length - 1 && (
          <button onClick={() => setActive(a => a+1)} style={{
            background:"transparent", border:"none", color:"#c8a97a88",
            cursor:"pointer", fontSize:11, fontFamily:"inherit"
          }}>Next person →</button>
        )}
      </div>
    </div>
  );
}

// ─── DATE & TIME ──────────────────────────────────────────────────────────────
function DateTimeStep({ members, selectedDate, selectedTime, onDateChange, onTimeSelect }) {
  const serviceIds = members.map(m => m.serviceId).filter(Boolean);

  const slotMap = useMemo(() => {
    return HOURS.map(time => ({
      time,
      available: slotAvailableForAll(serviceIds, selectedDate, time)
    }));
  }, [serviceIds, selectedDate]);

  const availableCount = slotMap.filter(s => s.available).length;

  return (
    <div style={{ animation:"fadeUp 0.4s ease both" }}>
      <h2 style={{
        fontFamily:"'Cormorant Garamond',serif", fontSize:26, color:"#f5ede0",
        marginBottom:4, fontWeight:600
      }}>Pick a time</h2>
      <p style={{ color:"#5a4a3a", fontSize:13, marginBottom:24 }}>
        Showing slots where all {members.length} people can be seen simultaneously
      </p>

      {/* Date picker */}
      <div style={{
        background:"#0a0804", border:"1px solid #1e1a14", borderRadius:12,
        padding:"12px 16px", marginBottom:20, display:"flex", alignItems:"center", gap:10
      }}>
        <span style={{ fontSize:16 }}>📅</span>
        <input type="date" value={selectedDate} min={TODAY}
          onChange={e => onDateChange(e.target.value)}
          style={{
            flex:1, background:"transparent", border:"none", outline:"none",
            color:"#f0e8da", fontSize:14, fontWeight:500, fontFamily:"inherit"
          }}
        />
        <span style={{ fontSize:11, color:"#4a3a2a" }}>
          {availableCount} slots open
        </span>
      </div>

      {/* Time grid */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:7, marginBottom:8 }}>
        {slotMap.map(({ time, available }) => {
          const sel = selectedTime === time;
          const hour = parseInt(time.split(":")[0]);
          const period = hour < 12 ? "am" : "pm";
          const displayH = hour > 12 ? hour - 12 : hour;
          const displayM = time.split(":")[1];
          return (
            <button key={time} disabled={!available} onClick={() => onTimeSelect(time)} style={{
              padding:"11px 4px", borderRadius:12, textAlign:"center",
              border:`1.5px solid ${sel ? "#c8a97a" : available ? "#1e1a14" : "#120f0a"}`,
              background: sel ? "#c8a97a18" : available ? "#0a0804" : "#080605",
              color: sel ? "#c8a97a" : available ? "#c0b0a0" : "#2a2018",
              fontSize:11, fontWeight: sel ? 700 : 500,
              cursor: available ? "pointer" : "not-allowed",
              transition:"all 0.12s", fontFamily:"inherit", lineHeight:1.4
            }}>
              <div>{displayH}:{displayM}</div>
              <div style={{ fontSize:9, opacity:0.6 }}>{period}</div>
            </button>
          );
        })}
      </div>

      {availableCount === 0 && (
        <p style={{ textAlign:"center", fontSize:12, color:"#5a4a3a", padding:"8px 0" }}>
          No slots available on this date — try another day
        </p>
      )}
    </div>
  );
}

// ─── CONFIRMATION ─────────────────────────────────────────────────────────────
function ConfirmationScreen({ members, date, time, loading, done, onConfirm }) {
  const groupId = useMemo(() => Math.random().toString(36).slice(2,10).toUpperCase(), []);
  const displayDate = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    weekday:"long", month:"long", day:"numeric"
  });

  if (done) return (
    <div style={{ animation:"fadeUp 0.5s ease both", textAlign:"center" }}>
      <div style={{
        width:72, height:72, borderRadius:"50%", margin:"0 auto 20px",
        background:"linear-gradient(135deg,#c8a97a22,#8b6b4422)",
        border:"1.5px solid #c8a97a66",
        display:"flex", alignItems:"center", justifyContent:"center", fontSize:28
      }}>✓</div>
      <h2 style={{
        fontFamily:"'Cormorant Garamond',serif", fontSize:28, color:"#f5ede0",
        marginBottom:8, fontWeight:600
      }}>You're all booked!</h2>
      <p style={{ color:"#5a4a3a", fontSize:13, marginBottom:6 }}>{displayDate} at {time}</p>
      <p style={{ color:"#4a3a2a", fontSize:12, marginBottom:32 }}>Ref: {groupId}</p>

      <div style={{ textAlign:"left", display:"flex", flexDirection:"column", gap:8 }}>
        {members.map((m, i) => {
          const svc = SERVICES.find(s => s.id === m.serviceId);
          return (
            <div key={i} style={{
              padding:"14px 16px", background:"#0a0804", border:"1px solid #1e1a14",
              borderRadius:14, display:"flex", alignItems:"center", gap:12
            }}>
              <span style={{ fontSize:20 }}>{svc.emoji}</span>
              <div>
                <p style={{ color:"#f0e8da", fontSize:13, fontWeight:600, marginBottom:2 }}>
                  {m.name || `Person ${i+1}`}
                  {i === 0 && <span style={{ color:"#c8a97a88", fontSize:10, marginLeft:8 }}>lead booker</span>}
                </p>
                <p style={{ color:"#5a4a3a", fontSize:11 }}>{svc.name} · {svc.duration}min</p>
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ marginTop:20, fontSize:11, color:"#3a2e22" }}>
        A confirmation has been sent to the lead booker
      </p>
    </div>
  );

  return (
    <div style={{ animation:"fadeUp 0.4s ease both" }}>
      <h2 style={{
        fontFamily:"'Cormorant Garamond',serif", fontSize:26, color:"#f5ede0",
        marginBottom:4, fontWeight:600
      }}>Review & confirm</h2>
      <p style={{ color:"#5a4a3a", fontSize:13, marginBottom:24 }}>
        {displayDate} · {time} · {members.length} people
      </p>

      <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:24 }}>
        {members.map((m, i) => {
          const svc = SERVICES.find(s => s.id === m.serviceId);
          return (
            <div key={i} style={{
              padding:"14px 16px", background:"#0a0804", border:"1px solid #1e1a14",
              borderRadius:14, display:"flex", alignItems:"center", gap:12
            }}>
              <span style={{ fontSize:20 }}>{svc.emoji}</span>
              <div style={{ flex:1 }}>
                <p style={{ color:"#f0e8da", fontSize:13, fontWeight:600, marginBottom:2 }}>
                  {m.name || `Person ${i+1}`}
                </p>
                <p style={{ color:"#5a4a3a", fontSize:11 }}>{svc.name} · {svc.duration}min</p>
              </div>
              {i === 0 && (
                <span style={{
                  fontSize:9, color:"#c8a97a", background:"#c8a97a18",
                  padding:"3px 8px", borderRadius:10, border:"1px solid #c8a97a33",
                  textTransform:"uppercase", letterSpacing:0.8, fontWeight:700
                }}>You</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Total duration notice */}
      <div style={{
        padding:"12px 16px", background:"#0c0e0a", border:"1px solid #1a2214",
        borderRadius:12, marginBottom:24, display:"flex", gap:10, alignItems:"flex-start"
      }}>
        <span style={{ fontSize:14, marginTop:1 }}>ℹ️</span>
        <p style={{ color:"#6a7a5a", fontSize:12, lineHeight:1.5 }}>
          All services run simultaneously. The session ends when the longest appointment is complete.
          You'll receive one confirmation covering the whole group.
        </p>
      </div>

      <button onClick={onConfirm} disabled={loading} style={{
        width:"100%", padding:"16px 0", borderRadius:14,
        background: loading ? "#1a150e" : "linear-gradient(135deg,#c8a97a,#a07848)",
        border: loading ? "1px solid #2a2418" : "none",
        color: loading ? "#5a4a3a" : "#1a0f02",
        fontWeight:700, fontSize:15, cursor: loading ? "wait" : "pointer",
        fontFamily:"inherit", transition:"all 0.2s",
        boxShadow: loading ? "none" : "0 8px 28px rgba(200,169,122,0.25)"
      }}>
        {loading ? "Confirming…" : `Confirm group of ${members.length}`}
      </button>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function ClientGroupBooking() {
  const [screen, setScreen] = useState("welcome"); // welcome | size | services | datetime | confirm
  const [members, setMembers] = useState([]);
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [selectedTime, setSelectedTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const STEPS = { size:0, services:1, datetime:2, confirm:3 };
  const currentStep = STEPS[screen] ?? -1;

  const updateMember = (i, patch) => {
    setMembers(ms => ms.map((m, idx) => idx === i ? { ...m, ...patch } : m));
    if (patch.serviceId !== undefined) setSelectedTime("");
  };

  const allServicesSelected = members.length > 0 && members.every(m => m.serviceId);

  const handleConfirm = async () => {
    setLoading(true);
    await new Promise(r => setTimeout(r, 1800));
    setLoading(false);
    setDone(true);
  };

  return (
    <div style={{
      minHeight:"100vh",
      background:"radial-gradient(ellipse at 20% 0%, #1a1208 0%, #080604 60%)",
      fontFamily:"'Lora','Georgia',serif", color:"#f0e8da",
      display:"flex", flexDirection:"column", alignItems:"center",
      padding:"0 0 40px"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Lora:wght@400;500;600&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        input[type=date]::-webkit-calendar-picker-indicator { filter: invert(0.4) sepia(1) hue-rotate(10deg); }
        ::-webkit-scrollbar { width:3px; height:3px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:#2a2010; border-radius:4px; }
        button { font-family:'Lora','Georgia',serif; }
        input { font-family:'Lora','Georgia',serif; }
      `}</style>

      {/* Top bar */}
      <div style={{
        width:"100%", maxWidth:420,
        padding:"20px 20px 0",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        marginBottom: screen === "welcome" ? 40 : 20
      }}>
        <div style={{
          fontFamily:"'Cormorant Garamond',serif",
          fontSize:17, fontWeight:600, color:"#c8a97a", letterSpacing:"0.05em"
        }}>lumière</div>
        {screen !== "welcome" && (
          <button onClick={() => {
            const prev = { size:"welcome", services:"size", datetime:"services", confirm:"datetime" };
            if (done) return;
            setScreen(prev[screen] || "welcome");
          }} style={{
            background:"transparent", border:"none", color:"#4a3a2a",
            fontSize:22, cursor:"pointer", lineHeight:1, padding:"4px 8px"
          }}>‹</button>
        )}
      </div>

      {/* Step dots */}
      {currentStep >= 0 && <StepDots current={currentStep} total={4} />}

      {/* Content */}
      <div style={{ width:"100%", maxWidth:420, padding:"0 20px", flex:1 }}>
        {screen === "welcome" && (
          <WelcomeScreen
            onSolo={() => alert("Solo booking flow →")}
            onGroup={() => setScreen("size")}
          />
        )}
        {screen === "size" && (
          <GroupSizePicker onConfirm={n => {
            setMembers(Array.from({length:n},(_,i)=>({ name: i===0 ? "" : "", serviceId:"" })));
            setScreen("services");
          }} />
        )}
        {screen === "services" && (
          <>
            <ServiceTabs members={members} onUpdate={updateMember} />
            <button
              disabled={!allServicesSelected}
              onClick={() => setScreen("datetime")}
              style={{
                width:"100%", marginTop:20, padding:"15px 0", borderRadius:14,
                background: allServicesSelected ? "linear-gradient(135deg,#c8a97a,#a07848)" : "#0e0b08",
                border: allServicesSelected ? "none" : "1px solid #1e1a14",
                color: allServicesSelected ? "#1a0f02" : "#3a2e22",
                fontWeight:700, fontSize:15, cursor: allServicesSelected ? "pointer" : "not-allowed",
                fontFamily:"inherit", transition:"all 0.2s",
                boxShadow: allServicesSelected ? "0 8px 28px rgba(200,169,122,0.25)" : "none"
              }}>
              {allServicesSelected ? "Choose a time →" : `${members.filter(m=>m.serviceId).length} of ${members.length} selected`}
            </button>
          </>
        )}
        {screen === "datetime" && (
          <>
            <DateTimeStep
              members={members}
              selectedDate={selectedDate}
              selectedTime={selectedTime}
              onDateChange={d => { setSelectedDate(d); setSelectedTime(""); }}
              onTimeSelect={setSelectedTime}
            />
            <button
              disabled={!selectedTime}
              onClick={() => setScreen("confirm")}
              style={{
                width:"100%", marginTop:20, padding:"15px 0", borderRadius:14,
                background: selectedTime ? "linear-gradient(135deg,#c8a97a,#a07848)" : "#0e0b08",
                border: selectedTime ? "none" : "1px solid #1e1a14",
                color: selectedTime ? "#1a0f02" : "#3a2e22",
                fontWeight:700, fontSize:15, cursor: selectedTime ? "pointer" : "not-allowed",
                fontFamily:"inherit", transition:"all 0.2s",
                boxShadow: selectedTime ? "0 8px 28px rgba(200,169,122,0.25)" : "none"
              }}>
              {selectedTime ? `Review booking · ${selectedTime}` : "Select a time to continue"}
            </button>
          </>
        )}
        {screen === "confirm" && (
          <ConfirmationScreen
            members={members}
            date={selectedDate}
            time={selectedTime}
            loading={loading}
            done={done}
            onConfirm={handleConfirm}
          />
        )}
      </div>
    </div>
  );
}
