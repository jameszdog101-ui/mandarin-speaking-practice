const TAU = Math.PI * 2;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const rms = (samples) => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / Math.max(1, samples.length));

function resample(samples, ratio) {
  const out = new Float32Array(Math.max(1, Math.round(samples.length / ratio)));
  for (let i = 0; i < out.length; i += 1) {
    const p = i * ratio, left = Math.min(samples.length - 1, Math.floor(p)), right = Math.min(samples.length - 1, left + 1);
    out[i] = samples[left] * (1 - (p - left)) + samples[right] * (p - left);
  }
  return out;
}

function stretch(samples, ratio, targetLength, frameSize, analysisHop) {
  const synthesisHop = Math.max(1, Math.round(analysisHop * ratio)), mixed = new Float32Array(targetLength + frameSize), weights = new Float32Array(mixed.length);
  for (let input = 0, output = 0; input < samples.length && output < targetLength; input += analysisHop, output += synthesisHop) {
    for (let f = 0; f < frameSize; f += 1) {
      const weight = 0.5 - 0.5 * Math.cos(TAU * f / (frameSize - 1)), out = output + f;
      if (out >= mixed.length) break;
      mixed[out] += (samples[input + f] || 0) * weight; weights[out] += weight;
    }
  }
  return Float32Array.from({ length: targetLength }, (_, i) => weights[i] > 1e-5 ? mixed[i] / weights[i] : 0);
}

function biquad(samples, rate, type, frequency, q = 0.707, gainDb = 0) {
  const omega = TAU * clamp(frequency, 20, rate * 0.45) / rate, cosine = Math.cos(omega), alpha = Math.sin(omega) / (2 * q), amplitude = 10 ** (gainDb / 40);
  let b0, b1, b2, a0, a1 = -2 * cosine, a2 = 1 - alpha;
  if (type === "highpass") { b0 = (1 + cosine) / 2; b1 = -(1 + cosine); b2 = b0; a0 = 1 + alpha; }
  else if (type === "lowpass") { b0 = (1 - cosine) / 2; b1 = 1 - cosine; b2 = b0; a0 = 1 + alpha; }
  else { b0 = 1 + alpha * amplitude; b1 = -2 * cosine; b2 = 1 - alpha * amplitude; a0 = 1 + alpha / amplitude; a2 = 1 - alpha / amplitude; }
  [b0, b1, b2, a1, a2] = [b0, b1, b2, a1, a2].map(v => v / a0);
  const out = new Float32Array(samples.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i += 1) { const x0 = samples[i], y0 = b0*x0+b1*x1+b2*x2-a1*y1-a2*y2; out[i]=y0; x2=x1; x1=x0; y2=y1; y1=y0; }
  return out;
}

export function transformSamples(samples, sampleRate, profile) {
  if (!(samples instanceof Float32Array) || samples.length < sampleRate * 0.2) throw new Error("錄音時間太短。");
  const ratio = 2 ** (profile.pitchSemitones / 12);
  let output = stretch(resample(samples, ratio), ratio, samples.length, profile.frameSize, profile.analysisHop);
  for (const center of profile.formantCentersHz) { output = biquad(output, sampleRate, "peaking", center, 1.2, -4.5); output = biquad(output, sampleRate, "peaking", center * profile.formantScale, 1, 5.5); }
  output = biquad(biquad(output, sampleRate, "highpass", profile.highpassHz), sampleRate, "lowpass", profile.lowpassHz);
  const level = rms(output); if (level < 0.0005) throw new Error("錄音無聲或音量太小。");
  const gain = clamp(profile.targetRms / level, 0.35, 8), divisor = Math.tanh(1.35);
  output = Float32Array.from(output, value => Math.tanh(value * gain * 1.35) / divisor * 0.9);
  const difference = Math.sqrt(output.reduce((sum, value, i) => sum + (value - samples[i]) ** 2, 0) / Math.max(samples.reduce((sum, value) => sum + value ** 2, 0), 1e-9));
  if (difference < 0.12 || output.some(value => !Number.isFinite(value))) throw new Error("聲音轉換強度檢查失敗。");
  return output;
}

export function encodeWavMono(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer), ascii = (at, text) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0,"RIFF"); view.setUint32(4,36+samples.length*2,true); ascii(8,"WAVE"); ascii(12,"fmt "); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true); ascii(36,"data"); view.setUint32(40,samples.length*2,true);
  samples.forEach((value,i)=>{const sample=clamp(value,-1,1);view.setInt16(44+i*2,sample<0?sample*0x8000:sample*0x7fff,true);}); return buffer;
}
