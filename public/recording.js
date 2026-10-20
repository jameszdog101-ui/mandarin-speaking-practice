import { encodeWavMono } from './audio-dsp.js';

export const MAX_RECORDING_SECONDS = 180;

// A PCM container has an explicit sample count, unlike some MediaRecorder WebM files.
// 32 kHz mono PCM also keeps a three-minute recording below the upload limit.
export async function prepareRecording(blob, maximumSeconds = MAX_RECORDING_SECONDS) {
  const context = new (window.AudioContext || window.webkitAudioContext)();
  let decoded;
  try { decoded = await context.decodeAudioData(await blob.arrayBuffer()); }
  finally { await context.close(); }
  const frames = Math.min(Math.round(decoded.duration * 32000), maximumSeconds * 32000);
  if (!frames) throw new Error('錄音內容為空白');
  const offline = new OfflineAudioContext(1, frames, 32000);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return new Blob([encodeWavMono(rendered.getChannelData(0), 32000)], { type: 'audio/wav' });
}
