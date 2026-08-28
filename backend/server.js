import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";
import Groq from "groq-sdk";
import { generateSchedule, minutesToTime, timeToMinutes } from "./scheduler.js";
import { createAuthRouter, requireAuth } from "./auth.js";

dotenv.config();

const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const app = express();
app.use(cors({ origin: "https://smart-daily-planner-tan.vercel.app" }));
app.use(express.json());

// Auth routes: POST /api/auth/signup, POST /api/auth/login — no login required to hit these
app.use("/api/auth", createAuthRouter(pool));

function describeTaskForPrompt(t) {
  const travelBits = [];
  if (t.travelBeforeMinutes) travelBits.push(`${t.travelBeforeMinutes} min travel before`);
  if (t.travelAfterMinutes) travelBits.push(`${t.travelAfterMinutes} min travel after`);
  const travelText = travelBits.length ? ` (${travelBits.join(", ")})` : "";
  const fixedTag = t.type === "fixed" ? " [fixed appointment]" : "";
  return `- ${t.title}${fixedTag} (${minutesToTime(t.startMinutes)}–${minutesToTime(
    t.endMinutes
  )}, priority ${t.priority})${travelText}`;
}

function buildSummaryPrompt(scheduled, overflow) {
  const scheduledText = scheduled.map(describeTaskForPrompt).join("\n");
  const overflowText =
    overflow.length > 0
      ? overflow
          .map((t) =>
            t.type === "fixed"
              ? `- ${t.title} (fixed, conflicted with another commitment)`
              : `- ${t.title} (deadline ${minutesToTime(t.deadlineMinutes)})`
          )
          .join("\n")
      : "None — everything fit.";

  return `You are a friendly daily planning assistant. A scheduling algorithm has already decided the exact times below (including any travel buffers) — do NOT change any times or add new tasks. Your only job is to present this plan in 3-5 short, encouraging sentences, mention travel time where relevant, and briefly note any overflow tasks that didn't fit.

Scheduled tasks:
${scheduledText || "None"}

Tasks that did not fit today (overflow):
${overflowText}

Write the response as a short, warm daily briefing.`;
}


// ---- Recurring task templates ----

// Get all of the logged-in user's active recurring task templates
app.get("/api/templates", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM task_templates WHERE user_id = $1 AND active = TRUE ORDER BY created_at`,
      [req.userId]
    );
    res.json({ success: true, templates: result.rows });
  } catch (err) {
    console.error("❌ BACKEND ERROR:", err);
    res.status(500).json({ success: false, error: "Could not fetch recurring tasks." });
  }
});

// Create a new recurring task template
app.post("/api/templates", requireAuth, async (req, res) => {
  try {
    const { title, type, priority, startTime, endTime, durationMinutes, deadline, travelBeforeMinutes, travelAfterMinutes } = req.body;

    const isFixed = type === "fixed";
    const result = await pool.query(
      `INSERT INTO task_templates
        (user_id, title, type, priority, start_minutes, end_minutes, duration_minutes, deadline_minutes, travel_before_minutes, travel_after_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        req.userId,
        title,
        isFixed ? "fixed" : "flexible",
        Number(priority),
        isFixed ? timeToMinutes(startTime) : null,
        isFixed ? timeToMinutes(endTime) : null,
        isFixed ? null : Number(durationMinutes),
        isFixed ? null : timeToMinutes(deadline),
        Number(travelBeforeMinutes) || 0,
        Number(travelAfterMinutes) || 0,
      ]
    );
    res.json({ success: true, template: result.rows[0] });
  } catch (err) {
    console.error("❌ BACKEND ERROR:", err);
    res.status(500).json({ success: false, error: "Could not save recurring task." });
  }
});

// Pause (soft-delete) a recurring task template — keeps history intact
app.delete("/api/templates/:id", requireAuth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE task_templates SET active = FALSE WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ BACKEND ERROR:", err);
    res.status(500).json({ success: false, error: "Could not remove recurring task." });
  }
});

// ---- Daily routine (the "save as my daily routine, track consistency" path) ----

