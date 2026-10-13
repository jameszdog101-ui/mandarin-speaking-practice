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
  const a = state.assignment;
  app.innerHTML = `<section class="panel">${steps(2)}<div class="eyebrow">STEP 3</div><h2>${a.anonymous ? "匿名作業" : "學生資料"}</h2><p>${a.anonymous ? "本作業不蒐集姓名與學號，系統會產生匿名編號。" : "資料僅供教師辨識本次作答。"}</p><form id="identity">${a.anonymous ? "" : `<label>姓名</label><input name="name" required><label>學號</label><input name="studentId" required>`}<div id="msg"></div><button>閱讀作業說明</button></form></section>`;
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
  app.innerHTML = `<section class="panel">${steps(3)}<div class="eyebrow">STEP 4</div><h2>${esc(a.title)}</h2><p>${esc(a.instructions || "請依序朗讀每一個句子。")}</p><div class="notice">共 ${a.sentences.length} 題｜各題錄製上限：${a.sentences.map((q, i) => `${i + 1}：${q.maxAttempts} 次`).join("、")}<br>完成錄製就會消耗一次額度；採用並成功儲存後將進入下一題，無法返回修改。</div><button id="begin">開始正式錄音</button></section>`;
  document.querySelector("#begin").onclick = () => {
    state.index = 0;
    practice();
  };
}
async function practice() {
  const a = state.assignment,
    q = a.sentences[state.index];
  state.lastAttempt = null;
  app.innerHTML = `<section class="panel wide">${steps(4)}<div class="row" style="justify-content:space-between"><b>第 ${state.index + 1}／${a.sentences.length} 題</b><span id="count" class="counter">已錄製 0／${q.maxAttempts} 次｜剩餘 ${q.maxAttempts} 次</span></div><div class="sentence"><div class="han">${esc(q.text)}</div><div class="pin">${esc(q.pinyin)}</div><button id="record" class="record" aria-label="開始錄音">●</button><div id="status">點擊紅色按鈕開始錄音</div><div id="preview"></div><div id="msg"></div></div></section>`;
  let stream,
    recorder,
    chunks = [];
  document.querySelector("#record").onclick = async () => {
    const btn = document.querySelector("#record");
    if (recorder?.state === "recording") {
      recorder.stop();
      return;
    }
    try {
      stream = await getMic();
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = async () => {
        btn.classList.remove("live");
        btn.textContent = "●";
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType });
        document.querySelector("#status").textContent = "正在安全儲存錄音…";
        try {
          const result = await request(
            `/api/sessions/${state.session.sessionId}/sentences/${q.id}/attempts`,
            {
              method: "POST",
              headers: { "Content-Type": blob.type },
              body: blob,
            },
          );
          state.lastAttempt = result.attempt;
          document.querySelector("#count").textContent =
            `已錄製 ${result.attempt}／${result.maxAttempts} 次｜剩餘 ${result.remaining} 次`;
          const u = URL.createObjectURL(blob);
          document.querySelector("#preview").innerHTML =
            `<audio controls src="${u}"></audio><div class="actions" style="justify-content:center"><button id="accept">採用這次錄音</button>${result.remaining ? '<button id="again" class="secondary">重新錄製</button>' : ""}</div>`;
          document.querySelector("#status").textContent = result.remaining
            ? "請播放確認，再選擇採用或重新錄製"
            : "已用完錄製次數，請播放確認後採用";
          document.querySelector("#accept").onclick = accept;
          const again = document.querySelector("#again");
          if (again)
            again.onclick = () => {
              URL.revokeObjectURL(u);
              document.querySelector("#preview").innerHTML = "";
              document.querySelector("#status").textContent = "可再次錄音";
            };
        } catch (e) {
          document.querySelector("#msg").innerHTML = message(e.message, true);
          document.querySelector("#status").textContent =
            "上傳失敗，本次不計次，可重新嘗試";
        }
      };
      recorder.start();
      btn.classList.add("live");
      btn.textContent = "■";
      document.querySelector("#status").textContent = "錄音中，點擊停止";
    } catch (e) {
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
    app.innerHTML = `<section class="panel" style="text-align:center"><div style="font-size:58px">✓</div><h2>作業已完成</h2><p>${esc(r.name ? `${r.name}（${r.studentId}）` : r.anonymousId)}<br>完成時間：${new Date(r.completedAt).toLocaleString("zh-TW")}</p><a class="btn" href="#home">回到首頁</a></section>`;
  } catch (e) {
    app.innerHTML = message(e.message, true);
  }
}
async function teacher() {
  cleanupTest();
  try {
    await request("/api/auth/me");
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
      await request(`/api/auth/${register ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      teacherDashboard();
    } catch (x) {
      document.querySelector("#msg").innerHTML = message(x.message, true);
    }
  };
}
async function teacherDashboard() {
  app.innerHTML = `<section class="panel wide"><div class="row"><div><div class="eyebrow">TEACHER</div><h2>已發布作業</h2></div><div class="actions" style="justify-content:flex-end"><button id="createNew">＋ 建立新作業</button><button id="logout" class="secondary">登出</button></div></div><div class="toolbar filters"><input id="search" placeholder="搜尋作業名稱、說明或題目文字"><select id="language"><option value="">全部語言</option><option value="zh-TW">中文課</option><option value="en">英文課</option></select><select id="days"><option value="">全部時間</option><option value="3">3 日內</option><option value="7">7 日內</option><option value="15">15 日內</option><option value="30">30 日內</option></select><select id="status"><option value="">全部狀態</option><option value="upcoming">尚未發布</option><option value="ongoing">進行中</option><option value="ended">已結束</option></select><button id="find">搜尋</button></div><div id="assignmentList"></div></section>`;
  document.querySelector("#createNew").onclick = teacherCreate;
  document.querySelector("#logout").onclick = async () => {
    await request("/api/auth/logout", { method: "POST" });
    teacherAuth();
  };
  document.querySelector("#find").onclick = () => loadAssignments(1);
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
    box.innerHTML = `<div class="list">${data.assignments.map((a) => `<article class="item clickable" data-id="${a.id}"><div class="row"><div><span class="tag">${a.language === "en" ? "英文課" : "中文課"}</span> <span class="tag status-${a.status}">${statusLabel(a.status)}</span><h3>${esc(a.title)}</h3></div><div style="text-align:right"><b>${a.submissions}</b> 份作答<br><span class="muted">${a.sentenceCount} 題</span></div></div><p>${esc(a.instructions || "無作業說明")}</p><p class="muted">開放：${a.startsAt ? new Date(a.startsAt).toLocaleString("zh-TW") : "立即"} ～ ${a.endsAt ? new Date(a.endsAt).toLocaleString("zh-TW") : "不限"}</p><span class="code" style="font-size:18px">${a.code}</span></article>`).join("") || '<div class="notice">找不到符合條件的作業。</div>'}</div><div class="pagination"><button id="prev" class="secondary" ${data.pagination.page <= 1 ? "disabled" : ""}>上一頁</button><span>第 ${data.pagination.page}／${data.pagination.pages} 頁｜共 ${data.pagination.total} 份</span><button id="next" class="secondary" ${data.pagination.page >= data.pagination.pages ? "disabled" : ""}>下一頁</button></div>`;
    box
      .querySelectorAll("[data-id]")
      .forEach((el) => (el.onclick = () => teacherDetail(el.dataset.id)));
    document.querySelector("#prev").onclick = () => loadAssignments(data.pagination.page - 1);
    document.querySelector("#next").onclick = () => loadAssignments(data.pagination.page + 1);
  } catch (x) {
    if (x.message === "請先登入") return teacherAuth();
    box.innerHTML = message(x.message, true);
  }
}
function teacherCreate() {
  app.innerHTML = `<section class="panel wide"><button id="back" class="secondary">← 回作業清單</button><div class="eyebrow" style="margin-top:24px">NEW ASSIGNMENT</div><h2>建立新作業</h2><form id="create"><label>課程語言</label><select name="language" required><option value="zh-TW">中文課</option><option value="en">英文課</option></select><div class="row"><div><label>作業開始時間</label><input name="startsAt" type="datetime-local"></div><div><label>作業結束時間</label><input name="endsAt" type="datetime-local"></div></div><label>作業名稱</label><input name="title" required placeholder="例：第一課課文朗讀"><label>作業說明</label><textarea name="instructions" placeholder="請用自然的速度朗讀"></textarea><label class="check"><input name="anonymous" type="checkbox">匿名作業（不蒐集姓名、學號）</label><div class="row" style="align-items:center"><h3>練習題目</h3><button type="button" id="addQuestion" class="secondary">＋ 個別增加題目</button></div><div id="questions"></div><div id="msg"></div><button>建立並發布</button></form></section>`;
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
          anonymous: f.get("anonymous") === "on",
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
      `<div class="eyebrow" style="margin-top:24px">${a.language === "en" ? "ENGLISH" : "CHINESE"} COURSE</div><h2>${esc(a.title)}</h2><div class="notice">課程代碼：<b>${a.code}</b>｜${a.sentences.length} 題</div><p>${esc(a.instructions || "無作業說明")}</p><form id="schedule"><div class="row"><div><label>作業開始時間</label><input name="startsAt" type="datetime-local" value="${toLocalInput(a.startsAt)}"></div><div><label>作業結束時間</label><input name="endsAt" type="datetime-local" value="${toLocalInput(a.endsAt)}"></div></div><button>更新開放時間</button><span id="scheduleMsg"></span></form><h3>題目</h3><div class="list">${a.sentences.map((s, i) => `<div class="item"><b>${i + 1}. ${esc(s.text)}</b><br><span class="muted">${esc(s.pinyin)}｜本題最多 ${s.maxAttempts} 次</span></div>`).join("")}</div><h3 style="margin-top:28px">學生提交（${data.sessions.length}）</h3><div class="list">${data.sessions.map((s) => `<div class="item"><b>${esc(s.name ? `${s.name}｜${s.studentId}` : s.anonymousId)}</b><p>${s.completedAt ? "完成：" + new Date(s.completedAt).toLocaleString("zh-TW") : "作答中"}</p>${s.answers.map((x) => `<div><small>${esc(map[x.sentenceId]?.text || "")}</small>${x.audioUrl ? `<audio controls src="${esc(x.audioUrl)}"></audio>` : `<p>尚未提交｜已錄製 ${x.attempts} 次</p>`}</div>`).join("")}</div>`).join("") || '<div class="notice">尚無學生開始作答。</div>'}</div>`;
    document.querySelector("#schedule").onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        const result = await request(`/api/teacher/assignments/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startsAt: f.get("startsAt") ? new Date(f.get("startsAt")).toISOString() : null,
            endsAt: f.get("endsAt") ? new Date(f.get("endsAt")).toISOString() : null,
          }),
        });
        document.querySelector("#scheduleMsg").textContent = ` ✓ ${statusLabel(result.status)}`;
      } catch (error) {
        document.querySelector("#scheduleMsg").textContent = ` ${error.message}`;
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
function route() {
  const page = location.hash.slice(1) || "home";
  (({ home, student, teacher })[page] || home)();
}
window.addEventListener("hashchange", route);
window.addEventListener("beforeunload", cleanupTest);
route();
