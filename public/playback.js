import { prepareRecording } from './recording.js';
// Legacy MediaRecorder containers may omit duration/cues. Repair only in browser;
// preserve the original object and the full length of historical recordings.
export async function playableSource(url) {
  if(!url.startsWith('/api/')) return {url,release(){}};
  const probe=await fetch(url,{headers:{Range:'bytes=0-0'}});
  if(!probe.ok)throw Error('音檔無法讀取，請重新登入');
  const type=probe.headers.get('content-type') || '';
  await probe.body?.cancel();
  if(type.startsWith('audio/wav'))return {url,release(){}};
  const response=await fetch(url);if(!response.ok)throw Error('音檔無法讀取');
  const wav=await prepareRecording(await response.blob(),Infinity);
  const local=URL.createObjectURL(wav);
  return {url:local,release(){URL.revokeObjectURL(local);}};
}
const sources=new Map();
export function installPlayback() {
  document.addEventListener('play',async event=>{
    const audio=event.target;
    if(!(audio instanceof HTMLAudioElement) || audio.dataset.playbackReady || !audio.getAttribute('src')?.startsWith('/api/'))return;
    audio.pause();audio.dataset.playbackReady='loading';
    try{
      const source=await playableSource(audio.getAttribute('src'));
      if(!audio.isConnected || (audio.closest('details') && !audio.closest('details').open)){source.release();delete audio.dataset.playbackReady;return;}
      sources.set(audio,source);audio.src=source.url;audio.dataset.playbackReady='true';await audio.play();
    }catch(error){delete audio.dataset.playbackReady;const notice=document.createElement('p');notice.textContent=error.message;audio.after(notice);}
  },true);
  new MutationObserver(()=>{for(const [audio,source]of sources)if(!audio.isConnected){audio.pause();source.release();sources.delete(audio);}}).observe(document.querySelector('#app'),{childList:true,subtree:true});
}