// Save (or replace) the user's whole daily routine in one go: their working
// hours plus every task, all saved as recurring templates. Replaces any
// previously-saved routine templates rather than accumulating duplicates.
app.post("/api/routine", requireAuth, async (req, res) => {
  try {
    const { dayStart, dayEnd, tasks } = req.body;
    const userId = req.userId;

    await pool.query(
      `UPDATE users SET routine_day_start_minutes = $1, routine_day_end_minutes = $2 WHERE id = $3`,
      [timeToMinutes(dayStart), timeToMinutes(dayEnd), userId]
    );

    // Replace old routine templates with the new set
    await pool.query(`UPDATE task_templates SET active = FALSE WHERE user_id = $1`, [userId]);

    for (const t of tasks) {
      const isFixed = t.type === "fixed";
      await pool.query(
        `INSERT INTO task_templates
          (user_id, title, type, priority, start_minutes, end_minutes, duration_minutes, deadline_minutes, travel_before_minutes, travel_after_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          userId,
          t.title,
          isFixed ? "fixed" : "flexible",
          Number(t.priority),
          isFixed ? timeToMinutes(t.startTime) : null,
          isFixed ? timeToMinutes(t.endTime) : null,
          isFixed ? null : Number(t.durationMinutes),
          isFixed ? null : timeToMinutes(t.deadline),
          Number(t.travelBeforeMinutes) || 0,
          Number(t.travelAfterMinutes) || 0,
        ]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ BACKEND ERROR:", err);
    res.status(500).json({ success: false, error: "Could not save your routine." });
  }
});

function toLocalDateStr(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Fill the gaps between scheduled tasks (and before/after them) with
// "free" slots, so the dashboard shows a complete, gapless day timeline —
// exactly like a real timetable.
function buildDaySlots(scheduled, dayStartMinutes, dayEndMinutes) {
  const sorted = [...scheduled].sort((a, b) => a.startMinutes - b.startMinutes);
  const slots = [];
  let cursor = dayStartMinutes;

  for (const t of sorted) {
    if (t.startMinutes > cursor) {
      slots.push({ type: "free", startMinutes: cursor, endMinutes: t.startMinutes });
    }
    slots.push({ type: "task", ...t });
    cursor = Math.max(cursor, t.endMinutes);
  }
  if (cursor < dayEndMinutes) {
    slots.push({ type: "free", startMinutes: cursor, endMinutes: dayEndMinutes });
  }
  return slots;
}

// The main dashboard: today's full timetable (with tick state per task)
// plus a whole-day consistency score, a short history, and skip alerts.
app.get("/api/dashboard/today", requireAuth, async (req, res) => {
  try {
    const userId = req.userId;

    const userResult = await pool.query(
      `SELECT routine_day_start_minutes, routine_day_end_minutes FROM users WHERE id = $1`,
      [userId]
    );
    const { routine_day_start_minutes, routine_day_end_minutes } = userResult.rows[0];

    if (routine_day_start_minutes == null || routine_day_end_minutes == null) {
      return res.json({ success: true, hasRoutine: false });
    }

    const templatesResult = await pool.query(
      `SELECT * FROM task_templates WHERE user_id = $1 AND active = TRUE`,
      [userId]
    );

    if (templatesResult.rows.length === 0) {
      return res.json({ success: true, hasRoutine: false });
    }

    const normalizedTasks = templatesResult.rows.map((t) => {
      const input = templateToTaskInput(t);
      return {
        id: t.id,
        title: input.title,
        priority: input.priority,
        type: input.type,
        travelBeforeMinutes: input.travelBeforeMinutes,
        travelAfterMinutes: input.travelAfterMinutes,
        templateId: t.id,
        ...(input.type === "fixed"
          ? { startMinutes: timeToMinutes(input.startTime), endMinutes: timeToMinutes(input.endTime) }
          : { durationMinutes: input.durationMinutes, deadlineMinutes: timeToMinutes(input.deadline) }),
      };
    });

    const { scheduled } = generateSchedule(
      normalizedTasks,
      routine_day_start_minutes,
      routine_day_end_minutes
    );

    const todayStr = toLocalDateStr(new Date());

    // Today's completion state for every scheduled template
    const templateIds = scheduled.map((t) => t.templateId);
    let completionMap = {};
    if (templateIds.length > 0) {
      const compResult = await pool.query(
        `SELECT template_id, done FROM task_completions WHERE template_id = ANY($1) AND completion_date = $2`,
        [templateIds, todayStr]
      );
      compResult.rows.forEach((r) => {
        completionMap[r.template_id] = r.done;
      });
    }

    const scheduledWithState = scheduled.map((t) => ({
      ...t,
      doneState:
        t.templateId in completionMap
          ? completionMap[t.templateId]
            ? "done"
            : "missed"
          : "pending",
    }));

    const slots = buildDaySlots(scheduledWithState, routine_day_start_minutes, routine_day_end_minutes).map(
      (s) => ({
        ...s,
        startTime: minutesToTime(s.startMinutes),
        endTime: minutesToTime(s.endMinutes),
      })
    );

    // Whole-day score: how many of today's real tasks are ticked done so far
    const realSlots = scheduledWithState;
    const doneCount = realSlots.filter((s) => s.doneState === "done").length;
    const totalCount = realSlots.length;
    const todayScorePercent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : null;

    // Last 7 days' whole-day scores (based on whatever was actually tracked that day)
    const dayScores = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = toLocalDateStr(d);
      const dayResult = await pool.query(
        `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE tc.done = TRUE) AS completed
         FROM task_completions tc
         JOIN task_templates tt ON tc.template_id = tt.id
         WHERE tt.user_id = $1 AND tc.completion_date = $2`,
        [userId, dateStr]
      );
      const { total, completed } = dayResult.rows[0];
      dayScores.push({
        date: dateStr,
        percent: total > 0 ? Math.round((completed / total) * 100) : null,
      });
    }

    // Per-task 7-day tick/cross grid — lets the person see at a glance
    // WHICH specific task was missed on WHICH day, not just an overall %.
    const dateList = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dateList.push(toLocalDateStr(d));
    }

    const taskGrid = [];
    for (const template of templatesResult.rows) {
      const createdDate = toLocalDateStr(new Date(template.created_at));
      const historyResult = await pool.query(
        `SELECT completion_date, done FROM task_completions
         WHERE template_id = $1 AND completion_date >= $2
         ORDER BY completion_date ASC`,
        [template.id, dateList[0]]
      );
      const historyMap = {};
      historyResult.rows.forEach((r) => {
        historyMap[toLocalDateStr(new Date(r.completion_date))] = r.done;
      });

      const grid = dateList.map((date) => {
        if (date < createdDate) return { date, state: "n/a" };
        if (date in historyMap) return { date, state: historyMap[date] ? "done" : "missed" };
        const isToday = date === todayStr;
        return { date, state: isToday ? "pending" : "missed" };
      });

      taskGrid.push({ templateId: template.id, title: template.title, grid });
    }

    // Skip-streak alerts: any template missed on its last 3 tracked days
    const alerts = [];
    for (const template of templatesResult.rows) {
      const recentResult = await pool.query(
        `SELECT done FROM task_completions
         WHERE template_id = $1
         ORDER BY completion_date DESC
         LIMIT 3`,
        [template.id]
      );
      const recent = recentResult.rows;
      if (recent.length === 3 && recent.every((r) => r.done === false)) {
        alerts.push(template.title);
      }
    }

    res.json({
      success: true,
      hasRoutine: true,
      dayStart: minutesToTime(routine_day_start_minutes),
      dayEnd: minutesToTime(routine_day_end_minutes),
      slots,
      todayScore: { done: doneCount, total: totalCount, percent: todayScorePercent },
      dayScores,
      taskGrid,
      alerts,
    });
  } catch (err) {
    console.error("❌ BACKEND ERROR:", err);
    res.status(500).json({ success: false, error: "Could not load dashboard." });
  }
});

// Convert a saved template into the same shape /api/plan expects from manually-entered tasks
function templateToTaskInput(t) {
  const base = {
    title: t.title,
    priority: t.priority,
    type: t.type,
    travelBeforeMinutes: t.travel_before_minutes,
    travelAfterMinutes: t.travel_after_minutes,
    templateId: t.id, // tag so we know this came from a template
  };
  if (t.type === "fixed") {
    return { ...base, startTime: minutesToTime(t.start_minutes), endTime: minutesToTime(t.end_minutes) };
  }
  return { ...base, durationMinutes: t.duration_minutes, deadline: minutesToTime(t.deadline_minutes) };
}

app.post("/api/plan", requireAuth, async (req, res) => {
  try {
    const { planDate, dayStart, dayEnd, tasks } = req.body;
    const userId = req.userId; // from verified JWT, not the request body

    // Pull in the user's active recurring templates and merge them with
    // whatever one-off tasks they entered for today.
    const templatesResult = await pool.query(
      `SELECT * FROM task_templates WHERE user_id = $1 AND active = TRUE`,
      [userId]
    );
    const recurringTasks = templatesResult.rows.map(templateToTaskInput);
    const allTasks = [...recurringTasks, ...tasks];

    const dayStartMinutes = timeToMinutes(dayStart);
    const dayEndMinutes = timeToMinutes(dayEnd);

    const normalizedTasks = allTasks.map((t, i) => {
      const base = {
        id: i,
        title: t.title,
        priority: Number(t.priority),
        type: t.type === "fixed" ? "fixed" : "flexible",
        travelBeforeMinutes: Number(t.travelBeforeMinutes) || 0,
        travelAfterMinutes: Number(t.travelAfterMinutes) || 0,
        templateId: t.templateId || null,
      };

      if (base.type === "fixed") {
        return {
          ...base,
          startMinutes: timeToMinutes(t.startTime),
          endMinutes: timeToMinutes(t.endTime),
        };
      }

      return {
        ...base,
        durationMinutes: Number(t.durationMinutes),
        deadlineMinutes: timeToMinutes(t.deadline),
      };
    });

    const { scheduled, overflow } = generateSchedule(
      normalizedTasks,
      dayStartMinutes,
      dayEndMinutes
    );

    let aiSummary = "";
    try {
      const prompt = buildSummaryPrompt(scheduled, overflow);
      const completion = await groq.chat.completions.create({
        model: "openai/gpt-oss-120b",
        messages: [{ role: "user", content: prompt }],
      });
      aiSummary = completion.choices[0]?.message?.content || "";
    } catch (aiErr) {
      console.error("⚠️ AI summary failed, continuing without it:", aiErr.message);
      aiSummary = "AI summary unavailable right now — but your schedule below is ready.";
    }

    const planResult = await pool.query(
      `INSERT INTO plans (user_id, plan_date, day_start_minutes, day_end_minutes, ai_summary)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, planDate, dayStartMinutes, dayEndMinutes, aiSummary]
    );
    const planId = planResult.rows[0].id;

    for (const t of scheduled) {
      await pool.query(
        `INSERT INTO tasks (plan_id, template_id, title, duration_minutes, deadline_minutes, priority, status, start_minutes, end_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', $7, $8)`,
        [
          planId,
          t.templateId || null,
          t.title,
          t.endMinutes - t.startMinutes,
          t.type === "fixed" ? t.endMinutes : t.deadlineMinutes,
          t.priority,
          t.startMinutes,
          t.endMinutes,
        ]
      );
    }
    for (const t of overflow) {
      await pool.query(
        `INSERT INTO tasks (plan_id, template_id, title, duration_minutes, deadline_minutes, priority, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'overflow')`,
        [
          planId,
          t.templateId || null,
          t.title,
          t.durationMinutes || t.endMinutes - t.startMinutes || 0,
          t.deadlineMinutes || t.endMinutes || 0,
          t.priority,
        ]
      );
    }

    res.json({
      success: true,
      planId,
      scheduled: scheduled.map((t) => ({
        ...t,
        startTime: minutesToTime(t.startMinutes),
        endTime: minutesToTime(t.endMinutes),
      })),
      overflow,
      aiSummary,
    });
  } catch (err) {
    console.error("❌ BACKEND ERROR:", err);
    res.status(500).json({ success: false, error: "Could not generate plan." });
  }
});

