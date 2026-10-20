const cache = new Map();
let popup, selected, generation = 0;
export function stopSpeech() { window.speechSynthesis?.cancel(); }
export function closeWord() {
  generation++;
  popup?.remove(); popup = null;
  selected?.classList.remove('word-selected'); selected?.setAttribute('aria-expanded', 'false'); selected = null;
}
export function speak(text, language) {
  if (!window.speechSynthesis) { alert('此瀏覽器未提供朗讀功能'); return; }
  if (document.querySelector('.record.live')) return;
  stopSpeech();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language === 'en' ? 'en-US' : language;
  utterance.onerror = event => { if (!['interrupted', 'canceled'].includes(event.error)) alert('目前無法播放語音，請確認裝置的語音設定'); };
  window.speechSynthesis.speak(utterance);
}
async function showWord(button) {
  closeWord(); selected = button;
  const ticket = generation;
  button.classList.add('word-selected'); button.setAttribute('aria-expanded', 'true');
  popup = document.createElement('aside');
  popup.className = 'word-popup notranslate'; popup.setAttribute('translate', 'no'); popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', '單字解釋');
  const heading = document.createElement('strong'); heading.textContent = button.textContent;
  const play = document.createElement('button'); play.textContent = '▶ English'; play.onclick = () => speak(button.textContent, 'en');
  const close = document.createElement('button'); close.textContent = '×'; close.setAttribute('aria-label','關閉單字解釋'); close.onclick = () => { const target = selected; closeWord(); target?.focus(); };
  const content = document.createElement('div'); content.textContent = '讀取詞義…';
  popup.append(heading, play, close, content); document.body.append(popup);
  const rect = button.getBoundingClientRect();
  popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - popup.offsetWidth - 8))}px`;
  popup.style.top = `${Math.min(rect.bottom + 8, Math.max(8, innerHeight - 280))}px`;
  const language = localStorage.getItem('platformLanguage') || 'zh-TW';
  const key = `${button.textContent.toLowerCase()}:${language}`;
  try {
    let data = cache.get(key);
    if (!data) {
      const response = await fetch(`/api/dictionary?word=${encodeURIComponent(button.textContent)}&language=${encodeURIComponent(language)}`);
      data = await response.json(); if (!response.ok) throw new Error(data.error);
      cache.set(key, data);
    }
    if (ticket !== generation) return;
    content.replaceChildren();
    for (const meaning of data.meanings) { const p = document.createElement('p'); p.textContent = meaning; content.append(p); }
    const source = document.createElement('small'); source.textContent = data.note || 'Free Dictionary API · MyMemory（翻譯）'; content.append(source);
  } catch(e) { if (ticket === generation) content.textContent = e.message || '詞義暫時無法載入，請稍後重試'; }
}
export function enhanceQuestion(element, language = 'en') {
  if (!element || element.dataset.enhanced) return;
  element.dataset.enhanced = 'true'; element.classList.add('notranslate'); element.setAttribute('translate','no');
  const text = element.textContent;
  element.replaceChildren();
  const read = document.createElement('button'); read.className = 'question-read'; read.type = 'button'; read.textContent = '▶'; read.setAttribute('aria-label','朗讀題目'); read.onclick = () => { if (speechSynthesis.speaking) stopSpeech(); else speak(text, language); };
  element.append(read);
  for (const part of text.split(/([A-Za-z]+(?:['’-][A-Za-z]+)*)/)) {
    if (language === 'en' && /^[A-Za-z]/.test(part)) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'question-word'; button.textContent = part; button.setAttribute('aria-haspopup','dialog'); button.setAttribute('aria-expanded','false'); button.onclick = () => showWord(button); element.append(button);
    } else element.append(document.createTextNode(part));
  }
}
document.addEventListener('keydown', e => { if(e.key === 'Escape') closeWord(); });
document.addEventListener('pointerdown', e => { if(popup && !popup.contains(e.target) && !selected?.contains(e.target)) closeWord(); });
window.addEventListener('scroll', closeWord, true);
window.addEventListener('resize', closeWord);
