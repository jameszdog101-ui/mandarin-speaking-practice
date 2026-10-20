const englishHeadings={zh:['英语','英語'],ja:['英語'],ko:['영어'],vi:['Tiếng Anh'],id:['bahasa Inggris','Bahasa Inggris'],ms:['Bahasa Inggeris'],th:['ภาษาอังกฤษ'],es:['Inglés','inglés'],fr:['Anglais','anglais']};
export function plainText(html) {
  return html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]*>/g,'').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
}
export function extractLocalDefinitions(html,locale) {
  const headings=[...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  const index=headings.findIndex(h=>(englishHeadings[locale] || []).some(label=>plainText(h[1]).includes(label)));
  if(index<0)return [];
  const section=html.slice(headings[index].index+headings[index][0].length,headings[index+1]?.index).split(/<h1\b/i)[0];
  const definitions=[...section.matchAll(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi)].flatMap(block=>[...block[1].matchAll(/<li\b[^>]*>([\s\S]*?)(?=<li\b|<\/li>|$)/gi)].map(item=>plainText(item[1].split(/<d[ld]\b/i)[0]))).filter(Boolean);
  if(!definitions.length && locale==='zh') definitions.push(...[...section.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(p=>plainText(p[1])).filter(p=>/[\u3400-\u9fff]/.test(p) && !p.includes('發音') && !p.includes('发音')));
  return [...new Set(definitions)].slice(0,3).map(s=>s.slice(0,500));
}
export async function localDefinitions(word,language) {
  const locale=language.startsWith('zh-')?'zh':language;
  if(!englishHeadings[locale])return null;
  const base=`https://${locale}.wiktionary.org`;
  const result=await fetch(`${base}/w/api.php?action=parse&page=${encodeURIComponent(word)}&prop=text&format=json&formatversion=2&disableeditsection=1${locale==='zh'?`&variant=${language.toLowerCase()}`:''}`,{headers:{'User-Agent':'LanguagePractice/1.0 (educational dictionary lookup)'},signal:AbortSignal.timeout(6000)});
  if(!result.ok)return null;
  const data=await result.json();
  const meanings=extractLocalDefinitions(data.parse?.text || '',locale);
  return meanings.length?{meanings,note:'詞典解釋；不同語言的收錄範圍可能不同。',source:'Wiktionary · CC BY-SA',sourceUrl:`${base}/wiki/${encodeURIComponent(word)}`}:null;
}
