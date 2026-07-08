-- Migrations Schema for Screen Tasks Database

CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_pin_hash TEXT NOT NULL,
  settings_json TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS children (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  avatar TEXT,
  color TEXT,
  available_minutes INTEGER DEFAULT 0,
  debt_limit_minutes INTEGER DEFAULT 60,
  daily_spend_limit_minutes INTEGER DEFAULT 120,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(family_id) REFERENCES families(id)
);

CREATE TABLE IF NOT EXISTS task_templates (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  default_reward_minutes INTEGER NOT NULL,
  schedule_type TEXT NOT NULL, -- one_time, daily, weekly, custom
  days_of_week TEXT, -- JSON array: [1, 3, 5] (Monday, Wednesday, Friday)
  time_window_start TEXT, -- e.g., '08:00'
  time_window_end TEXT, -- e.g., '20:00'
  requires_photo INTEGER DEFAULT 0, -- 0 or 1
  is_active INTEGER DEFAULT 1, -- 0 or 1
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(family_id) REFERENCES families(id)
);

CREATE TABLE IF NOT EXISTS task_template_children (
  template_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  PRIMARY KEY (template_id, child_id),
  FOREIGN KEY(template_id) REFERENCES task_templates(id) ON DELETE CASCADE,
  FOREIGN KEY(child_id) REFERENCES children(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_instances (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  template_id TEXT,
  child_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  reward_minutes INTEGER NOT NULL,
  requires_photo INTEGER DEFAULT 0,
  status TEXT NOT NULL, -- open, submitted, approved, rejected, expired, cancelled
  due_at TEXT NOT NULL, -- YYYY-MM-DD
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  submitted_at DATETIME,
  reviewed_at DATETIME,
  reviewed_by TEXT, -- parent_id
  FOREIGN KEY(family_id) REFERENCES families(id),
  FOREIGN KEY(template_id) REFERENCES task_templates(id) ON DELETE SET NULL,
  FOREIGN KEY(child_id) REFERENCES children(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_submissions (
  id TEXT PRIMARY KEY,
  task_instance_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  note TEXT,
  photo_object_key TEXT,
  photo_blob TEXT,
  status TEXT NOT NULL, -- pending, approved, rejected
  photo_deleted_at DATETIME,
  submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME,
  FOREIGN KEY(task_instance_id) REFERENCES task_instances(id) ON DELETE CASCADE,
  FOREIGN KEY(child_id) REFERENCES children(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS minute_transactions (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  type TEXT NOT NULL, -- earn, spend, adjustment, refund
  minutes INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason TEXT,
  task_instance_id TEXT,
  screen_usage_log_id TEXT,
  created_by TEXT NOT NULL, -- parent or child
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(family_id) REFERENCES families(id),
  FOREIGN KEY(child_id) REFERENCES children(id) ON DELETE CASCADE,
  FOREIGN KEY(task_instance_id) REFERENCES task_instances(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS screen_time_requests (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  requested_minutes INTEGER NOT NULL,
  approved_minutes INTEGER,
  source TEXT NOT NULL, -- family_link, tv, playstation, computer, tablet, manual_parent, other
  status TEXT NOT NULL, -- pending, approved, rejected, cancelled
  requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME,
  reviewed_by TEXT,
  FOREIGN KEY(family_id) REFERENCES families(id),
  FOREIGN KEY(child_id) REFERENCES children(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS screen_usage_logs (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  screen_time_request_id TEXT,
  source TEXT NOT NULL, -- family_link, tv, playstation, computer, tablet, manual_parent, other
  minutes INTEGER NOT NULL,
  reason TEXT,
  created_by TEXT NOT NULL, -- parent
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(family_id) REFERENCES families(id),
  FOREIGN KEY(child_id) REFERENCES children(id) ON DELETE CASCADE,
  FOREIGN KEY(screen_time_request_id) REFERENCES screen_time_requests(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  actor_type TEXT NOT NULL, -- parent, child, system
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metadata_json TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(family_id) REFERENCES families(id)
);

CREATE TABLE IF NOT EXISTS sync_events (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL, -- create, update, delete
  payload_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(family_id) REFERENCES families(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  recipient_type TEXT NOT NULL, -- parent, child
  recipient_id TEXT NOT NULL,
  type TEXT NOT NULL, -- info, alert, task_submitted, task_reviewed, session_started, session_ended
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  read_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(family_id) REFERENCES families(id)
);

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
  type TEXT NOT NULL, -- task_approved, manual_bonus, level_up, streak
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
