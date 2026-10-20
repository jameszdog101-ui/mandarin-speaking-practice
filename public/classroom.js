import { playableSource } from './playback.js';
import { enhanceQuestion } from './learning.js';
const escape = (value = "") => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function sampleData() {
  const sentences = [
    { id: 'q1', text: '今天的天氣很好，我們一起去散步吧。', pinyin: 'Jīntiān de tiānqì hěn hǎo, wǒmen yìqǐ qù sànbù ba.' },
    { id: 'q2', text: '如果明天下雨，我想在家看一本書。', pinyin: 'Rúguǒ míngtiān xiàyǔ, wǒ xiǎng zài jiā kàn yì běn shū.' },
    { id: 'q3', text: '旅行最美好的部分，是遇見不同的人。', pinyin: 'Lǚxíng zuì měihǎo de bùfen, shì yùjiàn bùtóng de rén.' },
  ];
  return { assignment: { title: '日常對話・把生活說成故事', sentences }, sessions: ['林小晴','陳宇安','王品涵','李沐辰','張語恩','黃以樂','吳昀庭','許念慈'].map((name, i) => ({ id: `demo-${i}`, name, completedAt: true, answers: sentences.map(q => ({ sentenceId: q.id, audioUrl: 'demo' })) })) };
}

export function openClassroom(app, { preview, id, request }) {
  let disposed = false, index = 0, data, observer, active, timer, z = 1, playback = 0;
  const positions = new Map(), events = new AbortController();
  const audio = new Audio();
  let source;
  document.body.classList.add('classroom-mode');
  app.innerHTML = '<div class="classroom-loading">正在準備課堂演示…</div>';
  function stop() {
    playback++;
    audio.pause(); audio.removeAttribute('src'); audio.load();
    source?.release(); source = null;
    clearInterval(timer);
    if (active) { active.classList.remove('playing'); active.querySelector('.play').textContent = '▶'; }
    active = null;
  }
  function draw() {
    stop(); observer?.disconnect();
    const q = data.assignment.sentences[index];
    const rows = data.sessions.filter(s => s.answers.some(a => a.sentenceId === q?.id && a.audioUrl));
    app.innerHTML = `<section class="classroom"><div class="classroom-top"><a href="#teacher" class="classroom-back">← 教師工作台</a><span class="live-label"><i></i> CLASSROOM LIVE</span><span>${preview ? '示意模式 · 虛構學生資料' : '上課互動式演示'}</span></div><div class="classroom-heading"><div><div class="eyebrow">LISTEN. MOVE. DISCOVER.</div><h1>${escape(data.assignment.title)}</h1><p>讓每個聲音，都有被聽見的位置。</p></div><div class="classroom-tools"><button class="secondary" id="resetBoard">↺ 重新排列</button><button class="secondary" id="fullscreen">⛶ 全螢幕</button></div></div><div class="question-panel"><span class="question-number">${String(index + 1).padStart(2, '0')}</span><div><span class="question-caption">本題朗讀 · ${rows.length} 份錄音</span><h2>${escape(q?.text || '尚無題目')}</h2><p>${escape(q?.pinyin || '')}</p></div><span class="question-mark">“</span></div><div class="stage-label"><span>✦ 聲音舞台 <small>拖曳卡片，自由安排你的課堂</small></span><span>${preview ? '播放為進度模擬，無學生音訊' : data.assignment.deidentifyVoice ? '播放聲音去識別化錄音' : '點擊 ▶ 聆聽'}</span></div><div class="voice-stage" aria-label="可拖曳的學生錄音舞台"></div><div class="classroom-bottom"><span>◉ 位置僅保留於本次演示</span><div class="question-nav"><button id="questionPrev" class="secondary" ${index === 0 ? 'disabled' : ''}>← 上一題</button><span>${index + 1} <small>/ ${data.assignment.sentences.length}</small></span><button id="questionNext" ${index >= data.assignment.sentences.length - 1 ? 'disabled' : ''}>下一題 →</button></div><span>← → 切換題目</span></div></section>`;
    enhanceQuestion(app.querySelector('.question-panel h2'), data.assignment.language || 'zh-TW');
    app.querySelector('.question-panel p').classList.add('notranslate');
    app.querySelector('.question-panel p').setAttribute('translate', 'no');
    const stage = app.querySelector('.voice-stage');
    stage.style.height = `${Math.max(490, Math.ceil(rows.length / Math.max(1, Math.floor(stage.clientWidth / 265))) * 235 + 45)}px`;
    if (!rows.length) stage.innerHTML = '<div class="stage-empty">還沒有可播放的錄音<p>學生採用本題錄音後，就會出現在這裡。</p></div>';
    if (!positions.has(q?.id)) positions.set(q?.id, new Map());
    const layout = positions.get(q?.id);
    rows.forEach((s, i) => {
      const card = document.createElement('article');
      card.className = `voice-card tone-${i % 4}`;
      card.style.setProperty('--delay', `${-i * .7}s`);
      card.innerHTML = `<div class="voice-card-inner"><div class="voice-card-top"><span class="avatar">${escape((s.name || s.anonymousId || '?').slice(-2))}</span><div><b>${escape(s.name || s.anonymousId)}</b><small>${escape(s.studentId || (s.completedAt ? '已完成作答' : '作答中'))}</small></div><button class="drag-handle" aria-label="拖曳或使用方向鍵移動 ${escape(s.name || s.anonymousId)}">⠿</button></div><div class="voice-player"><button class="play" aria-label="播放 ${escape(s.name || s.anonymousId)} 的錄音">▶</button><div class="voice-wave" aria-hidden="true">${Array.from({length:24}, (_, j) => `<i style="height:${10 + ((j * 13 + i * 7) % 29)}px"></i>`).join('')}</div><span class="voice-time">${preview ? '0:08' : '錄音'}</span></div><div class="voice-status" aria-live="polite">${preview ? '示意錄音' : '已採用錄音'} <span>↗ 拖曳排列</span></div></div>`;
      stage.append(card);
      card.playhead = 0;
      card.duration = preview ? 8 : 0;
      const seekBox = document.createElement('div');
      seekBox.className = 'voice-seek';
      seekBox.innerHTML = `<input type="range" min="0" max="${preview ? 8 : 0}" step="0.1" value="0" aria-label="${escape(s.name || s.anonymousId)} 的播放進度" ${preview ? '' : 'disabled'}><div><span class="seek-position">0:00</span><span class="seek-duration">${preview ? '0:08' : '播放後可拖拉進度'}</span></div>`;
      card.querySelector('.voice-status').before(seekBox);
      const seek = seekBox.querySelector('input');
      const formatTime = value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
      card.updateProgress = () => {
        seek.max = card.duration;
        seek.disabled = !(card.duration > 0);
        seek.value = card.playhead;
        seek.style.setProperty('--progress', `${card.duration ? card.playhead / card.duration * 100 : 0}%`);
        seek.setAttribute('aria-valuetext', `${formatTime(card.playhead)} / ${formatTime(card.duration)}`);
        seekBox.querySelector('.seek-position').textContent = formatTime(card.playhead);
        seekBox.querySelector('.seek-duration').textContent = card.duration ? formatTime(card.duration) : '播放後可拖拉進度';
        card.querySelector('.voice-time').textContent = formatTime(card.playhead);
      };
      seek.oninput = () => {
        card.playhead = Number(seek.value);
        if (!preview && active === card && audio.readyState >= 1) audio.currentTime = card.playhead;
        card.updateProgress();
      };
      const columns = Math.max(1, Math.floor(stage.clientWidth / 265));
      if (!layout.has(s.id)) layout.set(s.id, { x: 20 + (i % columns) * ((stage.clientWidth - 35) / columns) + (i % 2) * 6, y: 24 + Math.floor(i / columns) * 235 + (i % 3) * 7 });
      const place = () => {
        const p = layout.get(s.id);
        p.x = Math.max(0, Math.min(p.x, stage.clientWidth - card.offsetWidth));
        p.y = Math.max(0, Math.min(p.y, stage.clientHeight - card.offsetHeight - 8));
        card.style.left = `${p.x}px`; card.style.top = `${p.y}px`;
      };
      card.place = place; place();
      const handle = card.querySelector('.drag-handle');
      let drag;
      card.onpointerdown = e => {
        if (e.target.closest('.play, .voice-seek') || e.button !== 0) return;
        drag = { x: e.clientX, y: e.clientY, ...{ start: {...layout.get(s.id)} } };
        card.setPointerCapture(e.pointerId); card.classList.add('dragging'); card.style.zIndex = ++z;
      };
      card.onpointermove = e => { if (!drag) return; layout.set(s.id, {x: drag.start.x + e.clientX - drag.x, y: drag.start.y + e.clientY - drag.y}); place(); };
      card.onpointerup = card.onpointercancel = card.onlostpointercapture = () => { drag = null; card.classList.remove('dragging'); };
      handle.onkeydown = e => {
        if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation(); const p = layout.get(s.id);
        p.x += e.key === 'ArrowLeft' ? -15 : e.key === 'ArrowRight' ? 15 : 0;
        p.y += e.key === 'ArrowUp' ? -15 : e.key === 'ArrowDown' ? 15 : 0; place();
      };
      card.querySelector('.play').onclick = async () => {
        if (active === card) { stop(); return; }
        stop(); const attempt = playback; active = card; card.classList.add('playing'); card.querySelector('.play').textContent = 'Ⅱ';
        if (card.duration && card.playhead >= card.duration) card.playhead = 0;
        card.updateProgress();
        if (preview) {
          timer = setInterval(() => { card.playhead = Math.min(card.duration, card.playhead + .1); card.updateProgress(); if (card.playhead >= card.duration) stop(); }, 100);
        } else {
          try {
            const loaded = await playableSource(s.answers.find(a => a.sentenceId === q.id).audioUrl);
            if (active !== card || playback !== attempt) { loaded.release(); return; }
            source = loaded; audio.src = loaded.url; await audio.play();
          } catch { if (active === card && playback === attempt) { stop(); card.querySelector('.voice-status').textContent = '無法播放，請重試或重新登入'; } }
        }
      };
    });
    observer = new ResizeObserver(() => stage.querySelectorAll('.voice-card').forEach(c => c.place())); observer.observe(stage);
    app.querySelector('#resetBoard').onclick = () => { positions.delete(q?.id); draw(); };
    app.querySelector('#questionPrev').onclick = () => change(-1);
    app.querySelector('#questionNext').onclick = () => change(1);
    app.querySelector('#fullscreen').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await app.requestFullscreen(); } catch { app.querySelector('#fullscreen').textContent = '瀏覽器不支援全螢幕'; } };
  }
  function change(delta) { if (data && index + delta >= 0 && index + delta < data.assignment.sentences.length) { index += delta; draw(); } }
  audio.onended = stop;
  audio.onerror = () => { if (active) { const card = active; stop(); card.querySelector('.voice-status').textContent = '音檔無法載入，請重試或重新登入'; } };
  audio.onloadedmetadata = () => {
    if (!active) return;
    if (Number.isFinite(audio.duration) && audio.duration > 0) active.duration = audio.duration;
    if (active.playhead > 0) audio.currentTime = active.playhead;
    active.updateProgress();
  };
  audio.ondurationchange = () => {
    if (active && Number.isFinite(audio.duration) && audio.duration > 0) { active.duration = audio.duration; active.updateProgress(); }
  };
  audio.ontimeupdate = () => { if (active && Number.isFinite(audio.currentTime)) { active.playhead = audio.currentTime; active.updateProgress(); } };
  window.addEventListener('keydown', e => { if (e.target.closest('button,input,select,textarea')) return; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); change(e.key === 'ArrowLeft' ? -1 : 1); } }, {signal: events.signal});
  (async () => { try { data = preview ? sampleData() : await request(`/api/teacher/assignments/${id}`); if (!disposed) draw(); } catch (e) { if (!disposed) app.innerHTML = `<section class="panel"><h2>無法開啟演示</h2><p>${escape(e.message)}</p><a class="btn" href="#teacher">返回教師工作台</a></section>`; } })();
  return () => { disposed = true; stop(); observer?.disconnect(); events.abort(); document.body.classList.remove('classroom-mode'); if (document.fullscreenElement === app) document.exitFullscreen().catch(() => {}); };
}
