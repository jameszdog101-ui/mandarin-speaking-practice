const MAX_AUDIO = 15 * 1024 * 1024;
const AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
]);
const TRANSFORM_VERSION = "2.0.1";
const TRANSFORM_PROFILES = new Set(["PROFILE_A_M", "PROFILE_A_F"]);

export function validMaxAttempts(value) {
  return (
    Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 10
  );
}
export function publicAssignment(a, sentences) {
  const identityMode = a.identity_mode || (a.anonymous ? "anonymous" : "full");
  return {
    id: a.id,
    code: a.code,
    title: a.title,
    instructions: a.instructions,
    anonymous: identityMode === "anonymous",
    identityMode,
    language: a.language || "zh-TW",
    startsAt: a.starts_at || null,
    endsAt: a.ends_at || null,
    deidentifyVoice: Boolean(a.deidentify_voice),
    transformVersion: a.transform_version || null,
    sentences: sentences.map((s) => ({
      id: s.id,
      text: s.text,
      pinyin: s.pinyin,
      maxAttempts: s.max_attempts ?? s.maxAttempts ?? a.max_attempts,
    })),
  };
}
function response(body, status = 200, headers = {}) {
  return new Response(
    body instanceof ArrayBuffer || body instanceof ReadableStream
      ? body
      : JSON.stringify(body),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        ...headers,
      },
    },
  );
}
function fail(message, status = 400) {
  return response({ error: message }, status);
}
function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}
function token(bytes = 24) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
async function hash(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return [...new Uint8Array(bits)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
function cookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
async function teacher(req, env) {
  const raw = cookie(req, "teacher_session");
  if (!raw) return null;
  const now = new Date().toISOString(),
    t = await env.DB.prepare(
      `SELECT t.id,t.email,t.display_name,t.role,t.active_from,t.active_until,t.disabled_at FROM teacher_sessions s JOIN teachers t ON t.id=s.teacher_id WHERE s.token_hash=? AND s.expires_at>?`,
    )
      .bind(await hash(raw), now)
      .first();
  if (!t) return null;
  if (
    t.role !== "super_admin" &&
    (t.disabled_at ||
      (t.active_from && t.active_from > now) ||
      (t.active_until && t.active_until <= now))
  )
    return null;
  return t;
}
function teacherJson(t) {
  return {
    id: t.id,
    email: t.email,
    displayName: t.display_name,
    role: t.role,
    activeFrom: t.active_from || null,
    activeUntil: t.active_until || null,
  };
}
function isSuper(t) {
  return t?.role === "super_admin";
}
function canEdit(t, a) {
  return Boolean(t && (isSuper(t) || a.teacher_id === t.id));
}
function authCookie(value, maxAge = 604800, secure = true) {
  return `teacher_session=${encodeURIComponent(value)}; Path=/; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax; Max-Age=${maxAge}`;
}
async function bodyJson(req) {
  try {
    return await req.json();
  } catch {
    throw Object.assign(new Error("JSON 格式錯誤"), { status: 400 });
  }
}
async function assignmentByCode(env, code) {
  return env.DB.prepare(
    "SELECT * FROM assignments WHERE code = ? AND deleted_at IS NULL",
  )
    .bind(String(code || "").toUpperCase())
    .first();
}
async function sentences(env, assignmentId) {
  return (
    await env.DB.prepare(
      "SELECT id,text,pinyin,position,max_attempts FROM sentences WHERE assignment_id=? ORDER BY position",
    )
      .bind(assignmentId)
      .all()
  ).results;
}
async function authorizeSession(req, env, sessionId) {
  const raw = req.headers.get("x-session-token");
  if (!raw) return null;
  return env.DB.prepare("SELECT * FROM sessions WHERE id=? AND token_hash=?")
    .bind(sessionId, await hash(raw))
    .first();
}
async function authorizeAdmin(req, assignment) {
  const raw = req.headers.get("x-admin-key");
  return Boolean(raw && (await hash(raw)) === assignment.admin_key_hash);
}
function code() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
    bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => chars[b % chars.length]).join("");
}
function ext(type) {
  return type === "audio/ogg"
    ? "ogg"
    : type === "audio/mp4"
      ? "m4a"
      : type === "audio/mpeg"
        ? "mp3"
        : type === "audio/wav"
          ? "wav"
          : "webm";
}
function assignmentStatus(a, now = new Date().toISOString()) {
  if (a.starts_at && a.starts_at > now) return "upcoming";
  if (a.ends_at && a.ends_at <= now) return "ended";
  return "ongoing";
}
function isoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime()))
    throw Object.assign(new Error("日期格式錯誤"), { status: 400 });
  return d.toISOString();
}
async function deleteAttemptObjects(env, where, bindings = []) {
  const rows = (
    await env.DB.prepare(`SELECT r2_key FROM attempts WHERE ${where}`)
      .bind(...bindings)
      .all()
  ).results;
  for (const row of rows) await env.AUDIO.delete(row.r2_key);
  return rows.length;
}
async function purgeAssignments(env, ids) {
  let audio = 0;
  for (const assignmentId of ids) {
    audio += await deleteAttemptObjects(
      env,
      "session_id IN (SELECT id FROM sessions WHERE assignment_id=?)",
      [assignmentId],
    );
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM attempts WHERE session_id IN (SELECT id FROM sessions WHERE assignment_id=?)",
      ).bind(assignmentId),
      env.DB.prepare(
        "DELETE FROM answers WHERE session_id IN (SELECT id FROM sessions WHERE assignment_id=?)",
      ).bind(assignmentId),
      env.DB.prepare("DELETE FROM sessions WHERE assignment_id=?").bind(
        assignmentId,
      ),
      env.DB.prepare("DELETE FROM sentences WHERE assignment_id=?").bind(
        assignmentId,
      ),
      env.DB.prepare("DELETE FROM assignments WHERE id=?").bind(assignmentId),
    ]);
  }
  return audio;
}
async function purgeExpired(env) {
  const now = new Date().toISOString(),
    audioRows = (
      await env.DB.prepare(
        "SELECT id,r2_key FROM attempts WHERE deleted_at IS NOT NULL AND purge_after<=?",
      )
        .bind(now)
        .all()
    ).results;
  for (const row of audioRows) await env.AUDIO.delete(row.r2_key);
  if (audioRows.length)
    await env.DB.prepare(
      "DELETE FROM attempts WHERE deleted_at IS NOT NULL AND purge_after<=?",
    )
      .bind(now)
      .run();
  const assignments = (
    await env.DB.prepare(
      "SELECT id FROM assignments WHERE deleted_at IS NOT NULL AND purge_after<=?",
    )
      .bind(now)
      .all()
  ).results;
  await purgeAssignments(
    env,
    assignments.map((x) => x.id),
  );
  return { assignments: assignments.length, audio: audioRows.length };
}

