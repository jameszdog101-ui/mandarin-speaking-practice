import { prepareRecording } from './recording.js';
import { stopSpeech } from './learning.js';
const field = (key,label,esc,value={}) => `<fieldset class="feedback-field" data-key="${esc(key)}"><legend ${key!=='overall'?'class="notranslate" translate="no"':''}>${esc(label)}</legend><label>文字評語（選填）<textarea class="feedback-text" maxlength="5000">${esc(value.text || '')}</textarea></label><label>${key==='overall'?'總分':'本題分數'}（選填，1–5 分）<input class="feedback-score" type="number" min="1" max="5" step="${key==='overall'?'0.01':'1'}" value="${value.score ?? ''}"></label><div class="feedback-recorder" data-audio="${esc(value.audioId || '')}"><button type="button" class="secondary record-feedback">錄製語音評語</button> <span class="record-status" role="status"></span><div class="feedback-audio">${value.audioId?`<audio controls preload="none" src="/api/teacher/feedback-audio/${esc(value.audioId)}"></audio>`:''}</div><button type="button" class="secondary remove-feedback-audio" ${value.audioId?'':'hidden'}>移除語音評語</button></div></fieldset>`;
let stopActive,activeRoot;
export function disposeFeedbackRecording(){stopActive?.();stopActive=null;activeRoot=null;}
new MutationObserver(()=>{if(activeRoot && !activeRoot.isConnected)disposeFeedbackRecording();}).observe(document.querySelector('#app'),{childList:true,subtree:true});
function recordControl(root,sessionId,request) {
  const button=root.querySelector('.record-feedback'), status=root.querySelector('.record-status');
  let recorder, stream, timer, timeout, canceled=false;
  const stop=()=>{clearInterval(timer);clearTimeout(timeout);if(recorder?.state==='recording')recorder.stop();};
  const dispose=()=>{canceled=true;stop();stream?.getTracks().forEach(t=>t.stop());};
  root.querySelector('.remove-feedback-audio').onclick=()=>{root.dataset.audio='';root.querySelector('.feedback-audio').replaceChildren();root.querySelector('.remove-feedback-audio').hidden=true;};
  button.onclick=async()=>{
    if(recorder?.state==='recording'){stop();return;}
    disposeFeedbackRecording(); stopActive=dispose; activeRoot=root; canceled=false; stopSpeech();
    button.disabled=true;
    try {
      stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(canceled || !root.isConnected){stream.getTracks().forEach(t=>t.stop());return;}
      const chunks=[];recorder=new MediaRecorder(stream);
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      recorder.onstop=async()=>{
        clearInterval(timer);clearTimeout(timeout);stream.getTracks().forEach(t=>t.stop());button.disabled=true;button.classList.remove('live');
        try{
          if(canceled || !root.isConnected)return;
          status.textContent='處理與上傳中…';
          const blob=await prepareRecording(new Blob(chunks,{type:recorder.mimeType}));
          if(canceled || !root.isConnected)return;
          const data=await request(`/api/teacher/feedback/${sessionId}/audio`,{method:'POST',headers:{'Content-Type':'audio/wav'},body:blob});
          if(canceled || !root.isConnected)return;
          root.dataset.audio=data.audioId;
          const audio=document.createElement('audio');audio.controls=true;audio.src=`/api/teacher/feedback-audio/${data.audioId}`;root.querySelector('.feedback-audio').replaceChildren(audio);
          root.querySelector('.remove-feedback-audio').hidden=false;status.textContent='已錄製，請儲存草稿或發布';
        }catch(e){status.textContent=e.message;}
        finally{button.disabled=false;button.textContent='重新錄製語音評語';}
      };
      recorder.start();button.classList.add('live');button.disabled=false;button.textContent='停止錄音';const start=performance.now();
      timer=setInterval(()=>{const seconds=Math.min(180,Math.floor((performance.now()-start)/1000));status.textContent=`${seconds} / 180 秒`;if(seconds>=180)stop();},200);
      timeout=setTimeout(stop,180000);
    }catch(e){stream?.getTracks().forEach(t=>t.stop());status.textContent=e.message;button.disabled=false;}
  };
}
export function bindFeedback(root,sessions,questions,request,esc) {
  root.querySelectorAll('.feedback-slot').forEach(slot=>{
    const details=slot.closest('details');
    details.addEventListener('toggle',async()=>{
      if(!details.open){disposeFeedbackRecording();return;}
      if(slot.dataset.loaded)return;
      slot.dataset.loaded='true';slot.textContent='讀取批改…';
      try {
        const sessionId=slot.dataset.session;
        const result=await request(`/api/teacher/feedback/${sessionId}`);let version=result.version;
        const draft=result.draft;
        slot.innerHTML=`<h3>教師批改</h3><p>文字、錄音與分數皆可留空。草稿不會顯示給學生。</p><form class="feedback-form">${Object.entries(questions).map(([id,q],i)=>field(id,`第 ${i+1} 題：${q.text}`,esc,draft.questions?.[id])).join('')}<p class="average-hint"></p><button type="button" class="secondary adopt-average">採用平均建議為總分</button>${field('overall','整份作業總評',esc,draft.overall)}<label>總分方式<select class="score-mode"><option value="direct">直接給總分</option><option value="average">採用平均建議</option></select></label><div class="actions"><button type="submit">儲存草稿</button><button type="button" class="publish-feedback">儲存並發布</button></div><p class="feedback-message" role="status">${result.publishedAt?'上次發布：'+new Date(result.publishedAt).toLocaleString('zh-TW'):'尚未發布'}</p></form>`;
        const form=slot.querySelector('form'),mode=form.querySelector('.score-mode'),msg=form.querySelector('.feedback-message');mode.value=draft.scoreMode || 'direct';
        form.querySelectorAll('.feedback-recorder').forEach(el=>recordControl(el,sessionId,request));
        const fields=[...form.querySelectorAll('.feedback-field')];
        const average=()=>{const scores=fields.filter(f=>f.dataset.key!=='overall').map(f=>f.querySelector('.feedback-score').value).filter(v=>v!=='').map(Number);const avg=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length*100)/100:null;form.querySelector('.average-hint').textContent=`已評 ${scores.length}／${fields.length-1} 題｜平均建議：${avg===null?'尚無':avg.toFixed(2)+' / 5'}`;return avg;};
        form.addEventListener('input',average);average();
        form.querySelector('.adopt-average').onclick=()=>{const avg=average();if(avg!==null){form.querySelector('[data-key=overall] .feedback-score').value=avg;mode.value='average';}};
        const save=async publish=>{
          if(!form.reportValidity())return;
          if(form.querySelector('.record-feedback:disabled') || [...form.querySelectorAll('.record-feedback')].some(b=>b.textContent==='停止錄音')) {msg.textContent='請先停止錄音並等待上傳完成';return;}
          const data={questions:{},scoreMode:mode.value};
          fields.forEach(f=>{const entry={text:f.querySelector('textarea').value,score:f.querySelector('.feedback-score').value,audioId:f.querySelector('.feedback-recorder').dataset.audio || null};if(f.dataset.key==='overall')data.overall=entry;else data.questions[f.dataset.key]=entry;});
          form.querySelectorAll('button').forEach(b=>b.disabled=true);
          try{const saved=await request(`/api/teacher/feedback/${sessionId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({version,data})});version=saved.version;if(publish){const published=await request(`/api/teacher/feedback/${sessionId}/publish`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version})});version=published.version;}msg.textContent=publish?'已發布，學生可查看回饋':'草稿已儲存，學生尚不可見';}catch(e){msg.textContent=e.message;}finally{form.querySelectorAll('button').forEach(b=>b.disabled=false);}
        };
        form.onsubmit=e=>{e.preventDefault();save(false);};form.querySelector('.publish-feedback').onclick=()=>save(true);
      }catch(e){slot.textContent=e.message;delete slot.dataset.loaded;}
    });
  });
}
