import { encodeWavMono, transformSamples } from "./audio-dsp.js";
self.onmessage = ({ data }) => {
  try {
    const samples = new Float32Array(data.samplesBuffer);
    const wavBuffer = encodeWavMono(transformSamples(samples, data.sampleRate, data.profile), data.sampleRate);
    self.postMessage({ ok: true, wavBuffer }, [wavBuffer]);
  } catch (error) { self.postMessage({ ok: false, error: error?.message || "聲音轉換失敗。" }); }
};
