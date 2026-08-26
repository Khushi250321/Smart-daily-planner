# Smart Daily Planner

A daily task planner that uses a **greedy scheduling algorithm** to build your
day, then uses **Gemini (free tier)** to explain the plan in plain language.

The AI does not decide your schedule — the algorithm does. AI is only used to
turn structured output into a friendly written summary.

## Stack
- Frontend: React (Vite)
- Backend: Node.js + Express
- Database: PostgreSQL
- AI: Google Gemini API (`gemini-2.0-flash`, free tier, text-only)

## The Algorithm (backend/scheduler.js)

This is a variant of the classic **Job Sequencing with Deadlines** greedy
problem, extended with priority weighting:

1. Sort tasks by priority (high → low), then by deadline (earliest → latest)
   as a tiebreaker. This is the greedy choice: always try to place the most
   valuable task first.
2. For each task, find the earliest open time slot that still lets it finish
   before its deadline.
3. If no such slot exists, the task is marked "overflow" (not forced in).

This is a **greedy heuristic**, not a guaranteed globally-optimal solution —
true optimal scheduling with deadlines, durations, and priorities is closer to
a weighted interval scheduling / knapsack problem, which would need dynamic
programming. The greedy approach was chosen because it's fast (works well for
a small number of daily tasks) and good enough for this use case — a fair
tradeoff to discuss in interviews.

## Setup

### 1. Database
```bash
createdb smart_planner
psql smart_planner < backend/schema.sql
```

### 2. Backend
```bash
cd backend
npm install
cp .env.example .env
# edit .env: add your DATABASE_URL and GEMINI_API_KEY
npm start
```
Get a free Gemini API key at https://aistudio.google.com/apikey (no billing
required for text models on the free tier).

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```
Open the printed localhost URL in your browser.

## Notes
- Auth (JWT, per-user login) is stubbed with a hardcoded `userId: 1` for now —
  next step is wiring up real login using the same JWT pattern used in other
  projects.
- `tasks.status` supports `scheduled`, `overflow`, and `done` — a "mark done"
  endpoint already exists (`PATCH /api/tasks/:taskId/done`) for a future
  progress-tracking view.