async function api(req, env, url) {
  if (req.method === "GET" && url.pathname === "/api/health")
    return response({
      ok: true,
      environment: env.APP_ENV || "unknown",
      database: "D1",
      audio: "R2",
    });
  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    const b = await bodyJson(req),
      email = String(b.email || "")
        .trim()
        .toLowerCase(),
      name = String(b.displayName || "").trim(),
      password = String(b.password || ""),
      now = new Date().toISOString();
    if (!/^\S+@\S+\.\S+$/.test(email)) return fail("請輸入有效 Email");
    if (!name) return fail("請輸入教師姓名");
    if (password.length < 8) return fail("密碼至少需要 8 個字元");
    const invite = await env.DB.prepare(
      "SELECT * FROM teacher_invites WHERE lower(email)=? AND used_at IS NULL",
    )
      .bind(email)
      .first();
    if (!invite) return fail("此 Email 尚未獲平台管理員邀請", 403);
    if (
      (invite.active_from && invite.active_from > now) ||
      (invite.active_until && invite.active_until <= now)
    )
      return fail("此邀請目前不在啟用期間", 403);
    const salt = token(16),
      teacherId = id("t"),
      sessionToken = token(),
      expires = new Date(Date.now() + 604800000).toISOString(),
      digest = await passwordHash(password, salt);
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO teachers(id,email,display_name,password_hash,password_salt,created_at,role,active_from,active_until) VALUES(?,?,?,?,?,?,?,?,?)",
        ).bind(
          teacherId,
          email,
          name,
          digest,
          salt,
          now,
          "teacher",
          invite.active_from,
          invite.active_until,
        ),
        env.DB.prepare(
          "UPDATE teacher_invites SET used_at=? WHERE id=? AND used_at IS NULL",
        ).bind(now, invite.id),
      ]);
    } catch (e) {
      if (String(e).includes("UNIQUE")) return fail("此 Email 已註冊", 409);
      throw e;
    }
    await env.DB.prepare(
      "INSERT INTO teacher_sessions(token_hash,teacher_id,expires_at,created_at) VALUES(?,?,?,?)",
    )
      .bind(await hash(sessionToken), teacherId, expires, now)
      .run();
    return response(
      {
        teacher: {
          id: teacherId,
          email,
          displayName: name,
          role: "teacher",
          activeFrom: invite.active_from,
          activeUntil: invite.active_until,
        },
      },
      201,
      {
        "set-cookie": authCookie(
          sessionToken,
          604800,
          url.protocol === "https:",
        ),
      },
    );
  }
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const b = await bodyJson(req),
      email = String(b.email || "")
        .trim()
        .toLowerCase(),
      password = String(b.password || ""),
      t = await env.DB.prepare("SELECT * FROM teachers WHERE email=?")
        .bind(email)
        .first();
    if (
      !t ||
      (await passwordHash(password, t.password_salt)) !== t.password_hash
    )
      return fail("Email 或密碼錯誤", 401);
    const now = new Date().toISOString();
    if (
      t.role !== "super_admin" &&
      (t.disabled_at ||
        (t.active_from && t.active_from > now) ||
        (t.active_until && t.active_until <= now))
    )
      return fail("此教師帳號目前已停用或不在啟用期間", 403);
    const sessionToken = token(),
      expires = new Date(Date.now() + 604800000).toISOString();
    await env.DB.prepare(
      "INSERT INTO teacher_sessions(token_hash,teacher_id,expires_at,created_at) VALUES(?,?,?,?)",
    )
      .bind(await hash(sessionToken), t.id, expires, now)
      .run();
    return response({ teacher: teacherJson(t) }, 200, {
      "set-cookie": authCookie(sessionToken, 604800, url.protocol === "https:"),
    });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const raw = cookie(req, "teacher_session");
    if (raw)
      await env.DB.prepare("DELETE FROM teacher_sessions WHERE token_hash=?")
        .bind(await hash(raw))
        .run();
    return response({ ok: true }, 200, {
      "set-cookie": authCookie("", 0, url.protocol === "https:"),
    });
  }
  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const t = await teacher(req, env);
    return t ? response({ teacher: teacherJson(t) }) : fail("尚未登入", 401);
  }
  if (url.pathname === "/api/admin/teachers" && req.method === "GET") {
    const t = await teacher(req, env);
    if (!isSuper(t)) return fail("僅最高管理員可使用", 403);
    const teachers = (
        await env.DB.prepare(
          `SELECT id,email,display_name,role,active_from,active_until,disabled_at,created_at FROM teachers ORDER BY role='super_admin' DESC,created_at`,
        ).all()
      ).results,
      invites = (
        await env.DB.prepare(
          "SELECT id,email,active_from,active_until,created_at FROM teacher_invites WHERE used_at IS NULL ORDER BY created_at DESC",
        ).all()
      ).results;
    return response({
      teachers: teachers.map((x) => ({
        id: x.id,
        email: x.email,
        displayName: x.display_name,
        role: x.role,
        activeFrom: x.active_from,
        activeUntil: x.active_until,
        disabledAt: x.disabled_at,
        createdAt: x.created_at,
      })),
      invites: invites.map((x) => ({
        id: x.id,
        email: x.email,
        activeFrom: x.active_from,
        activeUntil: x.active_until,
        createdAt: x.created_at,
      })),
    });
  }
  if (url.pathname === "/api/admin/teachers" && req.method === "POST") {
    const t = await teacher(req, env);
    if (!isSuper(t)) return fail("僅最高管理員可使用", 403);
    const b = await bodyJson(req),
      email = String(b.email || "")
        .trim()
        .toLowerCase(),
      starts = isoOrNull(b.activeFrom),
      ends = isoOrNull(b.activeUntil);
    if (!/^\S+@\S+\.\S+$/.test(email)) return fail("請輸入有效 Email");
    if (starts && ends && starts >= ends)
      return fail("停用時間必須晚於啟用時間");
    if (
      await env.DB.prepare("SELECT 1 FROM teachers WHERE lower(email)=?")
        .bind(email)
        .first()
    )
      return fail("此 Email 已有教師帳號", 409);
    const inviteId = id("i"),
      now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO teacher_invites(id,email,active_from,active_until,invited_by,created_at,used_at) VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(email) DO UPDATE SET active_from=excluded.active_from,active_until=excluded.active_until,invited_by=excluded.invited_by,created_at=excluded.created_at,used_at=NULL`,
    )
      .bind(inviteId, email, starts, ends, t.id, now)
      .run();
    return response({ ok: true }, 201);
  }
  let adminMatch = url.pathname.match(/^\/api\/admin\/teachers\/([^/]+)$/);
  if (adminMatch && req.method === "PATCH") {
    const t = await teacher(req, env);
    if (!isSuper(t)) return fail("僅最高管理員可使用", 403);
    if (adminMatch[1] === t.id) return fail("最高管理員不能停用自己的帳號");
    const b = await bodyJson(req),
      starts = isoOrNull(b.activeFrom),
      ends = isoOrNull(b.activeUntil),
      disabled = b.disabled ? new Date().toISOString() : null;
    if (starts && ends && starts >= ends)
      return fail("停用時間必須晚於啟用時間");
    const r = await env.DB.prepare(
      `UPDATE teachers SET active_from=?,active_until=?,disabled_at=? WHERE id=? AND role='teacher'`,
    )
      .bind(starts, ends, disabled, adminMatch[1])
      .run();
    if (!r.meta.changes) return fail("找不到教師", 404);
    if (disabled)
      await env.DB.prepare("DELETE FROM teacher_sessions WHERE teacher_id=?")
        .bind(adminMatch[1])
        .run();
    return response({ ok: true });
  }
  if (url.pathname === "/api/admin/trash" && req.method === "GET") {
    const t = await teacher(req, env);
    if (!isSuper(t)) return fail("僅最高管理員可使用", 403);
    const assignments = (
        await env.DB.prepare(
          `SELECT a.id,a.title,a.deleted_at,a.purge_after,t.display_name teacher_name,COUNT(DISTINCT s.id) submissions,COUNT(at.id) audio_count FROM assignments a LEFT JOIN teachers t ON t.id=a.teacher_id LEFT JOIN sessions s ON s.assignment_id=a.id LEFT JOIN attempts at ON at.session_id=s.id WHERE a.deleted_at IS NOT NULL GROUP BY a.id ORDER BY a.deleted_at DESC`,
        ).all()
      ).results,
      audio = (
        await env.DB.prepare(
          `SELECT a.id assignment_id,a.title,MIN(at.deleted_at) deleted_at,MIN(at.purge_after) purge_after,COUNT(at.id) audio_count FROM attempts at JOIN sessions s ON s.id=at.session_id JOIN assignments a ON a.id=s.assignment_id WHERE at.deleted_at IS NOT NULL AND a.deleted_at IS NULL GROUP BY a.id ORDER BY deleted_at DESC`,
        ).all()
      ).results;
    return response({ assignments, audio });
  }
  if (url.pathname === "/api/admin/trash" && req.method === "POST") {
    const t = await teacher(req, env);
    if (!isSuper(t)) return fail("僅最高管理員可使用", 403);
    const b = await bodyJson(req),
      ids = Array.isArray(b.assignmentIds)
        ? [...new Set(b.assignmentIds.map(String))]
        : [],
      scope = b.scope;
    if (!ids.length || !["all", "audio"].includes(scope))
      return fail("請選擇已截止作業與刪除範圍");
    const marks = ids.map(() => "?").join(","),
      now = new Date().toISOString(),
      purge = new Date(Date.now() + 30 * 86400000).toISOString(),
      eligible = (
        await env.DB.prepare(
          `SELECT id FROM assignments WHERE id IN (${marks}) AND deleted_at IS NULL AND ends_at IS NOT NULL AND ends_at<=?`,
        )
          .bind(...ids, now)
          .all()
      ).results.map((x) => x.id);
    if (!eligible.length) return fail("只有已截止作業可放入垃圾桶");
    const okMarks = eligible.map(() => "?").join(",");
    if (scope === "all")
      await env.DB.prepare(
        `UPDATE assignments SET deleted_at=?,purge_after=?,deleted_by=? WHERE id IN (${okMarks})`,
      )
        .bind(now, purge, t.id, ...eligible)
        .run();
    else
      await env.DB.prepare(
        `UPDATE attempts SET deleted_at=?,purge_after=? WHERE deleted_at IS NULL AND session_id IN (SELECT id FROM sessions WHERE assignment_id IN (${okMarks}))`,
      )
        .bind(now, purge, ...eligible)
        .run();
    return response({ moved: eligible.length, purgeAfter: purge });
  }
  if (url.pathname === "/api/admin/trash/restore" && req.method === "POST") {
    const t = await teacher(req, env);
    if (!isSuper(t)) return fail("僅最高管理員可使用", 403);
    const b = await bodyJson(req),
      ids = Array.isArray(b.assignmentIds)
        ? [...new Set(b.assignmentIds.map(String))]
        : [],
      scope = b.scope;
    if (!ids.length || !["all", "audio"].includes(scope))
      return fail("請選擇項目");
    const marks = ids.map(() => "?").join(",");
    if (scope === "all")
      await env.DB.prepare(
        `UPDATE assignments SET deleted_at=NULL,purge_after=NULL,deleted_by=NULL WHERE id IN (${marks})`,
      )
        .bind(...ids)
        .run();
    else
      await env.DB.prepare(
        `UPDATE attempts SET deleted_at=NULL,purge_after=NULL WHERE session_id IN (SELECT id FROM sessions WHERE assignment_id IN (${marks}))`,
      )
        .bind(...ids)
        .run();
    return response({ ok: true });
  }
  if (url.pathname === "/api/admin/trash/purge" && req.method === "POST") {
    const t = await teacher(req, env);
    if (!isSuper(t)) return fail("僅最高管理員可使用", 403);
    const b = await bodyJson(req),
      all = b.all === true,
      scope = b.scope,
      ids = Array.isArray(b.assignmentIds)
        ? [...new Set(b.assignmentIds.map(String))]
        : [];
    if (!["all", "audio"].includes(scope)) return fail("刪除範圍錯誤");
    if (scope === "all") {
      const rows = all
        ? (
            await env.DB.prepare(
              "SELECT id FROM assignments WHERE deleted_at IS NOT NULL",
            ).all()
          ).results
        : ids.length
          ? (
              await env.DB.prepare(
                `SELECT id FROM assignments WHERE deleted_at IS NOT NULL AND id IN (${ids.map(() => "?").join(",")})`,
              )
                .bind(...ids)
                .all()
            ).results
          : [];
      const audio = await purgeAssignments(
        env,
        rows.map((x) => x.id),
      );
      return response({ purged: rows.length, audio });
    }
    const clause = all
      ? ""
      : ` AND s.assignment_id IN (${ids.map(() => "?").join(",")})`;
    if (!all && !ids.length) return fail("請選擇項目");
    const count = await deleteAttemptObjects(
      env,
      `deleted_at IS NOT NULL AND session_id IN (SELECT s.id FROM sessions s WHERE 1=1${clause})`,
      ids,
    );
    await env.DB.prepare(
      `DELETE FROM attempts WHERE deleted_at IS NOT NULL AND session_id IN (SELECT s.id FROM sessions s WHERE 1=1${clause})`,
    )
      .bind(...ids)
      .run();
    return response({ purged: count });
  }
  if (req.method === "GET" && url.pathname === "/api/teacher/assignments") {
    const t = await teacher(req, env);
    if (!t) return fail("請先登入", 401);
    const language = url.searchParams.get("language") || "",
      status = url.searchParams.get("status") || "",
      days = Number(url.searchParams.get("days") || 0),
      page = Math.max(1, Number(url.searchParams.get("page") || 1)),
      q = `%${url.searchParams.get("q") || ""}%`,
      now = new Date().toISOString(),
      cutoff = days ? new Date(Date.now() - days * 86400000).toISOString() : "";
    const ownership = isSuper(t) ? "1=1" : "a.teacher_id=?",
      where = `a.deleted_at IS NULL AND ${ownership} AND (?='' OR a.language=?) AND (?='' OR a.created_at>=?) AND (?='' OR (?='upcoming' AND a.starts_at IS NOT NULL AND a.starts_at>?) OR (?='ended' AND a.ends_at IS NOT NULL AND a.ends_at<=?) OR (?='ongoing' AND (a.starts_at IS NULL OR a.starts_at<=?) AND (a.ends_at IS NULL OR a.ends_at>?))) AND (a.title LIKE ? OR a.instructions LIKE ? OR EXISTS(SELECT 1 FROM sentences sx WHERE sx.assignment_id=a.id AND (sx.text LIKE ? OR sx.pinyin LIKE ?)))`,
      values = [
        ...(isSuper(t) ? [] : [t.id]),
        language,
        language,
        cutoff,
        cutoff,
        status,
        status,
        now,
        status,
        now,
        status,
        now,
        now,
        q,
        q,
        q,
        q,
      ];
    const totalRow = await env.DB.prepare(
        `SELECT COUNT(*) total FROM assignments a WHERE ${where}`,
      )
        .bind(...values)
        .first(),
      total = totalRow.total || 0,
      pages = Math.max(1, Math.ceil(total / 10));
    const rows = (
      await env.DB.prepare(
        `SELECT a.*,t.display_name teacher_name,t.email teacher_email,(SELECT COUNT(*) FROM sessions s WHERE s.assignment_id=a.id) submissions,(SELECT COUNT(*) FROM sentences se WHERE se.assignment_id=a.id) sentence_count FROM assignments a LEFT JOIN teachers t ON t.id=a.teacher_id WHERE ${where} ORDER BY a.created_at DESC LIMIT 10 OFFSET ?`,
      )
        .bind(...values, (page - 1) * 10)
        .all()
    ).results;
    return response({
      assignments: rows.map((a) => ({
        id: a.id,
        code: a.code,
        title: a.title,
        instructions: a.instructions,
        language: a.language,
        anonymous: Boolean(a.anonymous),
        identityMode: a.identity_mode || (a.anonymous ? "anonymous" : "full"),
        deidentifyVoice: Boolean(a.deidentify_voice),
        transformVersion: a.transform_version || null,
        createdAt: a.created_at,
        startsAt: a.starts_at,
        endsAt: a.ends_at,
        status: assignmentStatus(a, now),
        submissions: a.submissions,
        sentenceCount: a.sentence_count,
        teacherName: a.teacher_name || "系統舊作業",
        teacherEmail: a.teacher_email || null,
        canEdit: canEdit(t, a),
      })),
      pagination: { page: Math.min(page, pages), pages, total, perPage: 10 },
    });
  }
  let teacherMatch = url.pathname.match(
    /^\/api\/teacher\/assignments\/([^/]+)$/,
  );
  if (req.method === "GET" && teacherMatch) {
    const t = await teacher(req, env);
    if (!t) return fail("請先登入", 401);
    const a = await env.DB.prepare(
      "SELECT a.*,t.display_name teacher_name,t.email teacher_email FROM assignments a LEFT JOIN teachers t ON t.id=a.teacher_id WHERE a.id=? AND a.deleted_at IS NULL",
    )
      .bind(teacherMatch[1])
      .first();
    if (!a || !canEdit(t, a)) return fail("找不到作業或無權檢視", 404);
    const ss = (
      await env.DB.prepare(
        "SELECT * FROM sessions WHERE assignment_id=? ORDER BY started_at DESC",
      )
        .bind(a.id)
        .all()
    ).results;
    for (const s of ss) {
      s.answers = (
        await env.DB.prepare(
          `SELECT an.sentence_id,an.accepted_attempt,COUNT(at.id) attempts,MAX(CASE WHEN at.attempt_number=an.accepted_attempt THEN at.id END) audio_id FROM answers an LEFT JOIN attempts at ON at.session_id=an.session_id AND at.sentence_id=an.sentence_id AND at.deleted_at IS NULL WHERE an.session_id=? GROUP BY an.sentence_id,an.accepted_attempt`,
        )
          .bind(s.id)
          .all()
      ).results.map((x) => ({
        sentenceId: x.sentence_id,
        attempts: x.attempts,
        acceptedAttempt: x.accepted_attempt,
        audioUrl: x.audio_id ? `/api/teacher/audio/${x.audio_id}` : null,
      }));
    }
    return response({
      assignment: {
        ...publicAssignment(a, await sentences(env, a.id)),
        language: a.language,
        teacherName: a.teacher_name || "系統舊作業",
        teacherEmail: a.teacher_email,
        canEdit: true,
      },
      sessions: ss.map((s) => ({
        id: s.id,
        name: s.name,
        studentId: s.student_id,
        anonymousId: s.anonymous_id,
        startedAt: s.started_at,
        completedAt: s.completed_at,
        answers: s.answers,
      })),
    });
  }
  if (req.method === "PATCH" && teacherMatch) {
    const t = await teacher(req, env);
    if (!t) return fail("請先登入", 401);
    const a = await env.DB.prepare(
      "SELECT * FROM assignments WHERE id=? AND deleted_at IS NULL",
    )
      .bind(teacherMatch[1])
      .first();
    if (!a || !canEdit(t, a)) return fail("找不到作業或無權編輯", 404);
    const b = await bodyJson(req),
      starts = isoOrNull(b.startsAt),
      ends = isoOrNull(b.endsAt),
      title = String(b.title ?? a.title).trim(),
      instructions = String(b.instructions ?? a.instructions),
      language = String(b.language ?? a.language),
      deidentify =
        b.deidentifyVoice === undefined
          ? Boolean(a.deidentify_voice)
          : b.deidentifyVoice === true,
      identityMode = String(
        b.identityMode ??
          a.identity_mode ??
          (a.anonymous ? "anonymous" : "full"),
      );
    if (!title) return fail("請輸入作業名稱");
    if (!["zh-TW", "en"].includes(language)) return fail("請選擇中文或英文課");
    if (!["full", "name_only", "anonymous"].includes(identityMode))
      return fail("身分資料模式錯誤");
    if (starts && ends && starts >= ends)
      return fail("結束時間必須晚於開始時間");
    const hasSessions = await env.DB.prepare(
        "SELECT 1 FROM sessions WHERE assignment_id=? LIMIT 1",
      )
        .bind(a.id)
        .first(),
      oldMode = a.identity_mode || (a.anonymous ? "anonymous" : "full");
    if (
      hasSessions &&
      (deidentify !== Boolean(a.deidentify_voice) || identityMode !== oldMode)
    )
      return fail("已有學生開始作答，無法變更匿名或聲音去識別化設定", 409);
    if (Array.isArray(b.sentences)) {
      if (hasSessions)
        return fail("已有學生開始作答，只能修改基本資料與開放時間", 409);
      if (
        !b.sentences.length ||
        b.sentences.some(
          (s) =>
            !String(s.text || "").trim() || !validMaxAttempts(s.maxAttempts),
        )
      )
        return fail("題目文字與錄製次數格式錯誤");
      const statements = [
        env.DB.prepare("DELETE FROM sentences WHERE assignment_id=?").bind(
          a.id,
        ),
      ];
      for (let i = 0; i < b.sentences.length; i++) {
        const s = b.sentences[i];
        statements.push(
          env.DB.prepare(
            "INSERT INTO sentences(id,assignment_id,position,text,pinyin,max_attempts) VALUES(?,?,?,?,?,?)",
          ).bind(
            id("q"),
            a.id,
            i,
            String(s.text).trim(),
            String(s.pinyin || ""),
            Number(s.maxAttempts),
          ),
        );
      }
      await env.DB.batch(statements);
    }
    await env.DB.prepare(
      "UPDATE assignments SET title=?,instructions=?,language=?,starts_at=?,ends_at=?,deidentify_voice=?,transform_version=?,identity_mode=?,anonymous=? WHERE id=?",
    )
      .bind(
        title,
        instructions,
        language,
        starts,
        ends,
        deidentify ? 1 : 0,
        deidentify ? TRANSFORM_VERSION : null,
        identityMode,
        identityMode === "anonymous" ? 1 : 0,
        a.id,
      )
      .run();
    return response({
      ok: true,
      status: assignmentStatus({ starts_at: starts, ends_at: ends }),
    });
  }
  teacherMatch = url.pathname.match(/^\/api\/teacher\/audio\/([^/]+)$/);
  if (req.method === "GET" && teacherMatch) {
    const t = await teacher(req, env);
    if (!t) return fail("請先登入", 401);
    const meta = await env.DB.prepare(
      `SELECT at.*,a.teacher_id FROM attempts at JOIN sessions s ON s.id=at.session_id JOIN assignments a ON a.id=s.assignment_id WHERE at.id=? AND at.deleted_at IS NULL AND a.deleted_at IS NULL`,
    )
      .bind(teacherMatch[1])
      .first();
    if (!meta || !(isSuper(t) || meta.teacher_id === t.id))
      return fail("找不到音檔", 404);
    const object = await env.AUDIO.get(meta.r2_key);
    return object
      ? new Response(object.body, {
          headers: {
            "content-type": meta.mime_type,
            "cache-control": "private, no-store",
          },
        })
      : fail("找不到音檔", 404);
  }
  if (req.method === "POST" && url.pathname === "/api/assignments") {
    const owner = await teacher(req, env);
    if (!owner) return fail("請先登入", 401);
    const b = await bodyJson(req),
      language = String(b.language || ""),
      starts = b.startsAt ? new Date(b.startsAt).toISOString() : null,
      ends = b.endsAt ? new Date(b.endsAt).toISOString() : null,
      deidentify = b.deidentifyVoice === true,
      identityMode = String(b.identityMode || "full");
    if (!["zh-TW", "en"].includes(language)) return fail("請選擇中文或英文課");
    if (!["full", "name_only", "anonymous"].includes(identityMode))
      return fail("身分資料模式錯誤");
    if (starts && ends && starts >= ends)
      return fail("結束時間必須晚於開始時間");
    if (!String(b.title || "").trim()) return fail("請輸入作業名稱");
    if (
      !Array.isArray(b.sentences) ||
      !b.sentences.length ||
      b.sentences.some((s) => !String(s.text || "").trim())
    )
      return fail("至少需要一個非空白句子");
    if (b.sentences.some((s) => !validMaxAttempts(s.maxAttempts)))
      return fail("每題錄製次數必須為 1–10 的整數");
    const assignmentId = id("a"),
      adminKey = token(),
      now = new Date().toISOString();
    let courseCode;
    for (let n = 0; n < 5; n++) {
      courseCode = code();
      if (!(await assignmentByCode(env, courseCode))) break;
    }
    const legacyMax = Number(b.sentences[0].maxAttempts),
      statements = [
        env.DB.prepare(
          "INSERT INTO assignments(id,code,admin_key_hash,title,instructions,anonymous,max_attempts,created_at,teacher_id,language,starts_at,ends_at,deidentify_voice,transform_version,identity_mode) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).bind(
          assignmentId,
          courseCode,
          await hash(adminKey),
          String(b.title).trim(),
          String(b.instructions || ""),
          identityMode === "anonymous" ? 1 : 0,
          legacyMax,
          now,
          owner.id,
          language,
          starts,
          ends,
          deidentify ? 1 : 0,
          deidentify ? TRANSFORM_VERSION : null,
          identityMode,
        ),
      ];
    const qs = b.sentences.map((s, i) => ({
      id: id("q"),
      text: String(s.text).trim(),
      pinyin: String(s.pinyin || ""),
      position: i,
      maxAttempts: Number(s.maxAttempts),
    }));
    for (const q of qs)
      statements.push(
        env.DB.prepare(
          "INSERT INTO sentences(id,assignment_id,position,text,pinyin,max_attempts) VALUES(?,?,?,?,?,?)",
        ).bind(q.id, assignmentId, q.position, q.text, q.pinyin, q.maxAttempts),
      );
    await env.DB.batch(statements);
    const a = await env.DB.prepare("SELECT * FROM assignments WHERE id=?")
      .bind(assignmentId)
      .first();
    return response(
      { ...publicAssignment(a, qs), language: a.language, adminKey },
      201,
    );
  }
  let m = url.pathname.match(/^\/api\/assignments\/code\/([A-Z0-9]+)$/i);
  if (req.method === "GET" && m) {
    const a = await assignmentByCode(env, m[1]);
    return a
      ? response(publicAssignment(a, await sentences(env, a.id)))
      : fail("找不到課程代碼", 404);
  }
  m = url.pathname.match(/^\/api\/assignments\/([^/]+)$/);
  if (req.method === "PUT" && m) {
    const a = await env.DB.prepare("SELECT * FROM assignments WHERE id=?")
      .bind(m[1])
      .first();
    if (!a) return fail("找不到作業", 404);
    if (!(await authorizeAdmin(req, a))) return fail("管理金鑰錯誤", 403);
    if (
      await env.DB.prepare(
        "SELECT 1 FROM sessions WHERE assignment_id=? LIMIT 1",
      )
        .bind(a.id)
        .first()
    )
      return fail("已有學生開始作答，無法修改", 409);
    const b = await bodyJson(req),
      max = Number(b.maxAttempts);
    if (!validMaxAttempts(max)) return fail("錄製次數必須為 1–10 的整數");
    await env.DB.prepare("UPDATE assignments SET max_attempts=? WHERE id=?")
      .bind(max, a.id)
      .run();
    a.max_attempts = max;
    return response(publicAssignment(a, await sentences(env, a.id)));
  }
  m = url.pathname.match(/^\/api\/assignments\/([^/]+)\/submissions$/);
  if (req.method === "GET" && m) {
    const a = await env.DB.prepare("SELECT * FROM assignments WHERE id=?")
      .bind(m[1])
      .first();
    if (!a) return fail("找不到作業", 404);
    if (!(await authorizeAdmin(req, a))) return fail("管理金鑰錯誤", 403);
    const ss = (
      await env.DB.prepare(
        "SELECT * FROM sessions WHERE assignment_id=? ORDER BY started_at DESC",
      )
        .bind(a.id)
        .all()
    ).results;
    for (const s of ss) {
      s.answers = (
        await env.DB.prepare(
          `SELECT an.sentence_id,an.accepted_attempt,COUNT(at.id) attempts,MAX(CASE WHEN at.attempt_number=an.accepted_attempt THEN at.id END) audio_id FROM answers an LEFT JOIN attempts at ON at.session_id=an.session_id AND at.sentence_id=an.sentence_id WHERE an.session_id=? GROUP BY an.sentence_id,an.accepted_attempt`,
        )
          .bind(s.id)
          .all()
      ).results.map((x) => ({
        sentenceId: x.sentence_id,
        attempts: x.attempts,
        acceptedAttempt: x.accepted_attempt,
        audioUrl: x.audio_id
          ? `/api/audio/${x.audio_id}?assignment=${a.id}&key=${encodeURIComponent(req.headers.get("x-admin-key"))}`
          : null,
      }));
    }
    return response({
      assignment: publicAssignment(a, await sentences(env, a.id)),
      sessions: ss.map((s) => ({
        id: s.id,
        name: s.name,
        studentId: s.student_id,
        anonymousId: s.anonymous_id,
        startedAt: s.started_at,
        completedAt: s.completed_at,
        answers: s.answers,
      })),
    });
  }
  if (req.method === "POST" && url.pathname === "/api/sessions") {
    const b = await bodyJson(req),
      a = await assignmentByCode(env, b.code);
    if (!a) return fail("找不到課程代碼", 404);
    const clock = new Date().toISOString(),
      profile = String(b.voiceProfile || ""),
      identityMode = a.identity_mode || (a.anonymous ? "anonymous" : "full"),
      name = String(b.name || "").trim(),
      studentId = String(b.studentId || "").trim();
    if (a.starts_at && clock < a.starts_at) return fail("作業尚未開放", 403);
    if (a.ends_at && clock >= a.ends_at) return fail("作業已結束", 403);
    if (b.deviceTestPassed !== true) return fail("必須先完成設備測試");
    if (identityMode === "full" && (!name || !studentId))
      return fail("請填寫姓名與學號");
    if (identityMode === "name_only" && !name) return fail("請填寫姓名");
    if (a.deidentify_voice && !TRANSFORM_PROFILES.has(profile))
      return fail("請選擇聲音去識別化處理設定");
    const sessionId = id("s"),
      sessionToken = token(),
      now = clock,
      qs = await sentences(env, a.id),
      anonymousId =
        identityMode === "anonymous" ? `匿名-${token(3).toUpperCase()}` : null;
    const statements = [
      env.DB.prepare(
        "INSERT INTO sessions(id,token_hash,assignment_id,name,student_id,anonymous_id,device_test_confirmed_at,started_at,voice_profile) VALUES(?,?,?,?,?,?,?,?,?)",
      ).bind(
        sessionId,
        await hash(sessionToken),
        a.id,
        identityMode === "anonymous" ? null : name,
        identityMode === "full" ? studentId : null,
        anonymousId,
        now,
        now,
        a.deidentify_voice ? profile : null,
      ),
      ...qs.map((q) =>
        env.DB.prepare(
          "INSERT INTO answers(session_id,sentence_id) VALUES(?,?)",
        ).bind(sessionId, q.id),
      ),
    ];
    await env.DB.batch(statements);
    return response(
      {
        sessionId,
        sessionToken,
        assignment: publicAssignment(a, qs),
        anonymousId,
        voiceProfile: a.deidentify_voice ? profile : null,
      },
      201,
    );
  }
  m = url.pathname.match(
    /^\/api\/sessions\/([^/]+)\/sentences\/([^/]+)\/attempts$/,
  );
  if (req.method === "POST" && m) {
    const s = await authorizeSession(req, env, m[1]);
    if (!s || s.completed_at)
      return fail("作答階段不存在、權限錯誤或已完成", 404);
    const type = (req.headers.get("content-type") || "").split(";")[0];
    if (!AUDIO_TYPES.has(type)) return fail("不支援的音訊格式", 415);
    const length = Number(req.headers.get("content-length") || 0);
    if (length > MAX_AUDIO) return fail("音訊檔超過 15MB", 413);
    const q = await env.DB.prepare(
      `SELECT se.position,COALESCE(se.max_attempts,a.max_attempts) max_attempts,a.ends_at,a.deidentify_voice,an.accepted_attempt,(SELECT COUNT(*) FROM attempts t WHERE t.session_id=an.session_id AND t.sentence_id=an.sentence_id) used,(SELECT COUNT(*) FROM answers prior JOIN sentences ps ON ps.id=prior.sentence_id WHERE prior.session_id=an.session_id AND ps.position<se.position AND prior.accepted_attempt IS NULL) incomplete FROM answers an JOIN sentences se ON se.id=an.sentence_id JOIN assignments a ON a.id=se.assignment_id WHERE an.session_id=? AND an.sentence_id=?`,
    )
      .bind(s.id, m[2])
      .first();
    if (!q) return fail("找不到題目", 404);
    if (q.ends_at && new Date().toISOString() >= q.ends_at)
      return fail("作業已結束", 403);
    if (q.incomplete) return fail("必須依序完成題目", 409);
    if (q.accepted_attempt) return fail("題目已完成", 409);
    if (q.used >= q.max_attempts) return fail("已達錄製次數上限", 409);
    const transformProfile = req.headers.get("x-transform-profile"),
      transformVersion = req.headers.get("x-transform-version");
    if (
      q.deidentify_voice &&
      (type !== "audio/wav" ||
        transformProfile !== s.voice_profile ||
        transformVersion !== TRANSFORM_VERSION)
    )
      return fail("此作業只接受指定版本的去識別化 WAV", 415);
    const audio = await req.arrayBuffer();
    if (audio.byteLength < 100) return fail("未收到有效音訊資料");
    if (audio.byteLength > MAX_AUDIO) return fail("音訊檔超過 15MB", 413);
    const attemptId = id("r"),
      number = q.used + 1,
      key = `${s.assignment_id}/${s.id}/${m[2]}/${attemptId}.${ext(type)}`;
    await env.AUDIO.put(key, audio, { httpMetadata: { contentType: type } });
    try {
      await env.DB.prepare(
        `INSERT INTO attempts(id,session_id,sentence_id,attempt_number,r2_key,mime_type,byte_size,created_at,transform_profile,transform_version) SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM attempts WHERE session_id=? AND sentence_id=?) < ? AND (SELECT accepted_attempt FROM answers WHERE session_id=? AND sentence_id=?) IS NULL`,
      )
        .bind(
          attemptId,
          s.id,
          m[2],
          number,
          key,
          type,
          audio.byteLength,
          new Date().toISOString(),
          q.deidentify_voice ? transformProfile : null,
          q.deidentify_voice ? transformVersion : null,
          s.id,
          m[2],
          q.max_attempts,
          s.id,
          m[2],
        )
        .run();
    } catch (e) {
      await env.AUDIO.delete(key);
      return fail("錄製次數已由另一個請求使用，請重新整理", 409);
    }
    const actual = await env.DB.prepare(
      "SELECT COUNT(*) count FROM attempts WHERE session_id=? AND sentence_id=?",
    )
      .bind(s.id, m[2])
      .first();
    return response(
      {
        attempt: actual.count,
        maxAttempts: q.max_attempts,
        remaining: q.max_attempts - actual.count,
        deidentified: Boolean(q.deidentify_voice),
      },
      201,
    );
  }
  m = url.pathname.match(
    /^\/api\/sessions\/([^/]+)\/sentences\/([^/]+)\/accept$/,
  );
  if (req.method === "POST" && m) {
    const s = await authorizeSession(req, env, m[1]);
    if (!s || s.completed_at)
      return fail("作答階段不存在、權限錯誤或已完成", 404);
    const latest = await env.DB.prepare(
      "SELECT MAX(attempt_number) n FROM attempts WHERE session_id=? AND sentence_id=? AND deleted_at IS NULL",
    )
      .bind(s.id, m[2])
      .first();
    if (!latest?.n) return fail("尚無成功儲存的錄音");
    const r = await env.DB.prepare(
      "UPDATE answers SET accepted_attempt=? WHERE session_id=? AND sentence_id=? AND accepted_attempt IS NULL",
    )
      .bind(latest.n, s.id, m[2])
      .run();
    if (!r.meta.changes) return fail("題目已完成", 409);
    return response({ acceptedAttempt: latest.n });
  }
  m = url.pathname.match(/^\/api\/sessions\/([^/]+)\/complete$/);
  if (req.method === "POST" && m) {
    const s = await authorizeSession(req, env, m[1]);
    if (!s) return fail("找不到作答階段或權限錯誤", 404);
    if (
      await env.DB.prepare(
        "SELECT 1 FROM answers WHERE session_id=? AND accepted_attempt IS NULL LIMIT 1",
      )
        .bind(s.id)
        .first()
    )
      return fail("仍有題目尚未完成", 409);
    const done = s.completed_at || new Date().toISOString();
    await env.DB.prepare(
      "UPDATE sessions SET completed_at=? WHERE id=? AND completed_at IS NULL",
    )
      .bind(done, s.id)
      .run();
    return response({
      completedAt: done,
      name: s.name,
      studentId: s.student_id,
      anonymousId: s.anonymous_id,
    });
  }
  m = url.pathname.match(/^\/api\/audio\/([^/]+)$/);
  if (req.method === "GET" && m) {
    const a = await env.DB.prepare("SELECT * FROM assignments WHERE id=?")
      .bind(url.searchParams.get("assignment"))
      .first();
    if (
      !a ||
      (await hash(url.searchParams.get("key") || "")) !== a.admin_key_hash
    )
      return fail("無權存取音檔", 403);
    const meta = await env.DB.prepare(
      `SELECT at.* FROM attempts at JOIN sessions s ON s.id=at.session_id WHERE at.id=? AND s.assignment_id=?`,
    )
      .bind(m[1], a.id)
      .first();
    if (!meta) return fail("找不到音檔", 404);
    const object = await env.AUDIO.get(meta.r2_key);
    if (!object) return fail("找不到音檔", 404);
    return new Response(object.body, {
      headers: {
        "content-type": meta.mime_type,
        "content-disposition": "inline",
        "cache-control": "private, no-store",
      },
    });
  }
  return fail("API 路徑不存在", 404);
}

export default {
  async fetch(req, env) {
    try {
      const url = new URL(req.url);
      return url.pathname.startsWith("/api/")
        ? await api(req, env, url)
        : env.ASSETS.fetch(req);
    } catch (e) {
      console.error(e);
      return fail(e.status ? e.message : "伺服器錯誤", e.status || 500);
    }
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(purgeExpired(env));
  },
};
