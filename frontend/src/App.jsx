import { useState, useEffect } from "react";
import Login from "./Login.jsx";

const API_BASE = "http://localhost:5000";

// Same fix as the backend: never use .toISOString() for "today's date" —
// it converts to UTC and silently shifts the date in IST (or any timezone
// ahead of UTC), especially around midnight. Use local date parts instead.
function todayLocalDateStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const FONT_ID = "smart-planner-fonts";
if (typeof document !== "undefined" && !document.getElementById(FONT_ID)) {
  const link = document.createElement("link");
  link.id = FONT_ID;
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito+Sans:wght@400;600;700;800&display=swap";
  document.head.appendChild(link);
}

// Load jsPDF from CDN once, on demand (keeps it out of the main bundle)
function loadJsPDF() {
  return new Promise((resolve, reject) => {
    if (window.jspdf) {
      resolve(window.jspdf.jsPDF);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.onload = () => resolve(window.jspdf.jsPDF);
    script.onerror = () => reject(new Error("Could not load PDF library"));
    document.head.appendChild(script);
  });
}

// jsPDF's built-in fonts only support basic Latin (WinAnsi) characters.
// AI-generated text often includes smart quotes/em-dashes that break
// rendering (garbled spacing, cut-off lines) — normalize them first.
function sanitizeForPDF(text) {
  if (!text) return "";
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x00-\x7F]/g, "");
}

function downloadPlanAsPDF(result, dayStart, dayEnd) {
  loadJsPDF().then((jsPDF) => {
    const doc = new jsPDF();
    const marginX = 20;
    const pageWidth = 210;
    const maxWidth = 170;
    let y;

    // ---- Header banner (gradient-look via layered rects) ----
    doc.setFillColor(224, 168, 46); // amber
    doc.rect(0, 0, pageWidth, 38, "F");
    doc.setFillColor(91, 141, 190); // soft blue, layered for a two-tone banner
    doc.rect(pageWidth * 0.62, 0, pageWidth * 0.38, 38, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(255, 255, 255);
    doc.text("My Daily Plan", marginX, 22);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    const dateStr = new Date().toLocaleDateString(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    doc.text(sanitizeForPDF(`${dateStr}   •   ${dayStart} to ${dayEnd}`), marginX, 31);

    y = 52;

    // ---- Briefing card ----
    if (result.aiSummary) {
      doc.setFillColor(255, 248, 232);
      const cleanSummary = sanitizeForPDF(result.aiSummary);
      const lines = doc.splitTextToSize(cleanSummary, maxWidth - 10);
      const cardHeight = lines.length * 5.4 + 18;
      doc.roundedRect(marginX, y, maxWidth, cardHeight, 3, 3, "F");
      doc.setDrawColor(224, 168, 46);
      doc.setLineWidth(0.6);
      doc.line(marginX, y, marginX, y + cardHeight);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(150, 110, 30);
      doc.text("Today's briefing", marginX + 8, y + 10);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.3);
      doc.setTextColor(75, 65, 40);
      doc.text(lines, marginX + 8, y + 17);

      y += cardHeight + 12;
    }

    // ---- Schedule section ----
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(43, 50, 69);
    doc.text("Schedule", marginX, y);
    doc.setDrawColor(224, 168, 46);
    doc.setLineWidth(1.2);
    doc.line(marginX, y + 2.5, marginX + 22, y + 2.5);
    y += 12;

    const priorityColors = {
      3: [221, 107, 52],
      2: [224, 168, 46],
      1: [91, 141, 190],
    };
    const priorityLabels = { 3: "HIGH", 2: "MEDIUM", 1: "LOW" };

    result.scheduled.forEach((t, idx) => {
      if (y > 262) {
        doc.addPage();
        y = 22;
      }
      const rowH = 14;

      // alternating row shading
      if (idx % 2 === 0) {
        doc.setFillColor(250, 251, 253);
        doc.rect(marginX, y - 8, maxWidth, rowH, "F");
      }

      // priority color bar on the left
      const pc = priorityColors[t.priority] || priorityColors[2];
      doc.setFillColor(...pc);
      doc.rect(marginX, y - 8, 2.2, rowH, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(43, 50, 69);
      doc.text(`${t.startTime} - ${t.endTime}`, marginX + 7, y);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      doc.setTextColor(60, 65, 80);
      doc.text(sanitizeForPDF(t.title), marginX + 45, y);

      // type tag
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(140, 140, 150);
      doc.text(t.type === "fixed" ? "FIXED" : "FLEXIBLE", marginX + 125, y);

      // priority pill
      doc.setFillColor(...pc);
      const label = priorityLabels[t.priority] || "MEDIUM";
      const pillWidth = doc.getTextWidth(label) + 6;
      doc.roundedRect(190 - pillWidth, y - 4.2, pillWidth, 5.6, 1.5, 1.5, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(7);
      doc.text(label, 190 - pillWidth / 2, y - 0.6, { align: "center" });

      if (t.trimmed) {
        y += 5.5;
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8);
        doc.setTextColor(180, 96, 15);
        doc.text(
          sanitizeForPDF(
            `shortened from ${minutesToTimeStr(t.originalStartMinutes)}-${minutesToTimeStr(t.originalEndMinutes)}`
          ),
          marginX + 45,
          y
        );
      }

      y += 12;
    });

    // ---- Overflow section ----
    if (result.overflow.length > 0) {
      if (y > 240) {
        doc.addPage();
        y = 22;
      }
      y += 6;
      doc.setFillColor(253, 241, 229);
      const boxHeight = result.overflow.length * 6.5 + 14;
      doc.roundedRect(marginX, y, maxWidth, boxHeight, 3, 3, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(180, 96, 15);
      doc.text("Couldn't fit today", marginX + 8, y + 10);
      let oy = y + 18;
      result.overflow.forEach((t) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(138, 90, 42);
        doc.text(`•  ${sanitizeForPDF(t.title)}`, marginX + 8, oy);
        oy += 6.5;
      });
      y += boxHeight + 10;
    }

    // ---- Footer on every page ----
    const pageCount = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setDrawColor(235, 235, 240);
      doc.setLineWidth(0.3);
      doc.line(marginX, 285, 190, 285);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(160, 160, 170);
      doc.text("Generated by Smart Daily Planner", marginX, 291);
      doc.text(`Page ${p} of ${pageCount}`, 190, 291, { align: "right" });
    }

    doc.save(`daily-plan-${new Date().toISOString().slice(0, 10)}.pdf`);
  });
}

const PRIORITY_META = {
  1: { label: "Low", color: "#2DD4A7" },   // mint
  2: { label: "Medium", color: "#38BDF8" }, // sky blue
  3: { label: "High", color: "#FB6F92" },   // pink-coral
};

function minutesToTimeStr(mins) {
  if (mins == null) return "";
  const h = Math.floor(mins / 60).toString().padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function emptyTask() {
  return {
    type: "flexible",
    title: "",
    durationMinutes: 30,
    deadline: "18:00",
    startTime: "18:00",
    endTime: "19:00",
    priority: 2,
    travelBeforeMinutes: 0,
    travelAfterMinutes: 0,
    showTravel: false,
  };
}

/* ---------- Icons ---------- */

function IconPin(props) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" {...props}>
      <path d="M12 2C8 2 5 5 5 9c0 5.5 7 13 7 13s7-7.5 7-13c0-4-3-7-7-7z" fill="currentColor" />
      <circle cx="12" cy="9" r="2.3" fill="#fff" />
    </svg>
  );
}

