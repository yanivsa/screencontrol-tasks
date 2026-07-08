// Cloudflare Worker API for Screen Time Tasks App (Uri and Eitan)

const DEFAULT_ALLOWED_ORIGINS = [
  "https://screencontrol-tasks.pages.dev",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "capacitor://localhost",
  "ionic://localhost"
];

const textEncoder = new TextEncoder();

// Hashing helper
async function sha256(message) {
  const msgBuffer = textEncoder.encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return hashHex;
}

async function hashPin(pin, env) {
  return sha256(`${env.PIN_PEPPER || "screencontrol-v1"}:${pin}`);
}

async function isPinMatch(pin, storedHash, env) {
  const modernHash = await hashPin(pin, env);
  if (storedHash === modernHash) return true;
  return storedHash === await sha256(pin);
}

// CORS headers helper
function getCorsHeaders(request, env = {}) {
  const origin = request.headers.get("Origin");
  const configuredOrigins = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(originValue => originValue.trim())
    .filter(Boolean);
  const allowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : DEFAULT_ALLOWED_ORIGINS;
  const isLocalDev = origin && (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:"));
  const allowedOrigin = origin && (allowedOrigins.includes(origin) || isLocalDev) ? origin : allowedOrigins[0];

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Role, X-User-Id",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
}

function responseJson(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function responseError(message, status = 400, headers = {}) {
  return responseJson({ error: message }, status, headers);
}

// UUID generator helper
function generateUUID() {
  return crypto.randomUUID();
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function stringToBase64Url(value) {
  return bytesToBase64Url(textEncoder.encode(value));
}

function base64UrlToString(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function signTokenPart(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function generateToken(user, env) {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { ...user, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 };
  const unsigned = `${stringToBase64Url(JSON.stringify(header))}.${stringToBase64Url(JSON.stringify(payload))}`;
  const signature = await signTokenPart(unsigned, env.TOKEN_SECRET || "screencontrol-local-dev-token-secret");
  return `${unsigned}.${signature}`;
}

async function verifyToken(request, env) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.split(" ")[1];
  try {
    if (!token.includes(".")) {
      const payload = JSON.parse(base64UrlToString(token));
      if (payload.exp && payload.exp < Date.now()) return null;
      return payload;
    }

    const [headerPart, payloadPart, signature] = token.split(".");
    if (!headerPart || !payloadPart || !signature) return null;
    const unsigned = `${headerPart}.${payloadPart}`;
    const expectedSignature = await signTokenPart(unsigned, env.TOKEN_SECRET || "screencontrol-local-dev-token-secret");
    if (signature !== expectedSignature) return null;
    const payload = JSON.parse(base64UrlToString(payloadPart));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// Cron daily template instantiation logic helper
async function instantiateDailyTasks(db) {
  const todayStr = new Date().toISOString().split("T")[0];
  
  // Fetch active daily templates
  const { results: templates } = await db.prepare(
    "SELECT * FROM task_templates WHERE schedule_type = 'daily' AND is_active = 1"
  ).all();

  for (const t of templates) {
    const { results: children } = await db.prepare(
      "SELECT child_id FROM task_template_children WHERE template_id = ?"
    ).bind(t.id).all();

    for (const child of children) {
      // Check if already created for today
      const existing = await db.prepare(
        "SELECT id FROM task_instances WHERE template_id = ? AND child_id = ? AND due_at = ?"
      ).bind(t.id, child.child_id, todayStr).first();

      if (!existing) {
        await db.prepare(`
          INSERT INTO task_instances (id, family_id, template_id, child_id, title, description, reward_minutes, requires_photo, status, due_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
        `).bind(
          generateUUID(), t.family_id, t.id, child.child_id, t.title, t.description || "", t.default_reward_minutes, t.requires_photo, todayStr
        ).run();
      }
    }
  }
}

function getXpToNextLevel(level) {
  return 100 + (Math.max(level, 1) - 1) * 50;
}

function getTaskXp(minutes, requiresPhoto = 0) {
  const baseXp = Math.max(10, Math.round(Number(minutes || 0) * 1.25));
  return requiresPhoto ? baseXp + 10 : baseXp;
}

function getDayDiff(previousDay, currentDay) {
  if (!previousDay) return null;
  const previous = new Date(`${previousDay}T00:00:00Z`).getTime();
  const current = new Date(`${currentDay}T00:00:00Z`).getTime();
  return Math.round((current - previous) / (24 * 60 * 60 * 1000));
}

async function ensureGamificationSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS child_progress (
      child_id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      level INTEGER DEFAULT 1,
      xp INTEGER DEFAULT 0,
      current_streak_days INTEGER DEFAULT 0,
      best_streak_days INTEGER DEFAULT 0,
      last_completed_day TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await db.prepare(`
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

async function getOrCreateChildProgress(db, familyId, childId) {
  await db.prepare(`
    INSERT OR IGNORE INTO child_progress (child_id, family_id, level, xp, current_streak_days, best_streak_days)
    VALUES (?, ?, 1, 0, 0, 0)
  `).bind(childId, familyId).run();
  return db.prepare("SELECT * FROM child_progress WHERE child_id = ?").bind(childId).first();
}

async function recordRewardEvent(db, {
  familyId,
  childId,
  type,
  title,
  body,
  minutesDelta = 0,
  xpDelta = 0,
  levelBefore = null,
  levelAfter = null,
  streakDays = 0,
  taskInstanceId = null
}) {
  const id = generateUUID();
  await db.prepare(`
    INSERT INTO reward_events (
      id, family_id, child_id, type, title, body, minutes_delta, xp_delta,
      level_before, level_after, streak_days, task_instance_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, familyId, childId, type, title, body, minutesDelta, xpDelta,
    levelBefore, levelAfter, streakDays, taskInstanceId
  ).run();
  return id;
}

async function awardTaskProgress(db, familyId, instance, minutesDelta) {
  const today = new Date().toISOString().split("T")[0];
  const progress = await getOrCreateChildProgress(db, familyId, instance.child_id);
  const levelBefore = progress.level || 1;
  let levelAfter = levelBefore;
  let xpAfter = (progress.xp || 0) + getTaskXp(minutesDelta, instance.requires_photo);
  while (xpAfter >= getXpToNextLevel(levelAfter)) {
    xpAfter -= getXpToNextLevel(levelAfter);
    levelAfter += 1;
  }

  const dayDiff = getDayDiff(progress.last_completed_day, today);
  let streakDays = progress.current_streak_days || 0;
  if (dayDiff === 0) {
    streakDays = Math.max(streakDays, 1);
  } else if (dayDiff === 1) {
    streakDays += 1;
  } else {
    streakDays = 1;
  }

  const bestStreak = Math.max(progress.best_streak_days || 0, streakDays);
  await db.prepare(`
    UPDATE child_progress
    SET level = ?, xp = ?, current_streak_days = ?, best_streak_days = ?,
        last_completed_day = ?, updated_at = CURRENT_TIMESTAMP
    WHERE child_id = ?
  `).bind(levelAfter, xpAfter, streakDays, bestStreak, today, instance.child_id).run();

  const xpDelta = getTaskXp(minutesDelta, instance.requires_photo);
  const title = levelAfter > levelBefore ? `עלית לרמה ${levelAfter}!` : "משימה אושרה!";
  const body = levelAfter > levelBefore
    ? `קיבלת ${minutesDelta} דקות, ${xpDelta} XP ועלית רמה.`
    : `קיבלת ${minutesDelta} דקות ו-${xpDelta} XP.`;

  await recordRewardEvent(db, {
    familyId,
    childId: instance.child_id,
    type: levelAfter > levelBefore ? "level_up" : "task_approved",
    title,
    body,
    minutesDelta,
    xpDelta,
    levelBefore,
    levelAfter,
    streakDays,
    taskInstanceId: instance.id
  });

  return { xpDelta, levelBefore, levelAfter, streakDays, xp: xpAfter, xpToNextLevel: getXpToNextLevel(levelAfter) };
}

export default {
  // Cron handler for generating daily recurring tasks and 7-day photo cleanup
  async scheduled(event, env, ctx) {
    await ensureSeedData(env);
    
    // 1. Create daily tasks
    await instantiateDailyTasks(env.DB);

    // 2. Cleanup photos older than 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().replace("T", " ").substring(0, 19);
    const { results: oldSubmissions } = await env.DB.prepare(
      "SELECT id, photo_object_key FROM task_submissions WHERE submitted_at < ? AND (photo_object_key IS NOT NULL OR photo_blob IS NOT NULL) AND photo_deleted_at IS NULL"
    ).bind(sevenDaysAgo).all();

    for (const sub of oldSubmissions) {
      if (sub.photo_object_key && env.PHOTOS) {
        try {
          await env.PHOTOS.delete(sub.photo_object_key);
        } catch (e) {
          console.error("Failed to delete photo from R2: " + sub.photo_object_key, e);
        }
      }
      await env.DB.prepare(
        "UPDATE task_submissions SET photo_deleted_at = CURRENT_TIMESTAMP, photo_blob = NULL WHERE id = ?"
      ).bind(sub.id).run();
    }
  },

  async fetch(request, env, ctx) {
    const corsHeaders = getCorsHeaders(request, env);
    
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname;

      await ensureSeedData(env);

      // --- PUBLIC ROUTES ---

      if (path === "/api/init" && request.method === "POST") {
        const initSecret = request.headers.get("X-Init-Secret");
        if (env.ENVIRONMENT === "production" || !env.ALLOW_INIT) {
          return responseError("נתיב אתחול חסום בסביבה זו", 403, corsHeaders);
        }
        if (env.INIT_SECRET && initSecret !== env.INIT_SECRET) {
          return responseError("הרשאת אתחול שגויה", 403, corsHeaders);
        }
        const family = await env.DB.prepare("SELECT id FROM families WHERE id = 'yanivsa'").first();
        if (family) return responseError("Database already initialized", 400, corsHeaders);
        await seedDatabase(env.DB, env);
        return responseJson({ success: true, message: "Database initialized." }, 200, corsHeaders);
      }

      // Public child profiles view for Login page dropdown (id, name, avatar, color only)
      if (path === "/api/children" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT id, name, avatar, color FROM children WHERE family_id = 'yanivsa'"
        ).all();
        return responseJson(results, 200, corsHeaders);
      }

      if (path === "/api/auth/login" && request.method === "POST") {
        const { role, pin, childId } = await request.json();
        
        if (role === "parent") {
          const parent = await env.DB.prepare("SELECT * FROM families WHERE id = 'yanivsa'").first();
          if (!parent || !await isPinMatch(pin, parent.parent_pin_hash, env)) {
            return responseError("PIN הורה שגוי", 401, corsHeaders);
          }
          const user = { id: "parent", name: "הורה", role: "parent", familyId: "yanivsa" };
          return responseJson({ success: true, user, token: await generateToken(user, env) }, 200, corsHeaders);
        } else if (role === "child") {
          if (!childId) return responseError("לא נבחר ילד", 400, corsHeaders);
          const child = await env.DB.prepare("SELECT * FROM children WHERE id = ? AND family_id = 'yanivsa'").bind(childId).first();
          if (!child || !await isPinMatch(pin, child.pin_hash, env)) {
            return responseError("PIN ילד שגוי", 401, corsHeaders);
          }
          const user = { id: child.id, name: child.name, role: "child", familyId: "yanivsa", color: child.color, avatar: child.avatar };
          return responseJson({ success: true, user, token: await generateToken(user, env) }, 200, corsHeaders);
        }
        return responseError("תפקיד לא תקין", 400, corsHeaders);
      }

      // Special route to load submission images (must check URL but we can make it public or secure)
      if (path.startsWith("/api/photos/") && request.method === "GET") {
        const photoKey = path.substring("/api/photos/".length);
        
        // Check if soft deleted in DB
        const submission = await env.DB.prepare(
          "SELECT photo_deleted_at, photo_blob FROM task_submissions WHERE photo_object_key = ?"
        ).bind(photoKey).first();
        
        if (submission && submission.photo_deleted_at) {
          return responseError("התמונה נמחקה לפי מדיניות הפרטיות (לאחר 7 ימים)", 410, corsHeaders);
        }

        // Try R2
        if (env.PHOTOS) {
          try {
            const object = await env.PHOTOS.get(photoKey);
            if (object) {
              const headers = new Headers({ "Content-Type": "image/jpeg", ...corsHeaders });
              return new Response(object.body, { headers });
            }
          } catch (e) {
            console.error("R2 read skipped or failed: ", e);
          }
        }

        // Fallback to D1 blob storage
        if (submission && submission.photo_blob) {
          try {
            const binary = Uint8Array.from(atob(submission.photo_blob), c => c.charCodeAt(0));
            const headers = new Headers({ "Content-Type": "image/jpeg", ...corsHeaders });
            return new Response(binary, { headers });
          } catch (err) {
            return responseError("שגיאה בפענוח התמונה מהמאגר", 500, corsHeaders);
          }
        }
        
        return responseError("התמונה לא נמצאה", 404, corsHeaders);
      }

      // --- AUTHENTICATED ROUTES ---
      
      const user = await verifyToken(request, env);
      if (!user) {
        return responseError("לא מורשה - נדרש token", 401, corsHeaders);
      }

      // Private detailed children list for parent dashboard
      if (path === "/api/children/details" && request.method === "GET") {
        if (user.role !== 'parent') return responseError("גישה חסומה", 403, corsHeaders);
        const { results } = await env.DB.prepare(
          "SELECT id, name, avatar, color, available_minutes, debt_limit_minutes, daily_spend_limit_minutes FROM children WHERE family_id = ?"
        ).bind(user.familyId).all();
        return responseJson(results, 200, corsHeaders);
      }

      if (path.startsWith("/api/children/") && path.endsWith("/wallet") && request.method === "GET") {
        const childId = path.split("/")[3];
        if (user.role === 'child' && user.id !== childId) return responseError("גישה חסומה", 403, corsHeaders);
        
        const child = await env.DB.prepare(
          "SELECT id, name, available_minutes, debt_limit_minutes, daily_spend_limit_minutes FROM children WHERE id = ?"
        ).bind(childId).first();
        if (!child) return responseError("הילד לא נמצא", 404, corsHeaders);
        const progress = await getOrCreateChildProgress(env.DB, user.familyId, childId);

        const todayStr = new Date().toISOString().split("T")[0] + "%";
        const stats = await env.DB.prepare(`
          SELECT 
            SUM(CASE WHEN type = 'earn' THEN minutes ELSE 0 END) as earned_today,
            SUM(CASE WHEN type = 'spend' THEN minutes ELSE 0 END) as spent_today
          FROM minute_transactions 
          WHERE child_id = ? AND created_at LIKE ?
        `).bind(childId, todayStr).first();

        return responseJson({
          child,
          stats: { earned_today: stats?.earned_today || 0, spent_today: stats?.spent_today || 0 },
          progress: {
            level: progress.level || 1,
            xp: progress.xp || 0,
            xp_to_next_level: getXpToNextLevel(progress.level || 1),
            current_streak_days: progress.current_streak_days || 0,
            best_streak_days: progress.best_streak_days || 0
          }
        }, 200, corsHeaders);
      }

      if (path === "/api/tasks" && request.method === "GET") {
        const childId = url.searchParams.get("childId");
        if (user.role === 'child' && childId !== user.id) return responseError("גישה חסומה", 403, corsHeaders);
        
        // Lazy Cron Fallback: Ensure daily tasks exist for today
        await instantiateDailyTasks(env.DB);

        let query = `
          SELECT ti.*, ts.photo_object_key, ts.note as submission_note, ts.photo_deleted_at
          FROM task_instances ti
          LEFT JOIN task_submissions ts ON ti.id = ts.task_instance_id
          WHERE ti.family_id = ?
        `;
        let params = [user.familyId];
        if (childId) { 
          query += " AND ti.child_id = ?"; 
          params.push(childId); 
        }
        query += " ORDER BY ti.due_at DESC, ti.created_at DESC";
        
        const { results } = await env.DB.prepare(query).bind(...params).all();
        return responseJson(results, 200, corsHeaders);
      }

      // Templates
      if (path === "/api/task-templates" && request.method === "POST" && user.role === 'parent') {
        const { title, description, defaultRewardMinutes, scheduleType, daysOfWeek, requiresPhoto, assignedChildIds } = await request.json();
        const templateId = generateUUID();
        
        await env.DB.prepare(`
          INSERT INTO task_templates (id, family_id, title, description, default_reward_minutes, schedule_type, days_of_week, requires_photo, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        `).bind(templateId, user.familyId, title, description || "", defaultRewardMinutes, scheduleType, JSON.stringify(daysOfWeek||[]), requiresPhoto ? 1 : 0).run();
        
        if (assignedChildIds && assignedChildIds.length > 0) {
          for (const childId of assignedChildIds) {
            await env.DB.prepare("INSERT INTO task_template_children (template_id, child_id) VALUES (?, ?)").bind(templateId, childId).run();
            if (scheduleType === 'one_time') {
              const todayStr = new Date().toISOString().split("T")[0];
              await env.DB.prepare(`
                INSERT INTO task_instances (id, family_id, template_id, child_id, title, description, reward_minutes, requires_photo, status, due_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
              `).bind(generateUUID(), user.familyId, templateId, childId, title, description || "", defaultRewardMinutes, requiresPhoto ? 1 : 0, todayStr).run();
            }
          }
        }
        return responseJson({ success: true, templateId }, 201, corsHeaders);
      }

      if (path === "/api/task-templates" && request.method === "GET" && user.role === 'parent') {
        const { results } = await env.DB.prepare("SELECT * FROM task_templates WHERE family_id = ? AND is_active = 1").bind(user.familyId).all();
        const templates = [];
        for (const t of results) {
          const links = await env.DB.prepare("SELECT child_id FROM task_template_children WHERE template_id = ?").bind(t.id).all();
          t.assignedChildIds = links.results.map(l => l.child_id);
          t.days_of_week = JSON.parse(t.days_of_week || "[]");
          templates.push(t);
        }
        return responseJson(templates, 200, corsHeaders);
      }

      if (path.startsWith("/api/task-templates/") && request.method === "DELETE" && user.role === 'parent') {
        const id = path.split("/")[3];
        await env.DB.prepare("UPDATE task_templates SET is_active = 0 WHERE id = ?").bind(id).run();
        return responseJson({ success: true }, 200, corsHeaders);
      }

      if (path === "/api/task-instances" && request.method === "POST" && user.role === 'parent') {
        const { childId, title, description, rewardMinutes, requiresPhoto, dueAt } = await request.json();
        const instanceId = generateUUID();
        const finalDueAt = dueAt || new Date().toISOString().split("T")[0];
        
        await env.DB.prepare(`
          INSERT INTO task_instances (id, family_id, child_id, title, description, reward_minutes, requires_photo, status, due_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)
        `).bind(instanceId, user.familyId, childId, title, description || "", rewardMinutes, requiresPhoto ? 1 : 0, finalDueAt).run();

        await env.DB.prepare(`
          INSERT INTO notifications (id, family_id, recipient_type, recipient_id, type, title, body, entity_type, entity_id)
          VALUES (?, ?, 'child', ?, 'info', 'משימה חדשה!', ?, 'task_instance', ?)
        `).bind(generateUUID(), user.familyId, childId, `ההורה הוסיף משימה: ${title}`, instanceId).run();

        return responseJson({ success: true, instanceId }, 201, corsHeaders);
      }

      // Submit
      if (path.startsWith("/api/task-instances/") && path.endsWith("/submit") && request.method === "POST") {
        const instanceId = path.split("/")[3];
        const { note, photoBase64 } = await request.json();
        const instance = await env.DB.prepare("SELECT * FROM task_instances WHERE id = ?").bind(instanceId).first();
        if (!instance) return responseError("המשימה לא נמצאה", 404, corsHeaders);
        if (instance.status !== "open") return responseError("המשימה אינה פתוחה", 400, corsHeaders);
        if (user.role === 'child' && instance.child_id !== user.id) return responseError("גישה חסומה", 403, corsHeaders);
        
        let photoObjectKey = null;
        let photoBlob = null;
        if (photoBase64) {
          photoObjectKey = `submissions/${instanceId}_${Date.now()}.jpg`;
          photoBlob = photoBase64;
          
          if (env.PHOTOS) {
            try {
              const binary = Uint8Array.from(atob(photoBase64), c => c.charCodeAt(0));
              await env.PHOTOS.put(photoObjectKey, binary, { customMetadata: { taskInstanceId: instanceId }});
            } catch (e) {
              console.error("R2 write skipped, storing only in D1", e);
            }
          }
        } else if (instance.requires_photo) {
          return responseError("משימה זו דורשת הוכחה בצילום", 400, corsHeaders);
        }

        const submissionId = generateUUID();
        await env.DB.prepare(`
          INSERT INTO task_submissions (id, task_instance_id, child_id, note, photo_object_key, photo_blob, status)
          VALUES (?, ?, ?, ?, ?, ?, 'pending')
        `).bind(submissionId, instanceId, instance.child_id, note || "", photoObjectKey, photoBlob).run();
        
        await env.DB.prepare("UPDATE task_instances SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP WHERE id = ?").bind(instanceId).run();

        const childName = await getChildName(env.DB, instance.child_id);
        await env.DB.prepare(`
          INSERT INTO notifications (id, family_id, recipient_type, recipient_id, type, title, body, entity_type, entity_id)
          VALUES (?, ?, 'parent', 'parent', 'task_submitted', 'משימה הוגשה לאישור', ?, 'task_instance', ?)
        `).bind(generateUUID(), user.familyId, `${childName} הגיש/ה משימה: ${instance.title}`, instanceId).run();

        return responseJson({ success: true, submissionId }, 200, corsHeaders);
      }

      if (path.startsWith("/api/task-instances/") && (path.endsWith("/approve") || path.endsWith("/reject")) && request.method === "POST") {
        if (user.role !== 'parent') return responseError("נדרשת הרשאת הורה", 403, corsHeaders);
        const parts = path.split("/");
        const instanceId = parts[3];
        const action = parts[4];
        
        let rewardMinutesOverride, reason;
        try {
          const body = await request.json();
          rewardMinutesOverride = body.rewardMinutesOverride;
          reason = body.reason;
        } catch (e) {}
        
        const instance = await env.DB.prepare("SELECT * FROM task_instances WHERE id = ?").bind(instanceId).first();
        if (!instance) return responseError("המשימה לא נמצאה", 404, corsHeaders);
        if (instance.status !== "submitted") return responseError("המשימה לא ממתינה לאישור", 400, corsHeaders);
        
        const finalReward = rewardMinutesOverride !== undefined ? rewardMinutesOverride : instance.reward_minutes;
        
        if (action === "approve") {
          // Atomic Balance Update
          await env.DB.prepare("UPDATE children SET available_minutes = available_minutes + ? WHERE id = ?").bind(finalReward, instance.child_id).run();
          const child = await env.DB.prepare("SELECT available_minutes FROM children WHERE id = ?").bind(instance.child_id).first();
          const newBalance = child.available_minutes;

          await env.DB.prepare("UPDATE task_instances SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = 'parent', reward_minutes = ? WHERE id = ?").bind(finalReward, instanceId).run();
          
          await env.DB.prepare(`
            INSERT INTO minute_transactions (id, family_id, child_id, type, minutes, balance_after, reason, task_instance_id, created_by)
            VALUES (?, ?, ?, 'earn', ?, ?, ?, ?, 'parent')
          `).bind(generateUUID(), user.familyId, instance.child_id, finalReward, newBalance, `ביצוע משימה: ${instance.title}`, instanceId).run();

          await env.DB.prepare("UPDATE task_submissions SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP WHERE task_instance_id = ?").bind(instanceId).run();

          await env.DB.prepare(`
            INSERT INTO notifications (id, family_id, recipient_type, recipient_id, type, title, body, entity_type, entity_id)
            VALUES (?, ?, 'child', ?, 'task_reviewed', 'המשימה אושרה! 🎉', ?, 'task_instance', ?)
          `).bind(generateUUID(), user.familyId, instance.child_id, `ההורה אישר את המשימה וקיבלת ${finalReward} דקות מסך!`, instanceId).run();
          await awardTaskProgress(env.DB, user.familyId, instance, finalReward);

        } else {
          await env.DB.prepare("UPDATE task_instances SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = 'parent' WHERE id = ?").bind(instanceId).run();
          await env.DB.prepare("UPDATE task_submissions SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP WHERE task_instance_id = ?").bind(instanceId).run();
          
          await env.DB.prepare(`
            INSERT INTO notifications (id, family_id, recipient_type, recipient_id, type, title, body, entity_type, entity_id)
            VALUES (?, ?, 'child', ?, 'task_reviewed', 'המשימה לא אושרה 🥺', ?, 'task_instance', ?)
          `).bind(generateUUID(), user.familyId, instance.child_id, `ההורה החזיר את המשימה. ${reason ? "הערה: " + reason : ""}`, instanceId).run();
        }
        return responseJson({ success: true }, 200, corsHeaders);
      }

      // Review Proposed Task (Parent)
      if (path.startsWith("/api/task-instances/") && path.endsWith("/review-proposed") && request.method === "POST") {
        if (user.role !== 'parent') return responseError("נדרשת הרשאת הורה", 403, corsHeaders);
        const instanceId = path.split("/")[3];
        let action, rewardMinutesOverride;
        try {
          const body = await request.json();
          action = body.action;
          rewardMinutesOverride = body.rewardMinutesOverride;
        } catch (e) {}
        
        const instance = await env.DB.prepare("SELECT * FROM task_instances WHERE id = ?").bind(instanceId).first();
        if (!instance) return responseError("המשימה לא נמצאה", 404, corsHeaders);
        if (instance.status !== "proposed") return responseError("המשימה אינה הצעת משימה", 400, corsHeaders);
        
        if (action === "approve") {
          const finalReward = rewardMinutesOverride !== undefined ? rewardMinutesOverride : instance.reward_minutes;
          await env.DB.prepare("UPDATE task_instances SET status = 'open', reward_minutes = ? WHERE id = ?").bind(finalReward, instanceId).run();
          
          await env.DB.prepare(`
            INSERT INTO notifications (id, family_id, recipient_type, recipient_id, type, title, body, entity_type, entity_id)
            VALUES (?, ?, 'child', ?, 'info', 'הצעת המשימה שלך אושרה! 👍', ?, 'task_instance', ?)
          `).bind(generateUUID(), user.familyId, instance.child_id, `ההורה אישר את משימת "${instance.title}". עכשיו אתה יכול לבצע אותה!`, instanceId).run();
        } else {
          await env.DB.prepare("UPDATE task_instances SET status = 'cancelled' WHERE id = ?").bind(instanceId).run();
          await env.DB.prepare(`
            INSERT INTO notifications (id, family_id, recipient_type, recipient_id, type, title, body)
            VALUES (?, ?, 'child', ?, 'info', 'הצעת המשימה נדחתה', ?)
          `).bind(generateUUID(), user.familyId, instance.child_id, `ההורה דחה את הצעת משימת "${instance.title}".`).run();
        }
        return responseJson({ success: true }, 200, corsHeaders);
      }

      // Manual Adjustment (Debt logic updated)
      if (path === "/api/manual-adjustment" && request.method === "POST" && user.role === 'parent') {
        const { childId, minutes, type, reason } = await request.json(); 
        const childExists = await env.DB.prepare("SELECT id FROM children WHERE id = ?").bind(childId).first();
        if (!childExists) return responseError("הילד לא נמצא", 404, corsHeaders);
        
        let adjMinutes = parseInt(minutes);
        if (type === "spend") adjMinutes = -Math.abs(adjMinutes);
        else adjMinutes = Math.abs(adjMinutes);

        // Atomic Balance Update
        await env.DB.prepare("UPDATE children SET available_minutes = available_minutes + ? WHERE id = ?").bind(adjMinutes, childId).run();
        const child = await env.DB.prepare("SELECT available_minutes FROM children WHERE id = ?").bind(childId).first();
        const newBalance = child.available_minutes;

        const txId = generateUUID();
        await env.DB.prepare(`
          INSERT INTO minute_transactions (id, family_id, child_id, type, minutes, balance_after, reason, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'parent')
        `).bind(txId, user.familyId, childId, type === "spend" ? "spend" : "earn", Math.abs(adjMinutes), newBalance, reason || "עדכון ידני").run();

        const title = type === "earn" ? "הדקות שלך עודכנו! 🎁" : "הפחתת דקות מסך ⚠️";
        const body = type === "earn" 
          ? `ההורה הוסיף לך ${Math.abs(adjMinutes)} דקות מסך! סיבה: ${reason || "צ'ופר"}`
          : `ההורה הפחית לך ${Math.abs(adjMinutes)} דקות מסך. סיבה: ${reason || "שימוש יתר/קנס"}`;

        await env.DB.prepare(`
          INSERT INTO notifications (id, family_id, recipient_type, recipient_id, type, title, body)
          VALUES (?, ?, 'child', ?, 'info', ?, ?)
        `).bind(generateUUID(), user.familyId, childId, title, body).run();
        if (type !== "spend") {
          await recordRewardEvent(env.DB, {
            familyId: user.familyId,
            childId,
            type: "manual_bonus",
            title: "בונוס חדש!",
            body: `ההורה הוסיף לך ${Math.abs(adjMinutes)} דקות.`,
            minutesDelta: Math.abs(adjMinutes),
            xpDelta: 0
          });
        }

        return responseJson({ success: true, newBalance }, 200, corsHeaders);
      }

      // --- SCREEN TIME REQUESTS ---

      // Create Request
      if (path === "/api/screen-time-requests" && request.method === "POST") {
        if (user.role !== 'child') return responseError("רק ילד יכול לבקש", 403, corsHeaders);
        const { requestedMinutes, source } = await request.json();
        
        const child = await env.DB.prepare("SELECT available_minutes FROM children WHERE id = ?").bind(user.id).first();
        if (child.available_minutes < requestedMinutes) {
          return responseError(`אין לך מספיק דקות בארנק לניצול זה (יתרה: ${child.available_minutes}).`, 400, corsHeaders);
        }

        const reqId = generateUUID();
        await env.DB.prepare(`
          INSERT INTO screen_time_requests (id, family_id, child_id, requested_minutes, source, status)
          VALUES (?, ?, ?, ?, ?, 'pending')
        `).bind(reqId, user.familyId, user.id, requestedMinutes, source || 'כללי').run();

        await env.DB.prepare(`
          INSERT INTO notifications (id, family_id, recipient_type, recipient_id, type, title, body, entity_type, entity_id)
          VALUES (?, ?, 'parent', 'parent', 'info', 'בקשת זמן מסך', ?, 'screen_time_request', ?)
        `).bind(generateUUID(), user.familyId, `${user.name} מבקש/ת ${requestedMinutes} דקות עבור ${source || 'מסך'}.`, reqId).run();

        return responseJson({ success: true, reqId }, 201, corsHeaders);
      }

      // Propose Task (Child)
      if (path === "/api/tasks/propose" && request.method === "POST") {
        if (user.role !== 'child') return responseError("רק ילד יכול להציע משימה", 403, corsHeaders);
        const { title, description, rewardMinutes } = await request.json();
        if (!title) return responseError("כותרת חובה", 400, corsHeaders);
        
        const instanceId = generateUUID();
        const todayStr = new Date().toISOString().split("T")[0];
        
        await env.DB.prepare(`
          INSERT INTO task_instances (id, family_id, child_id, title, description, reward_minutes, requires_photo, status, due_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, 'proposed', ?)
        `).bind(instanceId, user.familyId, user.id, title, description || "", rewardMinutes || 15, todayStr).run();

        await env.DB.prepare(`
          INSERT INTO notifications (id, family_id, recipient_type, recipient_id, type, title, body, entity_type, entity_id)
          VALUES (?, ?, 'parent', 'parent', 'info', 'הצעת משימה חדשה', ?, 'task_instance', ?)
        `).bind(generateUUID(), user.familyId, `${user.name} מציע/ה לבצע משימה: ${title} (${rewardMinutes || 15} דק׳)`, instanceId).run();

        return responseJson({ success: true, instanceId }, 201, corsHeaders);
      }

      // Get Requests
      if (path === "/api/screen-time-requests" && request.method === "GET") {
        const childId = url.searchParams.get("childId");
        let query = "SELECT * FROM screen_time_requests WHERE family_id = ? ";
        let params = [user.familyId];
        if (childId) { query += "AND child_id = ? "; params.push(childId); }
        query += "ORDER BY requested_at DESC LIMIT 50";
        
        const { results } = await env.DB.prepare(query).bind(...params).all();
        return responseJson(results, 200, corsHeaders);
      }

      // Approve Request
      if (path.startsWith("/api/screen-time-requests/") && path.endsWith("/approve") && request.method === "POST") {
        if (user.role !== 'parent') return responseError("נדרשת הרשאת הורה", 403, corsHeaders);
        const reqId = path.split("/")[3];
        
        let approvedMinutes;
        try {
          const body = await request.json();
          approvedMinutes = body.approvedMinutes;
        } catch (e) {}
        
        const sr = await env.DB.prepare("SELECT * FROM screen_time_requests WHERE id = ?").bind(reqId).first();
        if (!sr) return responseError("בקשה לא נמצאה", 404, corsHeaders);
        if (sr.status !== "pending") return responseError("בקשה לא ממתינה לאישור", 400, corsHeaders);
        
        const finalMinutes = approvedMinutes !== undefined ? approvedMinutes : sr.requested_minutes;
        
        // Atomic Deduct Minutes
        await env.DB.prepare("UPDATE children SET available_minutes = available_minutes - ? WHERE id = ?").bind(finalMinutes, sr.child_id).run();
        const child = await env.DB.prepare("SELECT available_minutes FROM children WHERE id = ?").bind(sr.child_id).first();
        const newBalance = child.available_minutes;

        // Update Request Status
        await env.DB.prepare(`
          UPDATE screen_time_requests SET status = 'approved', approved_minutes = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = 'parent' WHERE id = ?
        `).bind(finalMinutes, reqId).run();

        // Create Usage Log
        const logId = generateUUID();
        await env.DB.prepare(`
          INSERT INTO screen_usage_logs (id, family_id, child_id, screen_time_request_id, source, minutes, created_by)
          VALUES (?, ?, ?, ?, ?, ?, 'parent')
        `).bind(logId, user.familyId, sr.child_id, reqId, sr.source, finalMinutes).run();

        // Create Transaction
        await env.DB.prepare(`
          INSERT INTO minute_transactions (id, family_id, child_id, type, minutes, balance_after, reason, screen_usage_log_id, created_by)
          VALUES (?, ?, ?, 'spend', ?, ?, ?, ?, 'parent')
        `).bind(generateUUID(), user.familyId, sr.child_id, finalMinutes, newBalance, `זמן מסך: ${sr.source}`, logId).run();

        // Notify
        await env.DB.prepare(`
          INSERT INTO notifications (id, family_id, recipient_type, recipient_id, type, title, body, entity_type, entity_id)
          VALUES (?, ?, 'child', ?, 'info', 'זמן מסך אושר! 🎮', ?, 'screen_time_request', ?)
        `).bind(generateUUID(), user.familyId, sr.child_id, `בקשתך ל-${sr.source} אושרה. הופחתו ${finalMinutes} דקות מהארנק.`, reqId).run();

        return responseJson({ success: true, newBalance }, 200, corsHeaders);
      }

      // Reject Request
      if (path.startsWith("/api/screen-time-requests/") && path.endsWith("/reject") && request.method === "POST") {
        if (user.role !== 'parent') return responseError("נדרשת הרשאת הורה", 403, corsHeaders);
        const reqId = path.split("/")[3];
        
        const sr = await env.DB.prepare("SELECT * FROM screen_time_requests WHERE id = ?").bind(reqId).first();
        if (!sr) return responseError("בקשה לא נמצאה", 404, corsHeaders);
        if (sr.status !== "pending") return responseError("בקשה לא ממתינה לאישור", 400, corsHeaders);
        
        await env.DB.prepare("UPDATE screen_time_requests SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = 'parent' WHERE id = ?").bind(reqId).run();
        
        await env.DB.prepare(`
          INSERT INTO notifications (id, family_id, recipient_type, recipient_id, type, title, body, entity_type, entity_id)
          VALUES (?, ?, 'child', ?, 'info', 'בקשת מסך נדחתה', ?, 'screen_time_request', ?)
        `).bind(generateUUID(), user.familyId, sr.child_id, `בקשתך לזמן ${sr.source} נדחתה על ידי ההורה.`, reqId).run();

        return responseJson({ success: true }, 200, corsHeaders);
      }

      // Manual Log Usage (Parent)
      if (path === "/api/screen-usage/manual-log" && request.method === "POST") {
        if (user.role !== 'parent') return responseError("נדרשת הרשאת הורה", 403, corsHeaders);
        const { childId, minutes, source, reason } = await request.json();
        
        const childExists = await env.DB.prepare("SELECT id FROM children WHERE id = ?").bind(childId).first();
        if (!childExists) return responseError("ילד לא נמצא", 404, corsHeaders);
        
        // Atomic Deduct Minutes
        await env.DB.prepare("UPDATE children SET available_minutes = available_minutes - ? WHERE id = ?").bind(minutes, childId).run();
        const child = await env.DB.prepare("SELECT available_minutes FROM children WHERE id = ?").bind(childId).first();
        const newBalance = child.available_minutes;

        const logId = generateUUID();
        await env.DB.prepare(`
          INSERT INTO screen_usage_logs (id, family_id, child_id, source, minutes, reason, created_by)
          VALUES (?, ?, ?, ?, ?, ?, 'parent')
        `).bind(logId, user.familyId, childId, source, minutes, reason || "").run();

        await env.DB.prepare(`
          INSERT INTO minute_transactions (id, family_id, child_id, type, minutes, balance_after, reason, screen_usage_log_id, created_by)
          VALUES (?, ?, ?, 'spend', ?, ?, ?, ?, 'parent')
        `).bind(generateUUID(), user.familyId, childId, minutes, newBalance, `רישום זמן מסך ידני: ${source}`, logId).run();

        await env.DB.prepare(`
          INSERT INTO notifications (id, family_id, recipient_type, recipient_id, type, title, body)
          VALUES (?, ?, 'child', ?, 'info', 'זמן מסך נרשם ידנית', ?)
        `).bind(generateUUID(), user.familyId, childId, `ההורה רשם שימוש ב-${source} והפחית ${minutes} דקות מהארנק.`).run();

        return responseJson({ success: true, newBalance }, 200, corsHeaders);
      }

      // Dashboard Stats (Parent)
      if (path === "/api/dashboard/stats" && request.method === "GET") {
        if (user.role !== 'parent') return responseError("גישה חסומה", 403, corsHeaders);
        
        const nowMs = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;
        const sevenDaysAgo = new Date(nowMs - 7 * oneDayMs).toISOString().replace("T", " ").substring(0, 19);
        const fourteenDaysAgo = new Date(nowMs - 14 * oneDayMs).toISOString().replace("T", " ").substring(0, 19);
        
        const { results: children } = await env.DB.prepare("SELECT id, name FROM children WHERE family_id = ?").bind(user.familyId).all();
        
        const stats = {};
        for (const child of children) {
          const txsCurrent = await env.DB.prepare(`
            SELECT 
              SUM(CASE WHEN type = 'earn' THEN minutes ELSE 0 END) as earned,
              SUM(CASE WHEN type = 'spend' THEN minutes ELSE 0 END) as spent
            FROM minute_transactions 
            WHERE child_id = ? AND created_at >= ?
          `).bind(child.id, sevenDaysAgo).first();

          const tasksCurrent = await env.DB.prepare(`
            SELECT COUNT(*) as completed_count
            FROM task_instances
            WHERE child_id = ? AND status = 'approved' AND reviewed_at >= ?
          `).bind(child.id, sevenDaysAgo).first();

          const txsPrev = await env.DB.prepare(`
            SELECT 
              SUM(CASE WHEN type = 'earn' THEN minutes ELSE 0 END) as earned,
              SUM(CASE WHEN type = 'spend' THEN minutes ELSE 0 END) as spent
            FROM minute_transactions 
            WHERE child_id = ? AND created_at >= ? AND created_at < ?
          `).bind(child.id, fourteenDaysAgo, sevenDaysAgo).first();

          const tasksPrev = await env.DB.prepare(`
            SELECT COUNT(*) as completed_count
            FROM task_instances
            WHERE child_id = ? AND status = 'approved' AND reviewed_at >= ? AND reviewed_at < ?
          `).bind(child.id, fourteenDaysAgo, sevenDaysAgo).first();

          stats[child.id] = {
            name: child.name,
            current: {
              earned: txsCurrent?.earned || 0,
              spent: txsCurrent?.spent || 0,
              completed: tasksCurrent?.completed_count || 0
            },
            previous: {
              earned: txsPrev?.earned || 0,
              spent: txsPrev?.spent || 0,
              completed: tasksPrev?.completed_count || 0
            }
          };
        }
        
        return responseJson(stats, 200, corsHeaders);
      }

      // Utils
      if (path === "/api/transactions" && request.method === "GET") {
        const childId = url.searchParams.get("childId");
        if (!childId) return responseError("לא נבחר ילד", 400, corsHeaders);
        const { results } = await env.DB.prepare("SELECT * FROM minute_transactions WHERE child_id = ? ORDER BY created_at DESC LIMIT 50").bind(childId).all();
        return responseJson(results, 200, corsHeaders);
      }

      if (path === "/api/reward-events" && request.method === "GET") {
        const childId = url.searchParams.get("childId") || user.id;
        if (user.role === "child" && childId !== user.id) return responseError("גישה חסומה", 403, corsHeaders);
        if (user.role === "parent" && !childId) return responseError("לא נבחר ילד", 400, corsHeaders);
        const onlyUnseen = url.searchParams.get("unseen") === "1";
        let query = "SELECT * FROM reward_events WHERE family_id = ? AND child_id = ? ";
        const params = [user.familyId, childId];
        if (onlyUnseen) query += "AND seen_at IS NULL ";
        query += "ORDER BY created_at ASC LIMIT 20";
        const { results } = await env.DB.prepare(query).bind(...params).all();
        return responseJson(results, 200, corsHeaders);
      }

      if (path === "/api/reward-events/read" && request.method === "POST") {
        const { rewardEventIds } = await request.json();
        if (rewardEventIds && rewardEventIds.length > 0) {
          const placeholders = rewardEventIds.map(() => "?").join(",");
          await env.DB.prepare(`UPDATE reward_events SET seen_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).bind(...rewardEventIds).run();
        }
        return responseJson({ success: true }, 200, corsHeaders);
      }

      if (path === "/api/notifications" && request.method === "GET") {
        const recipientType = url.searchParams.get("recipientType"); 
        const recipientId = url.searchParams.get("recipientId");
        let query = "SELECT * FROM notifications WHERE family_id = ? ";
        let params = [user.familyId];
        if (recipientType) { query += "AND recipient_type = ? "; params.push(recipientType); }
        if (recipientId && recipientType === "child") { query += "AND recipient_id = ? "; params.push(recipientId); }
        query += "ORDER BY created_at DESC LIMIT 20";
        const { results } = await env.DB.prepare(query).bind(...params).all();
        return responseJson(results, 200, corsHeaders);
      }

      if (path === "/api/notifications/read" && request.method === "POST") {
        const { notificationIds } = await request.json();
        if (notificationIds && notificationIds.length > 0) {
          const placeholders = notificationIds.map(() => "?").join(",");
          await env.DB.prepare(`UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).bind(...notificationIds).run();
        }
        return responseJson({ success: true }, 200, corsHeaders);
      }

      return responseError("נתיב לא נמצא", 404, corsHeaders);
    } catch (err) {
      return responseError("שגיאת שרת פנימית: " + err.message, 500, corsHeaders);
    }
  }
};

async function getChildName(db, childId) {
  const child = await db.prepare("SELECT name FROM children WHERE id = ?").bind(childId).first();
  return child ? child.name : "ילד";
}

async function ensureSeedData(env) {
  const db = env.DB;
  const tableCheck = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='families'").first();
  if (!tableCheck) return; 
  await ensureGamificationSchema(db);
  const family = await db.prepare("SELECT id FROM families WHERE id = 'yanivsa'").first();
  if (!family) await seedDatabase(db, env);
}

async function seedDatabase(db, env = {}) {
  // Pre-hashed values for seed data
  const parentPinHash = await hashPin("2602", env);
  const uriPinHash = await hashPin("2611", env);
  const eitanPinHash = await hashPin("0603", env);

  await db.prepare(`INSERT OR REPLACE INTO families (id, name, parent_pin_hash, settings_json) VALUES ('yanivsa', 'משפחת יניב', ?, '{}')`).bind(parentPinHash).run();
  await db.prepare(`INSERT OR REPLACE INTO children (id, family_id, name, pin_hash, avatar, color, available_minutes) VALUES ('uri', 'yanivsa', 'אורי', ?, 'avatar_boy_1', '#3B82F6', 45)`).bind(uriPinHash).run();
  await db.prepare(`INSERT OR REPLACE INTO children (id, family_id, name, pin_hash, avatar, color, available_minutes) VALUES ('eitan', 'yanivsa', 'איתן', ?, 'avatar_boy_2', '#10B981', 60)`).bind(eitanPinHash).run();
  await getOrCreateChildProgress(db, "yanivsa", "uri");
  await getOrCreateChildProgress(db, "yanivsa", "eitan");

  const templates = [
    { id: "tpl_brush_teeth", title: "צחצוח שיניים בוקר וערב", desc: "לצחצח שיניים היטב במשך 2 דקות בבוקר ובערב", minutes: 10, schedule: "daily", photo: 0 },
    { id: "tpl_clean_room", title: "סידור החדר", desc: "לסדר את הצעצועים, להרים בגדים לרצפה ולסדר את המיטה", minutes: 20, schedule: "daily", photo: 1 },
    { id: "tpl_read_book", title: "קריאת ספר במשך 20 דקות", desc: "לקרוא ספר בשקט ללא מסכים", minutes: 15, schedule: "daily", photo: 0 },
    { id: "tpl_throw_trash", title: "פינוי הפח ושטיפת כלים קלה", desc: "לפנות את שקית הזבל לפח השכונתי ולהכניס כלים למדיח", minutes: 15, schedule: "custom", photo: 0 }
  ];

  for (const t of templates) {
    await db.prepare(`INSERT OR REPLACE INTO task_templates (id, family_id, title, description, default_reward_minutes, schedule_type, requires_photo) VALUES (?, 'yanivsa', ?, ?, ?, ?, ?)`).bind(t.id, t.title, t.desc, t.minutes, t.schedule, t.photo).run();
    await db.prepare("INSERT OR IGNORE INTO task_template_children (template_id, child_id) VALUES (?, 'uri')").bind(t.id).run();
    await db.prepare("INSERT OR IGNORE INTO task_template_children (template_id, child_id) VALUES (?, 'eitan')").bind(t.id).run();
  }

  const todayStr = new Date().toISOString().split("T")[0];
  await db.prepare(`INSERT OR REPLACE INTO task_instances (id, family_id, template_id, child_id, title, description, reward_minutes, requires_photo, status, due_at) VALUES ('inst_uri_brush', 'yanivsa', 'tpl_brush_teeth', 'uri', 'צחצוח שיניים בוקר וערב', 'לצחצח שיניים היטב במשך 2 דקות בבוקר ובערב', 10, 0, 'open', ?)`).bind(todayStr).run();
  await db.prepare(`INSERT OR REPLACE INTO task_instances (id, family_id, template_id, child_id, title, description, reward_minutes, requires_photo, status, due_at) VALUES ('inst_uri_clean', 'yanivsa', 'tpl_clean_room', 'uri', 'סידור החדר', 'לסדר את הצעצועים, להרים בגדים לרצפה ולסדר את המיטה', 20, 1, 'open', ?)`).bind(todayStr).run();
  await db.prepare(`INSERT OR REPLACE INTO task_instances (id, family_id, template_id, child_id, title, description, reward_minutes, requires_photo, status, due_at) VALUES ('inst_eitan_brush', 'yanivsa', 'tpl_brush_teeth', 'eitan', 'צחצוח שיניים בוקר וערב', 'לצחצח שיניים היטב במשך 2 דקות בבוקר ובערב', 10, 0, 'open', ?)`).bind(todayStr).run();
  await db.prepare(`INSERT OR REPLACE INTO task_instances (id, family_id, template_id, child_id, title, description, reward_minutes, requires_photo, status, due_at) VALUES ('inst_eitan_read', 'yanivsa', 'tpl_read_book', 'eitan', 'קריאת ספר במשך 20 דקות', 'לקרוא ספר בשקט ללא מסכים', 15, 0, 'open', ?)`).bind(todayStr).run();
}