app.get("/api/plans", requireAuth, async (req, res) => {
  try {
    const plans = await pool.query(
      `SELECT * FROM plans WHERE user_id = $1 ORDER BY plan_date DESC`,
      [req.userId]
    );
    res.json({ success: true, plans: plans.rows });
  } catch (err) {
    console.error("❌ BACKEND ERROR:", err);
    res.status(500).json({ success: false, error: "Could not fetch plans." });
  }
});

app.patch("/api/tasks/:taskId/done", requireAuth, async (req, res) => {
  try {
    const { taskId } = req.params;
    await pool.query(`UPDATE tasks SET status = 'done' WHERE id = $1`, [taskId]);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ BACKEND ERROR:", err);
    res.status(500).json({ success: false, error: "Could not update task." });
  }
});

// ---- Completion tracking for recurring tasks ----

// Mark a recurring task done/not-done for a specific date.
// "Upsert" — if a record for that (template, date) already exists, update it;
// otherwise insert a new one. Relies on the UNIQUE(template_id, completion_date)
// constraint from the schema.
app.post("/api/completions", requireAuth, async (req, res) => {
  try {
    const { templateId, date, done } = req.body;

    // Confirm this template actually belongs to the logged-in user before
    // touching it — otherwise anyone could tick someone else's tasks.
    const templateCheck = await pool.query(
      `SELECT id FROM task_templates WHERE id = $1 AND user_id = $2`,
      [templateId, req.userId]
    );
    if (templateCheck.rows.length === 0) {
      return res.status(403).json({ success: false, error: "Not your task." });
    }

    await pool.query(
      `INSERT INTO task_completions (template_id, completion_date, done)
       VALUES ($1, $2, $3)
       ON CONFLICT (template_id, completion_date)
       DO UPDATE SET done = $3`,
      [templateId, date, done]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ BACKEND ERROR:", err);
    res.status(500).json({ success: false, error: "Could not save completion." });
  }
});

// For each of the user's active recurring templates, return:
//  - accuracy % (days done ÷ days tracked, since the template was created)
//  - whether the last 3 tracked days were all skipped (for the alert)
//  - today's completion status, if already recorded
app.get("/api/completions/summary", requireAuth, async (req, res) => {
  try {
    const templatesResult = await pool.query(
      `SELECT * FROM task_templates WHERE user_id = $1 AND active = TRUE ORDER BY created_at`,
      [req.userId]
    );

    // IMPORTANT: never use .toISOString() for "which calendar day is this"
    // logic — it converts to UTC, which silently shifts the date for
    // timezones ahead of UTC (like IST) around midnight. Format using
    // local date parts instead, so "today" always matches the server's
    // actual local calendar day.
    function toLocalDateStr(d) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }

    const GRID_DAYS = 7;
    const todayStr = toLocalDateStr(new Date());

    // Build the last GRID_DAYS dates (oldest -> newest, ending today)
    const dateList = [];
    for (let i = GRID_DAYS - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dateList.push(toLocalDateStr(d));
    }

    const summaries = [];
    for (const template of templatesResult.rows) {
      // Only count days on/after the template was created — a task added
      // yesterday shouldn't show "missed" for days before it existed.
      const createdDate = toLocalDateStr(new Date(template.created_at));

      const completionsResult = await pool.query(
        `SELECT completion_date, done FROM task_completions
         WHERE template_id = $1 AND completion_date >= $2
         ORDER BY completion_date ASC`,
        [template.id, dateList[0]]
      );
      const completionMap = {};
      completionsResult.rows.forEach((r) => {
        completionMap[toLocalDateStr(new Date(r.completion_date))] = r.done;
      });

      // Build the visible grid: for each of the last 7 days, was it done,
      // missed (existed but wasn't ticked), or not-yet-applicable (before
      // the task was created)?
      const grid = dateList.map((date) => {
        if (date < createdDate) return { date, state: "n/a" };
        if (date in completionMap) {
          return { date, state: completionMap[date] ? "done" : "missed" };
        }
        // No record for a tracked day = treated as missed, EXCEPT today,
        // which is still "pending" until the person ticks it.
        const isToday = date === todayStr;
        return { date, state: isToday ? "pending" : "missed" };
      });

      // Accuracy: over all applicable (non "n/a") days in the grid
      const applicable = grid.filter((g) => g.state !== "n/a" && g.state !== "pending");
      const doneCount = applicable.filter((g) => g.state === "done").length;
      const accuracy = applicable.length > 0 ? Math.round((doneCount / applicable.length) * 100) : null;

      // Skip-streak: last 3 applicable days (excluding today/pending) all missed
      const lastThree = grid
        .filter((g) => g.state !== "n/a" && g.state !== "pending")
        .slice(-3);
      const skippedStreak = lastThree.length === 3 && lastThree.every((g) => g.state === "missed");

      const todayEntry = grid[grid.length - 1];
      const doneToday = todayEntry.state === "done";

      summaries.push({
        templateId: template.id,
        title: template.title,
        accuracy,
        grid,
        skippedStreak,
        doneToday,
      });
    }

    res.json({ success: true, summaries });
  } catch (err) {
    console.error("❌ BACKEND ERROR:", err);
    res.status(500).json({ success: false, error: "Could not fetch completion summary." });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Smart Daily Planner backend running on port ${PORT}`);
});