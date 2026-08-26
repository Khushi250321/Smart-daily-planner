/**
 * scheduler.js
 *
 * Greedy scheduling algorithm for Smart Daily Planner — now realistic:
 *
 *   - FIXED tasks: have an exact start/end time (e.g. "Gym, 6:00–7:00 PM").
 *     These are non-negotiable and are placed on the calendar first.
 *   - FLEXIBLE tasks: have a duration + deadline (e.g. "DSA practice, 90 min,
 *     due by 6 PM"). These are greedily packed into whatever time is left
 *     over after fixed tasks are placed.
 *   - Any task (fixed or flexible) can carry travelBeforeMinutes /
 *     travelAfterMinutes — buffer time that blocks the calendar too (e.g.
 *     15 min travel to the gym), but isn't shown as a separate task.
 *
 * This is a two-phase greedy approach:
 *   Phase 1 — place fixed tasks (expanded by their travel buffers) onto a
 *             shared "busy" timeline, processed HIGHEST PRIORITY FIRST. When
 *             a lower-priority fixed task partially overlaps a slot already
 *             claimed by a higher-priority one, it is TRIMMED to whatever
 *             free portion of its window remains (e.g. "abc, 1–3 PM" next to
 *             a higher-priority "xyz, 2–3 PM" becomes "abc, 1–2 PM") rather
 *             than being dropped outright. Only if no meaningful time is
 *             left (or it starts outside working hours) does it go to
 *             overflow. Travel buffers are only kept when the task fits
 *             untrimmed, since trimming a travel window doesn't make sense.
 *   Phase 2 — sort flexible tasks by priority (desc) then deadline (asc),
 *             and greedily slot each into the earliest gap in the busy
 *             timeline that respects its deadline and travel buffers.
 */

const MIN_TRIMMED_MINUTES = 10; // below this, trimming isn't worth keeping

function expandWithTravel(task) {
  const before = Number(task.travelBeforeMinutes) || 0;
  const after = Number(task.travelAfterMinutes) || 0;
  return { before, after };
}

// Given a [start, end) window and a sorted list of busy [s, e) intervals,
// return the free sub-intervals inside that window.
function freeGapsInWindow(start, end, busy) {
  const gaps = [];
  let cursor = start;
  for (const [bStart, bEnd] of busy) {
    if (bEnd <= cursor) continue;
    if (bStart >= end) break;
    if (bStart > cursor) gaps.push([cursor, Math.min(bStart, end)]);
    cursor = Math.max(cursor, bEnd);
    if (cursor >= end) break;
  }
  if (cursor < end) gaps.push([cursor, end]);
  return gaps;
}

function generateSchedule(tasks, dayStartMinutes, dayEndMinutes) {
  const fixed = tasks.filter((t) => t.type === "fixed");
  const flexible = tasks.filter((t) => t.type !== "fixed");

  const busy = []; // sorted list of [start, end) — includes travel buffers
  const scheduled = [];
  const overflow = [];

  // ---- Phase 1: place fixed tasks (trim on partial conflict) ----
  const sortedFixed = [...fixed].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.startMinutes - b.startMinutes;
  });

  for (const task of sortedFixed) {
    const { before, after } = expandWithTravel(task);
    const fullStart = task.startMinutes - before;
    const fullEnd = task.endMinutes + after;

    const withinDay = fullStart >= dayStartMinutes && fullEnd <= dayEndMinutes;
    const overlapsBusy = busy.some(([s, e]) => fullStart < e && s < fullEnd);

    // Case 1: fits perfectly with travel buffers intact — place as-is.
    if (withinDay && !overlapsBusy) {
      busy.push([fullStart, fullEnd]);
      busy.sort((a, b) => a[0] - b[0]);
      scheduled.push({
        ...task,
        startMinutes: task.startMinutes,
        endMinutes: task.endMinutes,
        travelBeforeMinutes: before,
        travelAfterMinutes: after,
      });
      continue;
    }

    // Case 2: try trimming the CORE task window (no travel buffer) to the
    // largest free gap available, clipped to the working day.
    const coreStart = Math.max(task.startMinutes, dayStartMinutes);
    const coreEnd = Math.min(task.endMinutes, dayEndMinutes);

    if (coreStart >= coreEnd) {
      overflow.push({ ...task, reason: "outside working hours" });
      continue;
    }

    const gaps = freeGapsInWindow(coreStart, coreEnd, busy);
    const bestGap = gaps.reduce(
      (best, g) => (g[1] - g[0] > best[1] - best[0] ? g : best),
      [0, 0]
    );
    const gapDuration = bestGap[1] - bestGap[0];

    if (gapDuration < MIN_TRIMMED_MINUTES) {
      overflow.push({ ...task, reason: "no free time left in this slot" });
      continue;
    }

    const trimmedStart = bestGap[0];
    const trimmedEnd = bestGap[1];
    const wasTrimmed = trimmedStart !== task.startMinutes || trimmedEnd !== task.endMinutes;

    busy.push([trimmedStart, trimmedEnd]);
    busy.sort((a, b) => a[0] - b[0]);

    scheduled.push({
      ...task,
      startMinutes: trimmedStart,
      endMinutes: trimmedEnd,
      travelBeforeMinutes: 0, // travel buffer dropped when trimmed
      travelAfterMinutes: 0,
      trimmed: wasTrimmed,
      originalStartMinutes: task.startMinutes,
      originalEndMinutes: task.endMinutes,
    });
  }

  // ---- Phase 2: greedily place flexible tasks into remaining gaps ----
  const sortedFlexible = [...flexible].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.deadlineMinutes - b.deadlineMinutes;
  });

  function findEarliestSlot(durationMinutes, deadlineMinutes, before, after) {
    const totalBlock = before + durationMinutes + after;
    let cursor = dayStartMinutes;

    for (const [busyStart, busyEnd] of busy) {
      if (cursor + totalBlock <= busyStart) {
        if (cursor + before + durationMinutes <= deadlineMinutes) {
          return cursor;
        }
        return null;
      }
      cursor = Math.max(cursor, busyEnd);
    }

    if (
      cursor + totalBlock <= dayEndMinutes &&
      cursor + before + durationMinutes <= deadlineMinutes
    ) {
      return cursor;
    }

    return null;
  }

  for (const task of sortedFlexible) {
    const { before, after } = expandWithTravel(task);
    const blockStart = findEarliestSlot(
      task.durationMinutes,
      task.deadlineMinutes,
      before,
      after
    );

    if (blockStart === null) {
      overflow.push(task);
      continue;
    }

    const taskStart = blockStart + before;
    const taskEnd = taskStart + task.durationMinutes;
    const blockEnd = taskEnd + after;

    scheduled.push({
      ...task,
      startMinutes: taskStart,
      endMinutes: taskEnd,
      travelBeforeMinutes: before,
      travelAfterMinutes: after,
    });

    busy.push([blockStart, blockEnd]);
    busy.sort((a, b) => a[0] - b[0]);
  }

  scheduled.sort((a, b) => a.startMinutes - b.startMinutes);

  return { scheduled, overflow };
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60).toString().padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

export { generateSchedule, timeToMinutes, minutesToTime };