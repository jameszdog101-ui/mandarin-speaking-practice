import { submissionList, bindSubmissions, submissionTrash } from './submissions.js';
import { transformRecording } from "./audio-transform.js";
import { prepareRecording, MAX_RECORDING_SECONDS } from './recording.js';
import { VOICE_PROFILES, VOICE_TRANSFORM_VERSION } from "./voice-profiles.js";
import { openClassroom } from "./classroom.js";

const app = document.querySelector("#app");
const state = {
  assignment: null,
  testBlob: null,
  testUrl: null,
  stream: null,
  audioContext: null,
  session: null,
  index: 0,
  lastAttempt: null,
  teacher: null,
};
const esc = (s = "") =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const steps = (n, total = 4) =>
  `<div class="steps">${Array.from({ length: total }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</div>`;
async function request(url, options = {}) {
  const token = state.session?.sessionToken;
  if (token && url.startsWith("/api/sessions/"))
    options.headers = { ...(options.headers || {}), "X-Session-Token": token };
  const r = await fetch(url, options);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "操作失敗");
  return data;
}
function message(text, bad = false) {
  return `<div class="notice ${bad ? "error" : ""}">${esc(text)}</div>`;
}
const languageDialog = document.querySelector("#languageDialog"),
  languageSelect = document.querySelector("#platformLanguage");
window.googleTranslateElementInit = () =>
  new google.translate.TranslateElement(
    {
      pageLanguage: "zh-TW",
      includedLanguages: "zh-TW,zh-CN,en,ja,ko,vi,id,ms,th,es,fr",
      autoDisplay: false,
    },
    "google_translate_element",
  );
if (window.google?.translate?.TranslateElement)
  window.googleTranslateElementInit();
document.querySelector("#languageButton").onclick = () =>
  languageDialog.showModal();
document.querySelector("#applyLanguage").onclick = () => {
  const target = languageSelect.value,
    combo = document.querySelector(".goog-te-combo");
  localStorage.setItem("platformLanguage", target);
  if (target === "zh-TW") {
    document.cookie = "googtrans=; Max-Age=0; Path=/";
    document.cookie =
      "googtrans=; Max-Age=0; Path=/; Domain=" + location.hostname;
    location.reload();
    return;
  }
  if (!combo) {
    document.querySelector("#applyLanguage").textContent =
      "翻譯工具載入中，請稍後重試";
    return;
  }
  combo.value = target;
  combo.dispatchEvent(new Event("change"));
  languageDialog.close();
};
languageSelect.value = localStorage.getItem("platformLanguage") || "zh-TW";

