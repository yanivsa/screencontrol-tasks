CREATE TABLE IF NOT EXISTS child_progress (
  child_id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  current_streak_days INTEGER DEFAULT 0,
  best_streak_days INTEGER DEFAULT 0,
  last_completed_day TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(family_id) REFERENCES families(id),
  FOREIGN KEY(child_id) REFERENCES children(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reward_events (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  minutes_delta INTEGER DEFAULT 0,
  xp_delta INTEGER DEFAULT 0,
  level_before INTEGER,
  level_after INTEGER,
  streak_days INTEGER DEFAULT 0,
  task_instance_id TEXT,
  seen_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(family_id) REFERENCES families(id),
  FOREIGN KEY(child_id) REFERENCES children(id) ON DELETE CASCADE,
  FOREIGN KEY(task_instance_id) REFERENCES task_instances(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO child_progress (child_id, family_id, level, xp, current_streak_days, best_streak_days)
SELECT id, family_id, 1, 0, 0, 0 FROM children;
