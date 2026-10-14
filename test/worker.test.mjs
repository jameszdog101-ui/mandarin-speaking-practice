import test from "node:test";
import assert from "node:assert/strict";
import { validMaxAttempts, publicAssignment } from "../worker/index.mjs";
import { transformSamples, encodeWavMono } from "../public/audio-dsp.js";
import { VOICE_PROFILES } from "../public/voice-profiles.js";

test("Cloudflare Worker validates attempt limits", () => {
  assert.equal(validMaxAttempts(1), true);
  assert.equal(validMaxAttempts(10), true);
  assert.equal(validMaxAttempts(0), false);
  assert.equal(validMaxAttempts(11), false);
  assert.equal(validMaxAttempts(2.5), false);
});
test("public assignment never exposes admin hash", () => {
  const result = publicAssignment(
    {
      id: "a",
      code: "ABC123",
      title: "T",
      instructions: "",
      anonymous: 1,
      max_attempts: 2,
      admin_key_hash: "secret",
    },
    [{ id: "q", text: "你好", pinyin: "Nǐ hǎo", max_attempts: 6 }],
  );
  assert.equal(result.admin_key_hash, undefined);
  assert.equal(result.anonymous, true);
  assert.equal(result.language, "zh-TW");
  assert.equal(result.sentences.length, 1);
  assert.equal(result.sentences[0].maxAttempts, 6);
});

test("public assignment exposes the configured identity mode", () => {
  const nameOnly = publicAssignment(
    {
      id: "a",
      code: "ABC123",
      title: "T",
      instructions: "",
      anonymous: 0,
      identity_mode: "name_only",
      max_attempts: 2,
    },
    [],
  );
  const anonymous = publicAssignment(
    {
      id: "b",
      code: "XYZ789",
      title: "T",
      instructions: "",
      anonymous: 1,
      identity_mode: "anonymous",
      max_attempts: 2,
    },
    [],
  );
  assert.equal(nameOnly.identityMode, "name_only");
  assert.equal(nameOnly.anonymous, false);
  assert.equal(anonymous.identityMode, "anonymous");
  assert.equal(anonymous.anonymous, true);
});

test("de-identification profile transforms samples and emits mono WAV", () => {
  const sampleRate = 8000,
    samples = Float32Array.from(
      { length: sampleRate },
      (_, i) => 0.2 * Math.sin((2 * Math.PI * 220 * i) / sampleRate),
    );
  const transformed = transformSamples(
    samples,
    sampleRate,
    VOICE_PROFILES.PROFILE_A_M,
  );
  assert.equal(transformed.length, samples.length);
  assert.notDeepEqual(
    [...transformed.slice(0, 100)],
    [...samples.slice(0, 100)],
  );
  const wav = encodeWavMono(transformed, sampleRate),
    view = new DataView(wav);
  assert.equal(String.fromCharCode(...new Uint8Array(wav, 0, 4)), "RIFF");
  assert.equal(view.getUint16(22, true), 1);
});

test("public assignment reports voice de-identification without exposing internals", () => {
  const result = publicAssignment(
    {
      id: "a",
      code: "ABC123",
      title: "T",
      instructions: "",
      anonymous: 1,
      max_attempts: 2,
      deidentify_voice: 1,
      transform_version: "2.0.1",
    },
    [],
  );
  assert.equal(result.deidentifyVoice, true);
  assert.equal(result.transformVersion, "2.0.1");
});