function home() {
  cleanupTest();
  app.innerHTML = `<section class="hero"><div><div class="eyebrow">LANGUAGE, ONE SENTENCE AT A TIME</div><h1>一句一句，<br>說出自信。</h1><p>適用中文與英文語言訓練。先確認設備，再安心練習；每一次正式錄音都清楚計次，讓學生專注在自己的聲音，也讓教師掌握學習歷程。</p><div class="actions"><a class="btn" href="#student">我是學生</a><a class="btn secondary" href="#teacher">教師登入</a></div></div><div class="hero-art"><div class="wave">∿∿∿</div></div></section>`;
}
function student() {
  cleanupTest();
  app.innerHTML = `<section class="panel">${steps(0)}<div class="eyebrow">STEP 1</div><h2>進入課程</h2><p>輸入教師提供的六位課程代碼。</p><form id="join"><label>課程代碼</label><input name="code" maxlength="6" autocomplete="off" placeholder="例如 ABC123" required><div id="msg"></div><button>繼續</button></form></section>`;
  document.querySelector("#join").onsubmit = async (e) => {
    e.preventDefault();
    try {
      state.assignment = await request(
        "/api/assignments/code/" +
          new FormData(e.target).get("code").trim().toUpperCase(),
      );
      device();
    } catch (x) {
      document.querySelector("#msg").innerHTML = message(x.message, true);
    }
  };
}
async function getMic() {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error(
      "此瀏覽器不支援麥克風錄音，請改用最新版 Chrome、Edge 或 Safari",
    );
  return navigator.mediaDevices.getUserMedia({ audio: true });
}
function device() {
  app.innerHTML = `<section class="panel">${steps(1)}<div class="eyebrow">STEP 2</div><h2>開始之前，先確認您的錄音設備</h2><p>測試音訊只存在這個瀏覽器頁面，不會上傳，也不計入正式錄製次數。</p><div id="deviceStatus" class="notice">等待取得麥克風權限</div><div class="meter"><b id="level"></b></div><button id="test">開始測試錄音（4 秒）</button><div id="play"></div><button id="confirm" disabled>確認設備正常，開始作業</button></section>`;
  setupDevice();
}
async function setupDevice() {
  const status = document.querySelector("#deviceStatus");
  try {
    state.stream = await getMic();
    status.textContent = "✓ 已偵測到麥克風，可開始測試";
    state.audioContext = new AudioContext();
    const analyser = state.audioContext.createAnalyser();
    state.audioContext.createMediaStreamSource(state.stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let peak = 0;
    const tick = () => {
      if (!state.stream) return;
      analyser.getByteFrequencyData(data);
      const level = Math.max(...data) / 255;
      peak = Math.max(peak, level);
      const el = document.querySelector("#level");
      if (el) el.style.width = `${Math.max(2, level * 100)}%`;
      requestAnimationFrame(tick);
    };
    tick();
    document.querySelector("#test").onclick = () => recordTest(peak);
  } catch (e) {
    status.className = "notice error";
    status.innerHTML =
      "無法使用麥克風。請在瀏覽器網址列的權限設定允許麥克風，確認輸入裝置後重新整理。<br>" +
      esc(e.message);
  }
}
function recordTest() {
  const btn = document.querySelector("#test"),
    status = document.querySelector("#deviceStatus");
  const chunks = [];
  let recorder;
  try {
    recorder = new MediaRecorder(state.stream);
  } catch {
    status.innerHTML = "瀏覽器無法建立錄音，請改用最新版瀏覽器。";
    status.className = "notice error";
    return;
  }
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  recorder.onstop = () => {
    state.testBlob = new Blob(chunks, { type: recorder.mimeType });
    if (state.testUrl) URL.revokeObjectURL(state.testUrl);
    state.testUrl = URL.createObjectURL(state.testBlob);
    document.querySelector("#play").innerHTML =
      `<label>播放測試錄音並自行確認聲音是否清楚</label><audio controls src="${state.testUrl}"></audio>`;
    status.textContent =
      state.testBlob.size > 100
        ? "✓ 已取得可播放的測試音訊，請播放確認"
        : "未偵測到有效聲音，請檢查麥克風與輸入來源後重試";
    status.className = state.testBlob.size > 100 ? "notice" : "notice error";
    document.querySelector("#confirm").disabled = state.testBlob.size <= 100;
    btn.disabled = false;
    btn.textContent = "重新測試";
  };
  btn.disabled = true;
  status.textContent = "錄音中…請說一小段話";
  recorder.start();
  setTimeout(() => recorder.state === "recording" && recorder.stop(), 4000);
  document.querySelector("#confirm").onclick = identity;
}
function cleanupTest() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  if (state.audioContext) {
    state.audioContext.close();
    state.audioContext = null;
  }
  if (state.testUrl) {
    URL.revokeObjectURL(state.testUrl);
    state.testUrl = null;
  }
  state.testBlob = null;
}
function identity() {
  cleanupTest();
  const a = state.assignment,
    mode = a.identityMode || (a.anonymous ? "anonymous" : "full"),
    fullyAnonymous = mode === "anonymous",
    nameOnly = mode === "name_only";
  app.innerHTML = `<section class="panel">${steps(2)}<div class="eyebrow">STEP 3</div><h2>${fullyAnonymous ? "匿名作業" : "學生資料"}</h2><p>${fullyAnonymous ? "本作業不蒐集姓名與學號，系統會產生匿名編號。" : nameOnly ? "本作業只蒐集姓名，不要求學號。" : "資料僅供教師辨識本次作答。"}</p><form id="identity">${mode === "full" ? `<label>姓名</label><input name="name" required><label>學號</label><input name="studentId" required>` : nameOnly ? `<label>姓名</label><input name="name" required>` : ""}${a.deidentifyVoice ? `<div class="notice"><b>本作業已啟用聲音去識別化</b><br>原始聲音只在此裝置處理，不會上傳；系統只儲存轉換後的版本。此處理用於降低聲音被辨識的風險，不保證完全匿名。</div><label>生理性別（僅用於選擇固定聲音轉換設定）</label><select name="voiceProfile" required><option value="">請選擇</option><option value="PROFILE_A_M">男性</option><option value="PROFILE_A_F">女性</option></select>` : ""}<div id="msg"></div><button>閱讀作業說明</button></form></section>`;
  document.querySelector("#identity").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      state.session = await request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, code: a.code, deviceTestPassed: true }),
      });
      intro();
    } catch (x) {
      document.querySelector("#msg").innerHTML = message(x.message, true);
    }
  };
}
function intro() {
  const a = state.assignment;
  app.innerHTML = `<section class="panel">${steps(3)}<div class="eyebrow">STEP 4</div><h2>${esc(a.title)}</h2><p>${esc(a.instructions || "請依序朗讀每一個句子。")}</p><div class="notice">共 ${a.sentences.length} 題｜各題錄製上限：${a.sentences.map((q, i) => `${i + 1}：${q.maxAttempts} 次`).join("、")}<br>完成錄製就會消耗一次額度；採用並成功儲存後將進入下一題，無法返回修改。</div>${a.deidentifyVoice ? '<div class="notice">🔒 正式錄音會先在此裝置完成去識別化，原始錄音不會上傳。</div>' : ""}<button id="begin">開始正式錄音</button></section>`;
  document.querySelector("#begin").onclick = () => {
    state.index = 0;
    practice();
  };
}
let disposeRecording;
async function practice() {
  disposeRecording?.();
  const a = state.assignment,
    q = a.sentences[state.index];
  state.lastAttempt = null;
  app.innerHTML = `<section class="panel wide">${steps(4)}<div class="row" style="justify-content:space-between"><b>第 ${state.index + 1}／${a.sentences.length} 題</b><span id="count" class="counter">已錄製 0／${q.maxAttempts} 次｜剩餘 ${q.maxAttempts} 次</span></div><div class="sentence"><div class="han">${esc(q.text)}</div><div class="pin">${esc(q.pinyin)}</div><button id="record" class="record" aria-label="開始錄音">●</button><div id="status">點擊紅色按鈕開始錄音</div><div id="preview"></div><div id="msg"></div></div></section>`;
  let timer, limitTimer, startedAt;
  let stream,
    recorder,
    chunks = [];
  let disposed = false;
  disposeRecording = () => {
    disposed = true;
    clearInterval(timer); clearTimeout(limitTimer);
    if (recorder) { recorder.onstop = null; if (recorder.state === 'recording') recorder.stop(); }
    stream?.getTracks().forEach(t => t.stop());
  };
  document.querySelector("#record").onclick = async () => {
    const btn = document.querySelector("#record");
    if (recorder?.state === "recording") {
      recorder.stop();
      return;
    }
    try {
      btn.disabled = true;
      stream = await getMic();
      if (disposed) { stream.getTracks().forEach(t => t.stop()); return; }
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = async () => {
        clearInterval(timer);
        clearTimeout(limitTimer);
        btn.disabled = true;
        btn.classList.remove("live");
        btn.textContent = "●";
        stream.getTracks().forEach((t) => t.stop());
        const rawBlob = new Blob(chunks, { type: recorder.mimeType });
        document.querySelector("#status").textContent = a.deidentifyVoice
          ? "正在裝置內進行聲音去識別化…"
          : "正在安全儲存錄音…";
        try {
          const profile = a.deidentifyVoice
            ? VOICE_PROFILES[state.session.voiceProfile]
            : null;
          const processed = profile
            ? await transformRecording(rawBlob, profile)
            : rawBlob;
          const blob = await prepareRecording(processed);
          if (disposed) return;
          const result = await request(
            `/api/sessions/${state.session.sessionId}/sentences/${q.id}/attempts`,
            {
              method: "POST",
              headers: {
                "Content-Type": blob.type,
                ...(profile
                  ? {
                      "X-Transform-Profile": profile.id,
                      "X-Transform-Version": VOICE_TRANSFORM_VERSION,
                    }
                  : {}),
              },
              body: blob,
            },
          );
          state.lastAttempt = result.attempt;
          if (disposed) return;
          document.querySelector("#count").textContent =
            `已錄製 ${result.attempt}／${result.maxAttempts} 次｜剩餘 ${result.remaining} 次`;
          const u = URL.createObjectURL(blob);
          document.querySelector("#preview").innerHTML =
            `<audio controls src="${u}"></audio><div class="actions" style="justify-content:center"><button id="accept">採用這次錄音</button>${result.remaining ? '<button id="again" class="secondary">重新錄製</button>' : ""}</div>`;
          document.querySelector("#status").textContent = result.remaining
            ? `請播放確認${result.deidentified ? "去識別化後的聲音" : ""}，再選擇採用或重新錄製`
            : `已用完錄製次數，請播放確認${result.deidentified ? "去識別化後的聲音" : ""}後採用`;
          document.querySelector("#accept").onclick = accept;
          const again = document.querySelector("#again");
          if (again)
            again.onclick = () => {
              btn.disabled = false;
              URL.revokeObjectURL(u);
              document.querySelector("#preview").innerHTML = "";
              document.querySelector("#status").textContent = "可再次錄音";
            };
        } catch (e) {
          if (disposed) return;
          btn.disabled = false;
          document.querySelector("#msg").innerHTML = message(e.message, true);
          document.querySelector("#status").textContent = a.deidentifyVoice
            ? "處理或上傳失敗，原始錄音未上傳，本次不計次"
            : "上傳失敗，本次不計次，可重新嘗試";
        }
      };
      recorder.start();
      btn.disabled = false;
      startedAt = performance.now();
      const updateClock = () => {
        const seconds = Math.min(MAX_RECORDING_SECONDS, Math.floor((performance.now() - startedAt) / 1000));
        document.querySelector('#status').textContent = `錄音中 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} / 3:00，點擊停止`;
        if (seconds >= MAX_RECORDING_SECONDS && recorder.state === 'recording') recorder.stop();
      };
      timer = setInterval(updateClock, 200);
      limitTimer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, MAX_RECORDING_SECONDS * 1000);
      btn.classList.add("live");
      btn.textContent = "■";
      document.querySelector("#status").textContent = "錄音中，點擊停止";
    } catch (e) {
      btn.disabled = false;
      stream?.getTracks().forEach(t => t.stop());
      document.querySelector("#msg").innerHTML = message(
        "錄音啟動失敗，本次不計次：" + e.message,
        true,
      );
    }
  };
}
async function accept() {
  const q = state.assignment.sentences[state.index];
  try {
    await request(
      `/api/sessions/${state.session.sessionId}/sentences/${q.id}/accept`,
      { method: "POST" },
    );
    if (++state.index < state.assignment.sentences.length) practice();
    else complete();
  } catch (e) {
    document.querySelector("#msg").innerHTML = message(e.message, true);
  }
}
async function complete() {
  try {
    const r = await request(
      `/api/sessions/${state.session.sessionId}/complete`,
      { method: "POST" },
    );
    const identityLabel = r.name
      ? r.studentId
        ? `${r.name}（${r.studentId}）`
        : r.name
      : r.anonymousId;
    app.innerHTML = `<section class="panel" style="text-align:center"><div style="font-size:58px">✓</div><h2>作業已完成</h2><p>${esc(identityLabel)}<br>完成時間：${new Date(r.completedAt).toLocaleString("zh-TW")}</p><a class="btn" href="#home">回到首頁</a></section>`;
  } catch (e) {
    app.innerHTML = message(e.message, true);
  }
}
async function teacher() {
  cleanupTest();
  try {
    state.teacher = (await request("/api/auth/me")).teacher;
    teacherDashboard();
  } catch {
    teacherAuth();
  }
}
function teacherAuth(register = false) {
  app.innerHTML = `<section class="panel"><div class="eyebrow">TEACHER PORTAL</div><h2>${register ? "建立教師帳號" : "教師登入"}</h2><p>登入後可集中管理中文與英文課程作業。</p><form id="auth">${register ? '<label>教師姓名</label><input name="displayName" required autocomplete="name">' : ""}<label>Email</label><input name="email" type="email" required autocomplete="email"><label>密碼</label><input name="password" type="password" minlength="8" required autocomplete="${register ? "new-password" : "current-password"}"><div id="msg"></div><button>${register ? "註冊並進入工作台" : "登入"}</button></form><p><button id="switch" class="secondary">${register ? "已有帳號？登入" : "第一次使用？建立帳號"}</button></p></section>`;
  document.querySelector("#switch").onclick = () => teacherAuth(!register);
  document.querySelector("#auth").onsubmit = async (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.target));
    try {
      const result = await request(
        `/api/auth/${register ? "register" : "login"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        },
      );
      state.teacher = result.teacher;
      teacherDashboard();
    } catch (x) {
      document.querySelector("#msg").innerHTML = message(x.message, true);
    }
  };
}
async function teacherDashboard() {
  const admin = state.teacher?.role === "super_admin";
  app.innerHTML = `<section class="panel wide"><div class="row"><div><div class="eyebrow">${admin ? "SUPER ADMIN" : "TEACHER"}</div><h2>已發布作業</h2><small>${esc(state.teacher?.displayName)}｜${esc(state.teacher?.email)}</small></div><div class="actions" style="justify-content:flex-end">${admin ? '<button id="manageTeachers" class="secondary">教師管理</button><button id="trash" class="secondary">垃圾桶</button>' : ""}<button id="submissionTrash" class="secondary">提交垃圾桶</button><button id="createNew">＋ 建立新作業</button><button id="logout" class="secondary">登出</button></div></div><div class="toolbar filters"><input id="search" placeholder="搜尋作業名稱、說明或題目文字"><select id="language"><option value="">全部語言</option><option value="zh-TW">中文課</option><option value="en">英文課</option></select><select id="days"><option value="">全部時間</option><option value="3">3 日內</option><option value="7">7 日內</option><option value="15">15 日內</option><option value="30">30 日內</option></select><select id="status"><option value="">全部狀態</option><option value="upcoming">尚未發布</option><option value="ongoing">進行中</option><option value="ended">已結束</option></select><button id="find">搜尋</button></div>${admin ? '<div class="admin-batch"><button id="selectEnded" class="secondary">一鍵選取本頁已截止作業</button><button id="trashAll" class="danger">資料與音檔移至垃圾桶</button><button id="trashAudio" class="danger">僅音檔移至垃圾桶</button></div>' : ""}<div id="assignmentList"></div></section>`;
  document.querySelector("#submissionTrash").onclick = () => submissionTrash(app, request, esc, teacherDashboard);
  document.querySelector("#createNew").onclick = teacherCreate;
  document.querySelector("#logout").onclick = async () => {
    await request("/api/auth/logout", { method: "POST" });
    teacherAuth();
  };
  document.querySelector("#find").onclick = () => loadAssignments(1);
  if (admin) {
    document.querySelector("#manageTeachers").onclick = adminTeachers;
    document.querySelector("#trash").onclick = adminTrash;
    document.querySelector("#selectEnded").onclick = () =>
      document
        .querySelectorAll('.assignment-check[data-ended="true"]')
        .forEach((x) => (x.checked = true));
    document.querySelector("#trashAll").onclick = () =>
      moveSelectedToTrash("all");
    document.querySelector("#trashAudio").onclick = () =>
      moveSelectedToTrash("audio");
  }
  document.querySelector("#search").onkeydown = (e) => {
    if (e.key === "Enter") loadAssignments(1);
  };
  loadAssignments(1);
}
const statusLabel = (s) =>
  s === "upcoming" ? "尚未發布" : s === "ended" ? "已結束" : "進行中";
async function loadAssignments(page = 1) {
  const box = document.querySelector("#assignmentList"),
    q = document.querySelector("#search").value,
    language = document.querySelector("#language").value,
    days = document.querySelector("#days").value,
    status = document.querySelector("#status").value;
  try {
    const data = await request(
      `/api/teacher/assignments?q=${encodeURIComponent(q)}&language=${encodeURIComponent(language)}&days=${days}&status=${status}&page=${page}`,
    );
    box.innerHTML = `<div class="list">${data.assignments.map((a) => `<article class="item clickable" data-id="${a.id}">${state.teacher?.role === "super_admin" && a.status === "ended" ? `<input class="assignment-check" data-ended="true" data-assignment="${a.id}" type="checkbox" aria-label="選取 ${esc(a.title)}">` : ""}<div class="row"><div><span class="tag">${a.language === "en" ? "英文課" : "中文課"}</span> <span class="tag status-${a.status}">${statusLabel(a.status)}</span> <span class="tag">${a.identityMode === "name_only" ? "不匿名（姓名）" : a.identityMode === "anonymous" ? "匿名" : "不匿名（姓名、學號）"}</span> ${a.deidentifyVoice ? '<span class="tag">🔒 聲音去識別化</span>' : ""} <span class="tag">教師：${esc(a.teacherName)}</span><h3>${esc(a.title)}</h3></div><div style="text-align:right"><b>${a.submissions}</b> 份作答<br><span class="muted">${a.sentenceCount} 題</span></div></div><p>${esc(a.instructions || "無作業說明")}</p><p class="muted">開放：${a.startsAt ? new Date(a.startsAt).toLocaleString("zh-TW") : "立即"} ～ ${a.endsAt ? new Date(a.endsAt).toLocaleString("zh-TW") : "不限"}</p><span class="code" style="font-size:18px">${a.code}</span></article>`).join("") || '<div class="notice">找不到符合條件的作業。</div>'}</div><div class="pagination"><button id="prev" class="secondary" ${data.pagination.page <= 1 ? "disabled" : ""}>上一頁</button><span>第 ${data.pagination.page}／${data.pagination.pages} 頁｜共 ${data.pagination.total} 份</span><button id="next" class="secondary" ${data.pagination.page >= data.pagination.pages ? "disabled" : ""}>下一頁</button></div>`;
    box.querySelectorAll("[data-id]").forEach(
      (el) =>
        (el.onclick = (event) => {
          if (!event.target.matches("input")) teacherDetail(el.dataset.id);
        }),
    );
    box.querySelectorAll("article[data-id]").forEach((el) => {
      const button = document.createElement("button");
      button.className = "classroom-entry";
      button.textContent = "✦ 上課互動式演示";
      button.onclick = (event) => {
        event.stopPropagation();
        location.hash = `classroom/${encodeURIComponent(el.dataset.id)}`;
      };
      el.append(button);
    });
    document.querySelector("#prev").onclick = () =>
      loadAssignments(data.pagination.page - 1);
    document.querySelector("#next").onclick = () =>
      loadAssignments(data.pagination.page + 1);
  } catch (x) {
    if (x.message === "請先登入") return teacherAuth();
    box.innerHTML = message(x.message, true);
  }
}
async function moveSelectedToTrash(scope) {
  const assignmentIds = [
    ...document.querySelectorAll(".assignment-check:checked"),
  ].map((x) => x.dataset.assignment);
  if (!assignmentIds.length) return alert("請先選取已截止作業");
  const label = scope === "all" ? "全部作業資料與學生音檔" : "學生音檔";
  if (!confirm(`確定將選取作業的${label}移至垃圾桶？30 天後會永久刪除。`))
    return;
  try {
    await request("/api/admin/trash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentIds, scope }),
    });
    await loadAssignments(1);
  } catch (error) {
    alert(error.message);
  }
}
async function adminTeachers() {
  app.innerHTML = `<section class="panel wide"><button id="back" class="secondary">← 回已發布作業</button><div class="eyebrow" style="margin-top:24px">SUPER ADMIN</div><h2>教師帳號與邀請</h2><form id="invite"><div class="row"><div><label>受邀教師 Email</label><input name="email" type="email" required></div><div><label>啟用時間</label><input name="activeFrom" type="datetime-local"></div><div><label>停用時間</label><input name="activeUntil" type="datetime-local"></div></div><button>新增／更新邀請</button><span id="inviteMsg"></span></form><div id="teachers">載入中…</div></section>`;
  document.querySelector("#back").onclick = teacherDashboard;
  document.querySelector("#invite").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await request("/api/admin/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: f.get("email"),
          activeFrom: f.get("activeFrom")
            ? new Date(f.get("activeFrom")).toISOString()
            : null,
          activeUntil: f.get("activeUntil")
            ? new Date(f.get("activeUntil")).toISOString()
            : null,
        }),
      });
      e.target.reset();
      document.querySelector("#inviteMsg").textContent = " ✓ 邀請已建立";
      loadTeachers();
    } catch (x) {
      document.querySelector("#inviteMsg").textContent = " " + x.message;
    }
  };
  loadTeachers();
}
async function loadTeachers() {
  try {
    const data = await request("/api/admin/teachers"),
      box = document.querySelector("#teachers");
    box.innerHTML = `<h3>已建立帳號</h3><div class="list">${data.teachers.map((t) => `<div class="item"><div class="row"><div><b>${esc(t.displayName)}</b><br>${esc(t.email)} <span class="tag">${t.role === "super_admin" ? "最高管理員" : t.disabledAt ? "已停用" : "教師"}</span></div>${t.role === "teacher" ? `<button class="secondary edit-teacher" data-id="${t.id}">設定期限／停用</button>` : ""}</div><p class="muted">啟用：${t.activeFrom ? new Date(t.activeFrom).toLocaleString("zh-TW") : "立即"} ～ ${t.activeUntil ? new Date(t.activeUntil).toLocaleString("zh-TW") : "不限"}</p></div>`).join("")}</div><h3>尚未註冊的邀請</h3><div class="list">${data.invites.map((i) => `<div class="item"><b>${esc(i.email)}</b><p class="muted">啟用：${i.activeFrom ? new Date(i.activeFrom).toLocaleString("zh-TW") : "立即"} ～ ${i.activeUntil ? new Date(i.activeUntil).toLocaleString("zh-TW") : "不限"}</p></div>`).join("") || '<div class="notice">目前沒有待註冊邀請。</div>'}</div>`;
    box.querySelectorAll(".edit-teacher").forEach(
      (btn) =>
        (btn.onclick = () => {
          const t = data.teachers.find((x) => x.id === btn.dataset.id),
            activeFrom = prompt("啟用時間（ISO 或留空）", t.activeFrom || ""),
            activeUntil = prompt("停用時間（ISO 或留空）", t.activeUntil || "");
          if (activeFrom === null || activeUntil === null) return;
          const disabled = confirm(
            "按「確定」會立即停用；按「取消」會保持／恢復啟用。",
          );
          request(`/api/admin/teachers/${t.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              activeFrom: activeFrom || null,
              activeUntil: activeUntil || null,
              disabled,
            }),
          })
            .then(loadTeachers)
            .catch((e) => alert(e.message));
        }),
    );
  } catch (x) {
    document.querySelector("#teachers").innerHTML = message(x.message, true);
  }
}
async function adminTrash() {
  app.innerHTML = `<section class="panel wide"><button id="back" class="secondary">← 回已發布作業</button><div class="eyebrow" style="margin-top:24px">30-DAY TRASH</div><h2>垃圾桶</h2><p>到期後由 Cloudflare 排程永久清除 D1 資料與 R2 音檔。</p><div class="actions"><button id="emptyAssignments" class="danger">清空全部作業資料</button><button id="emptyAudio" class="danger">清空全部音檔</button></div><div id="trashList">載入中…</div></section>`;
  document.querySelector("#back").onclick = teacherDashboard;
  document.querySelector("#emptyAssignments").onclick = () =>
    purgeTrash("all", true);
  document.querySelector("#emptyAudio").onclick = () =>
    purgeTrash("audio", true);
  loadTrash();
}
async function loadTrash() {
  try {
    const d = await request("/api/admin/trash"),
      box = document.querySelector("#trashList");
    const group = (rows, scope) =>
      rows
        .map(
          (x) =>
            `<div class="item"><input class="trash-check" data-id="${x.id || x.assignment_id}" data-scope="${scope}" type="checkbox"> <b>${esc(x.title)}</b><p>${x.audio_count || 0} 個音檔｜預計永久刪除：${new Date(x.purge_after).toLocaleString("zh-TW")}</p><button class="secondary restore" data-id="${x.id || x.assignment_id}" data-scope="${scope}">還原</button> <button class="danger purge-one" data-id="${x.id || x.assignment_id}" data-scope="${scope}">立即永久刪除</button></div>`,
        )
        .join("");
    box.innerHTML = `<h3>完整作業資料</h3><div class="list">${group(d.assignments, "all") || '<div class="notice">無</div>'}</div><h3>僅音檔</h3><div class="list">${group(d.audio, "audio") || '<div class="notice">無</div>'}</div>`;
    box
      .querySelectorAll(".restore")
      .forEach(
        (b) =>
          (b.onclick = () =>
            trashAction("/api/admin/trash/restore", b.dataset.scope, [
              b.dataset.id,
            ])),
      );
    box
      .querySelectorAll(".purge-one")
      .forEach(
        (b) =>
          (b.onclick = () =>
            purgeTrash(b.dataset.scope, false, [b.dataset.id])),
      );
  } catch (e) {
    document.querySelector("#trashList").innerHTML = message(e.message, true);
  }
}
async function trashAction(url, scope, assignmentIds) {
  await request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope, assignmentIds }),
  });
  loadTrash();
}
async function purgeTrash(scope, all = false, assignmentIds = []) {
  if (!confirm("永久刪除後無法復原，確定繼續？")) return;
  try {
    await request("/api/admin/trash/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, all, assignmentIds }),
    });
    loadTrash();
  } catch (e) {
    alert(e.message);
  }
}
function teacherCreate() {
  app.innerHTML = `<section class="panel wide"><button id="back" class="secondary">← 回作業清單</button><div class="eyebrow" style="margin-top:24px">NEW ASSIGNMENT</div><h2>建立新作業</h2><form id="create"><fieldset class="identity-options"><legend>學生身分資料</legend><label class="check"><input name="identityMode" type="radio" value="name_only">不匿名作業（姓名）</label><small>只蒐集姓名，不要求學號。</small><label class="check"><input name="identityMode" type="radio" value="full" checked>不匿名作業（姓名、學號）</label><small>蒐集姓名與學號。</small><label class="check"><input name="identityMode" type="radio" value="anonymous">匿名作業（不蒐集姓名、學號）</label><small>姓名與學號皆不蒐集，改用匿名編號。</small></fieldset><label class="check"><input name="deidentifyVoice" type="checkbox">啟用聲音去識別化（原始錄音不會上傳，只保存裝置內轉換後的 WAV）</label><p class="muted">採用 PROFILE_A v2.0.1，用於降低聲音被辨識的風險，不保證完全匿名。</p><label>課程語言</label><select name="language" required><option value="zh-TW">中文課</option><option value="en">英文課</option></select><div class="row"><div><label>作業開始時間</label><input name="startsAt" type="datetime-local"></div><div><label>作業結束時間</label><input name="endsAt" type="datetime-local"></div></div><label>作業名稱</label><input name="title" required placeholder="例：第一課課文朗讀"><label>作業說明</label><textarea name="instructions" placeholder="請用自然的速度朗讀"></textarea><div class="row" style="align-items:center"><h3>練習題目</h3><button type="button" id="addQuestion" class="secondary">＋ 個別增加題目</button></div><div id="questions"></div><div id="msg"></div><button>建立並發布</button></form></section>`;
  document.querySelector("#back").onclick = teacherDashboard;
  let count = 0;
  const add = (text = "", support = "") => {
    count++;
    const el = document.createElement("div");
    el.className = "question-builder";
    el.innerHTML = `<div class="row"><b>題目 ${count}</b><button type="button" class="danger remove">移除</button></div><label>朗讀文字</label><input class="qtext" required value="${esc(text)}" placeholder="輸入中文或英文句子"><label>拼音／發音提示（選填）</label><input class="qpinyin" value="${esc(support)}" placeholder="例：Nǐ hǎo 或 pronunciation note"><label>本題錄製次數上限（1–10 次）</label><input class="qattempts" type="number" min="1" max="10" value="2" required>`;
    el.querySelector(".remove").onclick = () => {
      if (document.querySelectorAll(".question-builder").length > 1)
        el.remove();
    };
    document.querySelector("#questions").appendChild(el);
  };
  document.querySelector("#addQuestion").onclick = () => add();
  add();
  document.querySelector("#create").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      sentences = [...document.querySelectorAll(".question-builder")].map(
        (el) => ({
          text: el.querySelector(".qtext").value,
          pinyin: el.querySelector(".qpinyin").value,
          maxAttempts: Number(el.querySelector(".qattempts").value),
        }),
      );
    try {
      const a = await request("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: f.get("title"),
          instructions: f.get("instructions"),
          language: f.get("language"),
          startsAt: f.get("startsAt")
            ? new Date(f.get("startsAt")).toISOString()
            : null,
          endsAt: f.get("endsAt")
            ? new Date(f.get("endsAt")).toISOString()
            : null,
          identityMode: f.get("identityMode"),
          deidentifyVoice: f.get("deidentifyVoice") === "on",
          sentences,
        }),
      });
      created(a);
    } catch (x) {
      document.querySelector("#msg").innerHTML = message(x.message, true);
    }
  };
}
function toLocalInput(value) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
async function teacherDetail(id) {
  app.innerHTML = `<section class="panel wide"><button id="back" class="secondary">← 回作業清單</button><div id="detail">載入中…</div></section>`;
  document.querySelector("#back").onclick = teacherDashboard;
  try {
    const data = await request(`/api/teacher/assignments/${id}`),
      a = data.assignment,
      map = Object.fromEntries(a.sentences.map((s) => [s.id, s]));
    document.querySelector("#detail").innerHTML =
      `<div class="eyebrow" style="margin-top:24px">${a.language === "en" ? "ENGLISH" : "CHINESE"} COURSE｜教師：${esc(a.teacherName)}</div><h2>${esc(a.title)}</h2><div class="notice">課程代碼：<b>${a.code}</b>｜${a.sentences.length} 題${a.deidentifyVoice ? "｜🔒 聲音去識別化 " + esc(a.transformVersion) : ""}</div><form id="schedule"><label>作業名稱</label><input name="title" required value="${esc(a.title)}"><label>作業說明</label><textarea name="instructions">${esc(a.instructions || "")}</textarea><label>課程語言</label><select name="language"><option value="zh-TW" ${a.language === "zh-TW" ? "selected" : ""}>中文課</option><option value="en" ${a.language === "en" ? "selected" : ""}>英文課</option></select><label>學生身分資料模式</label><select name="identityMode" ${data.sessions.length ? "disabled" : ""}><option value="name_only" ${a.identityMode === "name_only" ? "selected" : ""}>不匿名作業（姓名）</option><option value="full" ${a.identityMode === "full" ? "selected" : ""}>不匿名作業（姓名、學號）</option><option value="anonymous" ${a.identityMode === "anonymous" ? "selected" : ""}>匿名作業（不蒐集姓名、學號）</option></select><label class="check"><input name="deidentifyVoice" type="checkbox" ${a.deidentifyVoice ? "checked" : ""} ${data.sessions.length ? "disabled" : ""}>啟用聲音去識別化${data.sessions.length ? "（已有學生作答，設定已鎖定）" : ""}</label><div class="row"><div><label>作業開始時間</label><input name="startsAt" type="datetime-local" value="${toLocalInput(a.startsAt)}"></div><div><label>作業結束時間</label><input name="endsAt" type="datetime-local" value="${toLocalInput(a.endsAt)}"></div></div><h3>題目${data.sessions.length ? "（已有學生作答，題目已鎖定）" : ""}</h3><div class="list">${a.sentences.map((s, i) => `<div class="item edit-question"><label>題目 ${i + 1}</label><input class="edit-text" value="${esc(s.text)}" ${data.sessions.length ? "disabled" : ""}><label>發音提示</label><input class="edit-pinyin" value="${esc(s.pinyin)}" ${data.sessions.length ? "disabled" : ""}><label>錄製次數</label><input class="edit-attempts" type="number" min="1" max="10" value="${s.maxAttempts}" ${data.sessions.length ? "disabled" : ""}></div>`).join("")}</div><button>儲存作業修改</button><span id="scheduleMsg"></span></form><h3 style="margin-top:28px">學生提交（${data.sessions.length}）</h3><div class="list">${submissionList(data.sessions, map, esc)}</div>`;
    const demoLink = document.createElement("a");
    demoLink.className = "btn classroom-entry";
    demoLink.href = `#classroom/${encodeURIComponent(id)}`;
    demoLink.textContent = "✦ 上課互動式演示";
    document.querySelector("#detail").prepend(demoLink);
    bindSubmissions(document.querySelector("#detail"), request, () => teacherDetail(id));
    document.querySelector("#schedule").onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        const result = await request(`/api/teacher/assignments/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: f.get("title"),
            instructions: f.get("instructions"),
            language: f.get("language"),
            deidentifyVoice: data.sessions.length
              ? a.deidentifyVoice
              : f.get("deidentifyVoice") === "on",
            identityMode: data.sessions.length
              ? a.identityMode
              : f.get("identityMode"),
            startsAt: f.get("startsAt")
              ? new Date(f.get("startsAt")).toISOString()
              : null,
            endsAt: f.get("endsAt")
              ? new Date(f.get("endsAt")).toISOString()
              : null,
            ...(data.sessions.length
              ? {}
              : {
                  sentences: [
                    ...document.querySelectorAll(".edit-question"),
                  ].map((el) => ({
                    text: el.querySelector(".edit-text").value,
                    pinyin: el.querySelector(".edit-pinyin").value,
                    maxAttempts: Number(
                      el.querySelector(".edit-attempts").value,
                    ),
                  })),
                }),
          }),
        });
        document.querySelector("#scheduleMsg").textContent =
          ` ✓ ${statusLabel(result.status)}`;
      } catch (error) {
        document.querySelector("#scheduleMsg").textContent =
          ` ${error.message}`;
      }
    };
  } catch (x) {
    document.querySelector("#detail").innerHTML = message(x.message, true);
  }
}
function created(a) {
  app.innerHTML = `<section class="panel" style="text-align:center"><div class="eyebrow">作業已建立｜${a.language === "en" ? "英文課" : "中文課"}</div><h2>${esc(a.title)}</h2><p>請將課程代碼提供給學生</p><div class="code">${a.code}</div><div class="notice">作業已加入「已發布作業」，並依開始與結束時間自動控制提交。</div><button id="dashboard">回已發布作業</button></section>`;
  document.querySelector("#dashboard").onclick = teacherDashboard;
}
let closeClassroom;
function route() {
  disposeRecording?.();
  closeClassroom?.();
  closeClassroom = null;
  const page = location.hash.slice(1) || "home";
  if (page === "classroom-preview" || page.startsWith("classroom/")) {
    closeClassroom = openClassroom(app, { preview: page === "classroom-preview", id: page.split("/")[1], request });
    return;
  }
  (({ home, student, teacher })[page] || home)();
}
window.addEventListener("hashchange", route);
window.addEventListener("beforeunload", cleanupTest);
route();
