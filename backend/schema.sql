-- Smart Daily Planner — PostgreSQL schema

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  plan_date DATE NOT NULL,
  day_start_minutes INTEGER NOT NULL,   -- e.g. 540 = 9:00 AM
  day_end_minutes INTEGER NOT NULL,     -- e.g. 1260 = 9:00 PM
  ai_summary TEXT,                      -- Gemini-generated natural language summary
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER REFERENCES plans(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  duration_minutes INTEGER NOT NULL,
  deadline_minutes INTEGER NOT NULL,
  priority INTEGER NOT NULL CHECK (priority IN (1, 2, 3)), -- 1=low, 2=med, 3=high
  status VARCHAR(20) DEFAULT 'scheduled',  -- 'scheduled' | 'overflow' | 'done'
  start_minutes INTEGER,                    -- filled in after scheduling
  end_minutes INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_plan_id ON tasks(plan_id);
CREATE INDEX IF NOT EXISTS idx_plans_user_id ON plans(user_id);
