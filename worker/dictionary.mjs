const languages = new Set(['zh-TW','zh-CN','en','ja','ko','vi','id','ms','th','es','fr']);
export async function dictionary(req, url, response, fail) {
  if (url.pathname !== '/api/dictionary' || req.method !== 'GET') return null;
  const word = (url.searchParams.get('word') || '').toLowerCase();
  const language = url.searchParams.get('language') || 'zh-TW';
  if (!/^[a-z]+(?:['’-][a-z]+)*$/.test(word) || word.length > 60 || !languages.has(language)) return fail('查詢格式不正確');
  const key = new Request(`${url.origin}/api/dictionary?word=${encodeURIComponent(word)}&language=${language}`);
  const cached = await caches.default.match(key); if(cached) return cached;
  try {
    let meanings=[],source='Free Dictionary API',sourceUrl='https://dictionaryapi.dev/';
    try {
      const result = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, { signal: AbortSignal.timeout(5000) });
      if(result.ok) { const entries=await result.json(); meanings=entries[0].meanings.slice(0,3).map(m=>`${m.partOfSpeech}: ${m.definitions[0].definition}`); }
    } catch {}
    if(!meanings.length) {
      const result=await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`,{headers:{'User-Agent':'LanguagePractice/1.0 (educational dictionary lookup)'},signal:AbortSignal.timeout(8000)});
      if(!result.ok)return fail(result.status===404?'找不到這個單字的詞義，請嘗試原形字':'詞典服務暫時不可用',result.status===404?404:503);
      const entries=await result.json();
      const clean=text=>text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
      meanings=(entries.en || []).flatMap(entry=>entry.definitions.map(x=>({part:entry.partOfSpeech,text:clean(x.definition)}))).filter(x=>x.text).slice(0,3).map(x=>`${x.part}: ${x.text}`);
      source='Wiktionary · CC BY-SA';sourceUrl=`https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`;
    }
    if(!meanings.length)return fail('找不到英文詞義，請嘗試原形字',404);
    let note = '';
    if (language !== 'en') {
      for (let i=0;i<meanings.length;i++) {
        const translated = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(meanings[i].slice(0,300))}&langpair=en|${language}`, { signal: AbortSignal.timeout(8000) });
        const data = await translated.json();
        if (data.responseStatus === 200 && data.responseData?.translatedText) meanings[i] = data.responseData.translatedText;
        else note = '翻譯暫時不可用，部分詞義顯示英文。';
      }
    }
    const out = response({ meanings, note,source,sourceUrl }, 200, { 'cache-control': 'public, max-age=86400' });
    if (!note) await caches.default.put(key, out.clone());
    return out;
  } catch { return fail('詞義服務暫時無法連線，請稍後重試', 503); }
}
