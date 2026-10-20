import test from 'node:test';
import assert from 'node:assert/strict';
import { wavDuration, audioResponse } from '../worker/audio.mjs';
import { encodeWavMono } from '../public/audio-dsp.js';
test('WAV duration derives from samples and rejects forged byte rate', () => {
  const wav = encodeWavMono(new Float32Array(32000 * 10), 32000);
  assert.equal(wavDuration(wav), 10);
  new DataView(wav).setUint32(28, 10, true);
  assert.throws(() => wavDuration(wav));
  assert.throws(() => wavDuration(new ArrayBuffer(10)));
  assert.equal(wavDuration(encodeWavMono(new Float32Array(32000 * 180), 32000)), 180);
});
test('authenticated audio response supports bounded, suffix and invalid ranges', async () => {
  const bucket = { get: async (_key, opts) => ({ body: new Uint8Array(opts?.range?.length ?? 100) }) };
  const meta = { mime_type: 'audio/wav', byte_size: 100, r2_key: 'private' };
  const request = range => new Request('https://test/audio', { headers: { range } });
  const partial = await audioResponse(request('bytes=10-19'), bucket, meta);
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 10-19/100');
  assert.equal((await partial.arrayBuffer()).byteLength, 10);
  assert.equal((await audioResponse(request('bytes=-10'), bucket, meta)).headers.get('content-range'), 'bytes 90-99/100');
  assert.equal((await audioResponse(request('bytes=100-'), bucket, meta)).status, 416);
});
