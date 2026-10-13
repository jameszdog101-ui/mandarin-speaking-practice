function downmixToMono(audioBuffer) {
  const mono = new Float32Array(audioBuffer.length);
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) mono[i] += data[i] / audioBuffer.numberOfChannels;
  }
  return mono;
}

export async function transformRecording(rawBlob, profile) {
  if (!(rawBlob instanceof Blob) || !rawBlob.size) throw new Error("錄音內容為空白，請重新錄製。");
  if (!profile || profile.version !== "2.0.1") throw new Error("聲音轉換設定版本不正確。");
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass || !window.Worker) throw new Error("此瀏覽器不支援裝置內聲音處理。");
  const context = new AudioContextClass();
  let decoded;
  try { decoded = await context.decodeAudioData(await rawBlob.arrayBuffer()); }
  catch { throw new Error("無法解碼錄音，請重新錄製。"); }
  finally { await context.close(); }
  const samples = downmixToMono(decoded);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./audio-transform-worker.js", import.meta.url), { type: "module" });
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error("聲音轉換逾時，請縮短錄音後重試。")); }, 45000);
    worker.onmessage = ({ data }) => { clearTimeout(timeout); worker.terminate(); data?.ok ? resolve(new Blob([data.wavBuffer], { type: "audio/wav" })) : reject(new Error(data?.error || "聲音轉換失敗。")); };
    worker.onerror = () => { clearTimeout(timeout); worker.terminate(); reject(new Error("聲音轉換程序無法啟動。")); };
    worker.postMessage({ samplesBuffer: samples.buffer, sampleRate: decoded.sampleRate, profile }, [samples.buffer]);
  });
}