function IconSparkle(props) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...props}>
      <path d="M12 2l1.8 5.6L19.4 9.4 13.8 11.2 12 17l-1.8-5.8L4.6 9.4l5.6-1.8L12 2z" fill="currentColor" />
    </svg>
  );
}

function IconAlert(props) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" {...props}>
      <path d="M12 3l10 18H2L12 3z" fill="#FBE3CE" stroke="#DB2777" strokeWidth="1.5" strokeLinejoin="round" />
      <line x1="12" y1="10" x2="12" y2="14" stroke="#DB2777" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1" fill="#DB2777" />
    </svg>
  );
}

function IconPlus(props) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" {...props}>
      <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- App ---------- */

export default function App() {
  const [dayStart, setDayStart] = useState("09:00");
  const [dayEnd, setDayEnd] = useState("21:00");
  const [tasks, setTasks] = useState([emptyTask()]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saveMode, setSaveMode] = useState(null); // 'routine' | 'oneoff' | null (not yet chosen)

  // ---- Dashboard state (for users who already have a saved routine) ----
  const [dashboard, setDashboard] = useState(null); // null = not loaded yet
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false); // lets a routine user open the editor

  // ---- Auth state ----
  const [token, setToken] = useState(() => localStorage.getItem("smartPlannerToken"));
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem("smartPlannerUser");
    return stored ? JSON.parse(stored) : null;
  });

  useEffect(() => {
    if (token) fetchDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function handleLogout() {
    localStorage.removeItem("smartPlannerToken");
    localStorage.removeItem("smartPlannerUser");
    setToken(null);
    setUser(null);
    setResult(null);
    setDashboard(null);
  }

  if (!token) {
    return (
      <Login
        onLoggedIn={(newToken, newUser) => {
          setToken(newToken);
          setUser(newUser);
        }}
      />
    );
  }

  function updateTask(index, field, value) {
    setTasks((prev) => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)));
  }
  function addTask() {
    setTasks((prev) => [...prev, emptyTask()]);
  }
  function removeTask(index) {
    setTasks((prev) => prev.filter((_, i) => i !== index));
  }

  async function fetchDashboard() {
    setDashboardLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/dashboard/today`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) setDashboard(data);
    } catch {
      // non-critical — the builder form still works even if this fails
    } finally {
      setDashboardLoading(false);
    }
  }

  async function toggleSlotCompletion(templateId, currentState) {
    const newDone = currentState !== "done";
    // optimistic update
    setDashboard((prev) => ({
      ...prev,
      slots: prev.slots.map((s) =>
        s.templateId === templateId ? { ...s, doneState: newDone ? "done" : "missed" } : s
      ),
    }));
    try {
      await fetch(`${API_BASE}/api/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ templateId, date: todayLocalDateStr(), done: newDone }),
      });
      fetchDashboard(); // refresh the score/history after the change
    } catch {
      fetchDashboard();
    }
  }

  // Called after the person picks "Save as my daily routine" or "Just for today"
  async function submitPlan(mode) {
    setSaveMode(mode);
    setLoading(true);
    setError("");
    setResult(null);
    try {
      if (mode === "routine") {
        const res = await fetch(`${API_BASE}/api/routine`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ dayStart, dayEnd, tasks }),
        });
        if (res.status === 401) return handleLogout();
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Could not save your routine.");
        setShowBuilder(false);
        await fetchDashboard();
      } else {
        const res = await fetch(`${API_BASE}/api/plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ planDate: todayLocalDateStr(), dayStart, dayEnd, tasks }),
        });
        if (res.status === 401) return handleLogout();
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Failed to generate plan");
        setResult(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      {/* ---- Hero band ---- */}
      <div style={styles.hero}>
        <svg viewBox="0 0 400 200" style={styles.heroBlobSvg} aria-hidden="true">
          <ellipse cx="60" cy="40" rx="140" ry="100" fill="#FFCB9E" opacity="0.4" />
          <ellipse cx="200" cy="120" rx="90" ry="70" fill="#FFAECD" opacity="0.3" />
          <ellipse cx="340" cy="170" rx="160" ry="110" fill="#7FE0C4" opacity="0.35" />
        </svg>
        <button onClick={handleLogout} style={styles.logoutBtn}>
          {user?.name ? `${user.name.split(" ")[0]} · ` : ""}Log out
        </button>
        <div style={styles.heroContent}>
          <span style={styles.heroKicker}>PLAN AHEAD</span>
          <h1 style={styles.heroTitle}>
            Design your <span style={styles.heroTitleAccent}>perfect day</span>
          </h1>
          <p style={styles.heroSubtitle}>
            Mix fixed commitments with flexible to-dos, add travel time, and get a schedule that
            actually fits.
          </p>
        </div>
        <svg viewBox="0 0 200 200" style={styles.heroImage} aria-hidden="true">
          <circle cx="100" cy="100" r="92" fill="rgba(255,255,255,0.16)" />
          <rect x="42" y="46" width="116" height="112" rx="14" fill="#fff" opacity="0.95" />
          <rect x="42" y="46" width="116" height="30" rx="14" fill="#6366F1" />
          <rect x="42" y="62" width="116" height="14" fill="#6366F1" />
          <circle cx="64" cy="61" r="4" fill="#fff" />
          <circle cx="136" cy="61" r="4" fill="#fff" />
          <rect x="58" y="92" width="14" height="14" rx="4" fill="#22D3EE" />
          <rect x="80" y="95" width="60" height="7" rx="3.5" fill="#E0E7FF" />
          <rect x="58" y="116" width="14" height="14" rx="4" fill="#818CF8" />
          <rect x="80" y="119" width="46" height="7" rx="3.5" fill="#E0E7FF" />
          <rect x="58" y="140" width="14" height="14" rx="4" fill="#E0E7FF" />
          <rect x="80" y="143" width="52" height="7" rx="3.5" fill="#E0E7FF" />
          <circle cx="152" cy="150" r="26" fill="#FCD34D" />
          <path d="M142 150l7 7 12-14" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <div style={styles.content}>
        {dashboardLoading && (
          <section style={styles.card}>
            <p style={styles.emptyText}>Loading your dashboard…</p>
          </section>
        )}

        {/* ---- Dashboard: for people who already have a saved routine ---- */}
        {!dashboardLoading && dashboard?.hasRoutine && !showBuilder && (
          <>
            <section style={styles.cardAmber}>
              <div style={styles.resultsHeaderRow}>
                <h2 style={styles.cardTitle}>Today's Consistency</h2>
                <button onClick={() => setShowBuilder(true)} style={styles.downloadBtn}>
                  Edit routine
                </button>
              </div>

              {dashboard.todayScore.total > 0 ? (
                <div style={styles.scoreBanner}>
                  <span style={styles.scoreBig}>
                    {dashboard.todayScore.done}/{dashboard.todayScore.total}
                  </span>
                  <span style={styles.scoreText}>tasks done today · {dashboard.todayScore.percent}%</span>
                </div>
              ) : (
                <p style={styles.emptyText}>No tasks in today's routine.</p>
              )}

              {dashboard.taskGrid.length > 0 && (
                <table style={styles.habitTable}>
                  <thead>
                    <tr>
                      <th style={styles.habitTh}>Task</th>
                      {dashboard.taskGrid[0].grid.map((g) => (
                        <th key={g.date} style={styles.habitThDay} title={g.date}>
                          {new Date(g.date + "T00:00:00").getDate()}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.taskGrid.map((row) => (
                      <tr key={row.templateId}>
                        <td style={styles.habitTdTitle}>{row.title}</td>
                        {row.grid.map((g) => {
                          const cellStyle =
                            g.state === "n/a"
                              ? styles.gridCellNA
                              : g.state === "done"
                              ? styles.gridCellDone
                              : g.state === "pending"
                              ? styles.gridCellPending
                              : styles.gridCellMissed;
                          return (
                            <td key={g.date} style={styles.habitTd}>
                              <span style={{ ...styles.gridCell, ...cellStyle }} title={g.date}>
                                {g.state === "done" ? "✓" : g.state === "missed" ? "✕" : ""}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {dashboard.alerts.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  {dashboard.alerts.map((title) => (
                    <div key={title} style={styles.skipAlert}>
                      <IconAlert /> ALERT — "{title}" missed 3 days in a row. Reschedule it or drop it?
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section style={styles.card}>
              <h2 style={styles.cardTitle}>
                {new Date().toLocaleDateString(undefined, {
                  weekday: "long", day: "numeric", month: "long", year: "numeric",
                })}{" "}
                · {dashboard.dayStart}–{dashboard.dayEnd}
              </h2>
              <table style={styles.dayTable}>
                <thead>
                  <tr>
                    <th style={styles.dayTh}>Time</th>
                    <th style={styles.dayTh}>Task</th>
                    <th style={styles.dayThCenter}>Priority</th>
                    <th style={styles.dayThCenter}>Done</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.slots.map((s, idx) =>
                    s.type === "free" ? (
                      <tr key={idx} style={styles.dayTrFree}>
                        <td style={styles.dayTdTime}>{s.startTime}–{s.endTime}</td>
                        <td style={styles.dayTdFreeLabel} colSpan={3}>Free slot</td>
                      </tr>
                    ) : (
                      <tr key={idx}>
                        <td style={styles.dayTdTime}>{s.startTime}–{s.endTime}</td>
                        <td style={styles.dayTdTitle}>{s.title}</td>
                        <td style={styles.dayTdCenter}>
                          <span
                            style={{
                              ...styles.priorityPill,
                              color: PRIORITY_META[s.priority].color,
                              borderColor: PRIORITY_META[s.priority].color,
                            }}
                          >
                            {PRIORITY_META[s.priority].label}
                          </span>
                        </td>
                        <td style={styles.dayTdCenter}>
                          <button
                            onClick={() => toggleSlotCompletion(s.templateId, s.doneState)}
                            style={{
                              ...styles.gridCell,
                              ...(s.doneState === "done" ? styles.gridCellDone : styles.gridCellPending),
                            }}
                          >
                            {s.doneState === "done" ? "✓" : ""}
                          </button>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </section>
          </>
        )}

        {/* ---- Builder: for new users, or a routine user editing / adding a one-off day ---- */}
        {!dashboardLoading && (!dashboard?.hasRoutine || showBuilder) && (
          <>
        {/* ---- Working hours ---- */}
        <section style={styles.cardBlue}>
          <h2 style={styles.cardTitle}>Working hours</h2>
          <div style={styles.hoursRow}>
            <label style={styles.hourBlock}>
              <span style={styles.smallLabel}>Starts</span>
              <input type="time" value={dayStart} onChange={(e) => setDayStart(e.target.value)} style={styles.timeInput} />
            </label>
            <div style={styles.hoursDivider} />
            <label style={styles.hourBlock}>
              <span style={styles.smallLabel}>Ends</span>
              <input type="time" value={dayEnd} onChange={(e) => setDayEnd(e.target.value)} style={styles.timeInput} />
            </label>
          </div>
        </section>

        {/* ---- Tasks ---- */}
        <section style={styles.card}>
          <div style={styles.taskHeaderBar}>
            <h2 style={styles.cardTitle}>Tasks</h2>
          </div>
          <div style={styles.legendBar}>
            <span style={styles.legendChip}>
              <i style={{ ...styles.legendDot, background: "#38BDF8" }} />
              <strong>Flexible</strong>&nbsp;— just needs to be done before a deadline
            </span>
            <span style={styles.legendChip}>
              <i style={{ ...styles.legendDot, background: "#FF9152" }} />
              <strong>Fixed</strong>&nbsp;— happens at an exact time (class, gym, meeting)
            </span>
          </div>

          {tasks.map((task, i) => {
            const accent = task.type === "fixed" ? "#FF9152" : "#38BDF8";
            return (
              <div key={i} style={{ ...styles.taskCard, borderLeft: `4px solid ${accent}` }}>
                <div style={styles.taskTopRow}>
                  <input
                    placeholder="What's this task?"
                    value={task.title}
                    onChange={(e) => updateTask(i, "title", e.target.value)}
                    style={styles.titleInput}
                  />
                  <div style={styles.typeToggle}>
                    <button
                      type="button"
                      onClick={() => updateTask(i, "type", "flexible")}
                      style={{
                        ...styles.toggleBtn,
                        ...(task.type === "flexible" ? { background: "#38BDF8", color: "#fff" } : {}),
                      }}
                    >
                      Flexible
                    </button>
                    <button
                      type="button"
                      onClick={() => updateTask(i, "type", "fixed")}
                      style={{
                        ...styles.toggleBtn,
                        ...(task.type === "fixed" ? { background: "#FF9152", color: "#fff" } : {}),
                      }}
                    >
                      Fixed
                    </button>
                  </div>
                  <button onClick={() => removeTask(i)} style={styles.removeBtn} aria-label="Remove">
                    ×
                  </button>
                </div>

                <div style={styles.taskFieldsRow}>
                  {task.type === "flexible" ? (
                    <>
                      <div style={styles.fieldGroup}>
                        <span style={styles.smallLabel}>Duration</span>
                        <div style={styles.inlinePair}>
                          <input
                            type="number" min="0" placeholder="0"
                            value={Math.floor((task.durationMinutes || 0) / 60)}
                            onChange={(e) => {
                              const hrs = Number(e.target.value) || 0;
                              const mins = (task.durationMinutes || 0) % 60;
                              updateTask(i, "durationMinutes", hrs * 60 + mins);
                            }}
                            style={styles.miniInput}
                          />
                          <span style={styles.unit}>hr</span>
                          <input
                            type="number" min="0" max="59" placeholder="0"
                            value={(task.durationMinutes || 0) % 60}
                            onChange={(e) => {
                              const mins = Math.min(59, Number(e.target.value) || 0);
                              const hrs = Math.floor((task.durationMinutes || 0) / 60);
                              updateTask(i, "durationMinutes", hrs * 60 + mins);
                            }}
                            style={styles.miniInput}
                          />
                          <span style={styles.unit}>min</span>
                        </div>
                      </div>
                      <div style={styles.fieldGroup}>
                        <span style={styles.smallLabel}>Due by</span>
                        <input type="time" value={task.deadline} onChange={(e) => updateTask(i, "deadline", e.target.value)} style={styles.timeInput} />
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={styles.fieldGroup}>
                        <span style={styles.smallLabel}>Starts</span>
                        <input type="time" value={task.startTime} onChange={(e) => updateTask(i, "startTime", e.target.value)} style={styles.timeInput} />
                      </div>
                      <div style={styles.fieldGroup}>
                        <span style={styles.smallLabel}>Ends</span>
                        <input type="time" value={task.endTime} onChange={(e) => updateTask(i, "endTime", e.target.value)} style={styles.timeInput} />
                      </div>
                    </>
                  )}
                  <div style={styles.fieldGroup}>
                    <span style={styles.smallLabel}>Priority</span>
                    <select
                      value={task.priority}
                      onChange={(e) => updateTask(i, "priority", e.target.value)}
                      style={{ ...styles.timeInput, color: PRIORITY_META[task.priority].color, fontWeight: 700 }}
                    >
                      <option value={1}>Low</option>
                      <option value={2}>Medium</option>
                      <option value={3}>High</option>
                    </select>
                  </div>
                </div>

                {!task.showTravel ? (
                  <button type="button" onClick={() => updateTask(i, "showTravel", true)} style={styles.travelToggleBtn}>
                    <IconPin /> add travel time
                  </button>
                ) : (
                  <div style={styles.travelRow}>
                    <IconPin style={{ color: "#9AA6B8" }} />
                    <div style={styles.fieldGroup}>
                      <span style={styles.smallLabel}>Before</span>
                      <div style={styles.inlinePair}>
                        <input type="number" min="0" value={task.travelBeforeMinutes} onChange={(e) => updateTask(i, "travelBeforeMinutes", e.target.value)} style={styles.miniInput} />
                        <span style={styles.unit}>min</span>
                      </div>
                    </div>
                    <div style={styles.fieldGroup}>
                      <span style={styles.smallLabel}>After</span>
                      <div style={styles.inlinePair}>
                        <input type="number" min="0" value={task.travelAfterMinutes} onChange={(e) => updateTask(i, "travelAfterMinutes", e.target.value)} style={styles.miniInput} />
                        <span style={styles.unit}>min</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { updateTask(i, "showTravel", false); updateTask(i, "travelBeforeMinutes", 0); updateTask(i, "travelAfterMinutes", 0); }}
                      style={styles.removeTravelBtn}
                    >
                      remove
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          <button onClick={addTask} style={styles.addTaskBtn}>
            <IconPlus /> Add another task
          </button>

          <p style={styles.choiceHint}>
            Is this how your day usually looks, or just for today?
          </p>
          <div style={styles.choiceRow}>
            <button
              onClick={() => submitPlan("routine")}
              disabled={loading}
              style={{ ...styles.generateBtn, ...styles.routineBtn }}
            >
              <IconSparkle />
              {loading && saveMode === "routine" ? "Saving…" : "This is my daily routine"}
            </button>
            <button
              onClick={() => submitPlan("oneoff")}
              disabled={loading}
              style={{ ...styles.generateBtn, ...styles.oneoffBtn }}
            >
              {loading && saveMode === "oneoff" ? "Building…" : "Just for today"}
            </button>
          </div>

          {error && <p style={styles.errorText}><IconAlert /> {error}</p>}
        </section>

        {/* ---- Results: timeline ---- */}
        {result && (
          <section style={styles.cardAmber}>
            <div style={styles.resultsHeaderRow}>
              <h2 style={styles.cardTitle}>Your day</h2>
              <button
                onClick={() => downloadPlanAsPDF(result, dayStart, dayEnd)}
                style={styles.downloadBtn}
              >
                Download PDF
              </button>
            </div>
            <div style={styles.briefing}>{result.aiSummary}</div>

            <div style={styles.timeline}>
              {result.scheduled.map((t, idx) => (
                <div key={t.id} style={styles.timelineRow}>
                  <div style={styles.timelineRail}>
                    <span
                      style={{
                        ...styles.timelineDot,
                        background: t.type === "fixed" ? "#FF9152" : "#38BDF8",
                      }}
                    />
                    {idx < result.scheduled.length - 1 && <span style={styles.timelineLine} />}
                  </div>
                  <div style={styles.timelineCard}>
                    <div style={styles.timelineTime}>
                      {t.startTime} <span style={styles.timelineArrow}>→</span> {t.endTime}
                    </div>
                    <div style={styles.timelineTitleRow}>
                      <strong style={styles.timelineTitle}>{t.title}</strong>
                      <span style={{ ...styles.priorityPill, color: PRIORITY_META[t.priority].color, borderColor: PRIORITY_META[t.priority].color }}>
                        {PRIORITY_META[t.priority].label}
                      </span>
                    </div>
                    {(t.travelBeforeMinutes > 0 || t.travelAfterMinutes > 0) && (
                      <div style={styles.timelineMeta}>
                        <IconPin style={{ color: "#9AA6B8" }} />
                        {t.travelBeforeMinutes || 0}m before · {t.travelAfterMinutes || 0}m after
                      </div>
                    )}
                    {t.trimmed && (
                      <div style={styles.trimmedNote}>
                        Shortened from {minutesToTimeStr(t.originalStartMinutes)}–{minutesToTimeStr(t.originalEndMinutes)} to fit around a higher-priority task
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {result.scheduled.length === 0 && <p style={styles.emptyText}>Nothing scheduled yet.</p>}
            </div>

            {result.overflow.length > 0 && (
              <div style={styles.overflowBox}>
                <div style={styles.overflowHeading}><IconAlert /> Couldn't fit today</div>
                {result.overflow.map((t, i) => (
                  <div key={i} style={styles.overflowItem}>
                    {t.title} — {t.reason || (t.type === "fixed" ? "clashed with another fixed task" : "deadline too tight")}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- Styles ---------- */

const INK = "#2B3245";

const styles = {
  page: {
    fontFamily: "'Nunito Sans', system-ui, sans-serif",
    color: INK,
    background: "linear-gradient(160deg, #FFE8D6 0%, #FFD9E4 30%, #D6EEFF 70%, #C9F0E4 100%)",
    minHeight: "100vh",
  },
  hero: {
    position: "relative",
    overflow: "hidden",
    background: "linear-gradient(120deg, #FFB88C 0%, #FF9EBB 30%, #6FC3F7 65%, #5EDBC1 100%)",
    padding: "60px 24px 68px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 32,
  },
  heroBlobSvg: { position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0 },
  heroContent: { position: "relative", zIndex: 1, maxWidth: 480 },
  logoutBtn: {
    position: "absolute",
    top: 20,
    right: 24,
    zIndex: 2,
    background: "rgba(255,255,255,0.22)",
    color: "#fff",
    border: "none",
    borderRadius: 20,
    padding: "7px 14px",
    fontSize: 12.5,
    fontWeight: 700,
    cursor: "pointer",
  },
  heroKicker: {
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.16em",
    color: "#fff",
    background: "rgba(255,255,255,0.22)",
    padding: "5px 12px",
    borderRadius: 20,
    display: "inline-block",
  },
  heroTitle: {
    fontFamily: "'Fredoka', system-ui, sans-serif",
    fontWeight: 700,
    fontSize: 44,
    margin: "12px 0 10px",
    lineHeight: 1.08,
    color: "#fff",
    textShadow: "0 3px 14px rgba(30, 41, 82, 0.35)",
  },
  heroTitleAccent: {
    color: "#FFDCAE",
  },
  heroSubtitle: { fontSize: 16.5, color: "rgba(255,255,255,0.92)", lineHeight: 1.6, margin: 0, fontWeight: 600 },
  heroImage: { position: "relative", zIndex: 1, width: 200, height: 200, flexShrink: 0, filter: "drop-shadow(0 14px 26px rgba(30,41,82,0.25))" },
  content: { maxWidth: 720, margin: "-28px auto 0", padding: "0 20px 80px", position: "relative", zIndex: 2 },
  card: {
    background: "linear-gradient(160deg, rgba(255,232,214,0.9) 0%, rgba(214,238,255,0.85) 100%)",
    backdropFilter: "blur(6px)",
    border: "1px solid rgba(255,255,255,0.9)",
    borderRadius: 20,
    padding: 26,
    marginBottom: 20,
    boxShadow: "0 12px 32px rgba(139, 92, 246, 0.12)",
  },
  cardBlue: {
    background: "linear-gradient(160deg, rgba(214,245,232,0.85) 0%, rgba(199,240,220,0.7) 100%)",
    backdropFilter: "blur(6px)",
    border: "1px solid rgba(255,255,255,0.9)",
    borderRadius: 20,
    padding: 26,
    marginBottom: 20,
    boxShadow: "0 12px 32px rgba(56, 189, 248, 0.14)",
  },
  cardAmber: {
    background: "linear-gradient(160deg, rgba(255,219,179,0.45) 0%, rgba(214,238,255,0.4) 100%)",
    backdropFilter: "blur(6px)",
    border: "1px solid rgba(255,255,255,0.9)",
    borderRadius: 20,
    padding: 26,
    marginBottom: 20,
    boxShadow: "0 12px 32px rgba(244, 63, 94, 0.14)",
  },
  cardTitle: {
    fontFamily: "'Fredoka', system-ui, sans-serif",
    fontSize: 19,
    fontWeight: 600,
    margin: "0 0 16px",
  },
  hoursRow: { display: "flex", alignItems: "center", gap: 20 },
  hourBlock: { display: "flex", flexDirection: "column", gap: 6, flex: 1 },
  hoursDivider: { width: 24, height: 2, background: "#D9E9F5", marginTop: 20, flexShrink: 0 },
  smallLabel: { fontSize: 11.5, fontWeight: 700, color: "#9AA2B2", textTransform: "uppercase", letterSpacing: "0.03em" },
  timeInput: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1.5px solid rgba(139, 92, 246, 0.25)",
    fontSize: 14.5,
    background: "#FFF1E6",
    color: INK,
    outline: "none",
    fontFamily: "inherit",
  },
  taskHeaderBar: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 10 },
  legendBar: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginBottom: 18,
    padding: "12px 14px",
    background: "linear-gradient(120deg, #FFE3CC 0%, #D2ECFF 100%)",
    borderRadius: 10,
  },
  legendChip: { fontSize: 12.5, color: "#5A6478", lineHeight: 1.5, display: "flex", alignItems: "center" },
  legendDot: { width: 8, height: 8, borderRadius: "50%", display: "inline-block", marginRight: 7, flexShrink: 0 },
  taskCard: {
    background: "linear-gradient(135deg, #FFE3CC 0%, #D2ECFF 100%)",
    borderRadius: 14,
    padding: "16px 18px",
    marginBottom: 12,
  },
  taskTopRow: { display: "flex", gap: 10, alignItems: "center", marginBottom: 14 },
  titleInput: {
    flex: 1,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1.5px solid rgba(139, 92, 246, 0.25)",
    fontSize: 14.5,
    background: "#FFF1E6",
    color: INK,
    outline: "none",
    fontFamily: "inherit",
  },
  typeToggle: { display: "flex", background: "#FFF1E6", borderRadius: 9, padding: 2, flexShrink: 0 },
  toggleBtn: {
    border: "none",
    background: "transparent",
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 700,
    borderRadius: 7,
    cursor: "pointer",
    color: "#6B7280",
    transition: "background 0.15s",
  },
  removeBtn: {
    background: "transparent",
    color: "#9CA3AF",
    border: "none",
    fontSize: 22,
    lineHeight: 1,
    cursor: "pointer",
    width: 28,
    flexShrink: 0,
  },
  taskFieldsRow: { display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-end" },
  fieldGroup: { display: "flex", flexDirection: "column", gap: 6 },
  inlinePair: { display: "flex", alignItems: "center", gap: 6 },
  miniInput: {
    width: 52,
    padding: "10px 8px",
    borderRadius: 10,
    border: "1.5px solid rgba(139, 92, 246, 0.25)",
    fontSize: 14,
    background: "#FFF1E6",
    outline: "none",
    fontFamily: "inherit",
  },
  unit: { fontSize: 11.5, color: "#9AA2B2", fontWeight: 700 },
  travelToggleBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    background: "transparent",
    border: "none",
    color: "#9AA2B2",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    padding: 0,
  },
  travelRow: { display: "flex", alignItems: "flex-end", gap: 18, marginTop: 14, paddingTop: 14, borderTop: "1px dashed #D9E9F5" },
  removeTravelBtn: { background: "transparent", border: "none", color: "#C97A3A", fontSize: 11.5, fontWeight: 700, cursor: "pointer", marginBottom: 10 },
  repeatRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTop: "1px dashed rgba(56, 189, 248, 0.25)",
    fontSize: 12.5,
    color: "#5A6478",
    fontWeight: 600,
    cursor: "pointer",
  },
  repeatCheckbox: { width: 15, height: 15, cursor: "pointer", accentColor: "#38BDF8" },
  addTaskBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "#DCEEFF",
    color: "#0369A1",
    border: "none",
    borderRadius: 10,
    padding: "10px 16px",
    cursor: "pointer",
    marginTop: 4,
    fontWeight: 700,
    fontSize: 13.5,
  },
  generateBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    marginTop: 22,
    padding: "15px",
    background: "linear-gradient(120deg, #FF9F68 0%, #38BDF8 100%)",
    color: "#fff",
    border: "none",
    borderRadius: 14,
    fontFamily: "'Fredoka', system-ui, sans-serif",
    fontSize: 16.5,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 10px 24px rgba(167, 139, 250, 0.35)",
  },
  errorText: { display: "flex", alignItems: "center", gap: 7, color: "#C0512A", marginTop: 14, fontSize: 13.5, fontWeight: 700 },
  resultsHeaderRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 },
  downloadBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "#CCFBF1",
    color: "#0D9488",
    border: "none",
    borderRadius: 9,
    padding: "9px 14px",
    fontSize: 12.5,
    fontWeight: 700,
    cursor: "pointer",
  },
  briefing: {
    background: "linear-gradient(135deg, #FFEFDD 0%, #E3F3FF 100%)",
    borderRadius: 14,
    padding: "16px 18px",
    fontSize: 14.5,
    lineHeight: 1.65,
    color: "#7C4A26",
    marginBottom: 22,
  },
  timeline: { display: "flex", flexDirection: "column" },
  timelineRow: { display: "flex", gap: 14 },
  timelineRail: { display: "flex", flexDirection: "column", alignItems: "center", width: 14 },
  timelineDot: { width: 14, height: 14, borderRadius: "50%", flexShrink: 0, marginTop: 4, boxShadow: "0 0 0 4px #fff" },
  timelineLine: { flex: 1, width: 2, background: "#D9E9F5", minHeight: 30 },
  timelineCard: { flex: 1, paddingBottom: 22 },
  timelineTime: { fontSize: 12.5, fontWeight: 800, color: "#9AA2B2", marginBottom: 3 },
  timelineArrow: { color: "#C3CAD8" },
  timelineTitleRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  timelineTitle: { fontSize: 16, color: INK, fontWeight: 700 },
  priorityPill: { fontSize: 10.5, fontWeight: 800, border: "1.4px solid", borderRadius: 20, padding: "2px 9px" },
  timelineMeta: { display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#9AA2B2", marginTop: 4 },
  trimmedNote: {
    fontSize: 11.5,
    color: "#B4600F",
    background: "#FDF1E5",
    display: "inline-block",
    padding: "3px 9px",
    borderRadius: 7,
    marginTop: 6,
  },
  emptyText: { color: "#9AA2B2", fontSize: 14 },
  overflowBox: { marginTop: 8, padding: "14px 16px", background: "#FDF1E5", borderRadius: 12 },
  overflowHeading: { display: "flex", alignItems: "center", gap: 7, fontWeight: 800, color: "#B4600F", fontSize: 13, marginBottom: 8 },
  overflowItem: { fontSize: 13.5, color: "#8A5A2A", padding: "4px 0" },
  habitTable: {
    width: "100%",
    borderCollapse: "collapse",
    marginTop: 4,
  },
  habitTh: {
    textAlign: "left",
    fontSize: 11,
    fontWeight: 800,
    color: "#5A6478",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    padding: "0 8px 10px 4px",
    borderBottom: "2px solid #A9D8F5",
  },
  habitThDay: {
    fontSize: 11,
    fontWeight: 800,
    color: "#5A6478",
    padding: "0 0 10px",
    borderBottom: "2px solid #A9D8F5",
    textAlign: "center",
    width: 34,
  },
  habitThAcc: {
    fontSize: 11,
    fontWeight: 800,
    color: "#5A6478",
    padding: "0 4px 10px 10px",
    borderBottom: "2px solid #A9D8F5",
    textAlign: "right",
    width: 48,
  },
  habitTdTitle: {
    fontSize: 13.5,
    fontWeight: 700,
    color: "#2B3245",
    padding: "10px 8px 10px 4px",
    borderBottom: "1px solid #D9EEFB",
    whiteSpace: "nowrap",
  },
  habitTd: {
    padding: "8px 2px",
    borderBottom: "1px solid #D9EEFB",
    textAlign: "center",
  },
  habitTdAcc: {
    fontSize: 13,
    fontWeight: 800,
    color: "#0369A1",
    padding: "10px 4px 10px 10px",
    borderBottom: "1px solid #D9EEFB",
    textAlign: "right",
  },
  gridCell: {
    width: 28,
    height: 28,
    borderRadius: 7,
    border: "none",
    fontSize: 13,
    fontWeight: 800,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
  },
  gridCellDone: { background: "#22D3AA", color: "#fff" },
  gridCellMissed: { background: "#FCA5A5", color: "#B91C1C" },
  gridCellPending: { background: "#fff", border: "2px dashed #38BDF8", color: "#38BDF8" },
  gridCellNA: { background: "transparent" },
  skipAlert: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 700,
    color: "#fff",
    background: "#DC2626",
    padding: "7px 12px",
    borderRadius: 8,
    marginBottom: 6,
  },
  choiceHint: { fontSize: 12.5, color: "#6B7280", fontWeight: 600, marginTop: 20, marginBottom: 8, textAlign: "center" },
  choiceRow: { display: "flex", gap: 10 },
  routineBtn: { flex: 1, marginTop: 0 },
  oneoffBtn: {
    flex: 1,
    marginTop: 0,
    background: "#F1F5F9",
    color: "#475569",
    boxShadow: "none",
  },
  scoreBanner: { display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 },
  scoreBig: { fontFamily: "'Fredoka', system-ui, sans-serif", fontSize: 32, fontWeight: 700, color: "#2B3245" },
  scoreText: { fontSize: 13.5, color: "#6B7280", fontWeight: 600 },
  historyRow: { display: "flex", alignItems: "flex-end", gap: 8, marginTop: 18, height: 50 },
  historyDay: { display: "flex", flexDirection: "column", alignItems: "center", gap: 5, flex: 1 },
  historyLabel: { fontSize: 10.5, fontWeight: 700, color: "#9AA2B2" },
  historyBar: { width: "100%", maxWidth: 22, borderRadius: 4, transition: "height 0.2s" },
  dayTable: { width: "100%", borderCollapse: "collapse", marginTop: 6 },
  dayTh: {
    textAlign: "left",
    fontSize: 11,
    fontWeight: 800,
    color: "#9AA2B2",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    padding: "0 8px 10px 4px",
    borderBottom: "2px solid #F3D9C4",
  },
  dayThCenter: {
    fontSize: 11,
    fontWeight: 800,
    color: "#9AA2B2",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    padding: "0 8px 10px",
    borderBottom: "2px solid #F3D9C4",
    textAlign: "center",
  },
  dayTdTime: {
    fontSize: 12.5,
    fontWeight: 700,
    color: "#5A6478",
    padding: "12px 8px 12px 4px",
    borderBottom: "1px solid #F5E8DC",
    whiteSpace: "nowrap",
  },
  dayTdTitle: {
    fontSize: 14.5,
    fontWeight: 700,
    color: "#2B3245",
    padding: "12px 8px",
    borderBottom: "1px solid #F5E8DC",
  },
  dayTdCenter: {
    padding: "12px 8px",
    borderBottom: "1px solid #F5E8DC",
    textAlign: "center",
  },
  dayTrFree: { opacity: 0.55 },
  dayTdFreeLabel: {
    fontSize: 13,
    color: "#9AA2B2",
    fontStyle: "italic",
    padding: "10px 8px",
    borderBottom: "1px solid #F5E8DC",
  },
};