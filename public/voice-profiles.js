export const VOICE_TRANSFORM_VERSION = "2.0.1";

export const VOICE_PROFILES = Object.freeze({
  PROFILE_A_M: Object.freeze({
    id: "PROFILE_A_M", version: VOICE_TRANSFORM_VERSION, pitchSemitones: 3,
    formantScale: 1.12, formantCentersHz: Object.freeze([500, 1500, 2500]),
    modulationDepthMs: 0, modulationRateHz: 0, highpassHz: 100,
    lowpassHz: 7200, targetRms: 0.14, frameSize: 1024, analysisHop: 256,
  }),
  PROFILE_A_F: Object.freeze({
    id: "PROFILE_A_F", version: VOICE_TRANSFORM_VERSION, pitchSemitones: -3,
    formantScale: 0.89, formantCentersHz: Object.freeze([500, 1500, 2500]),
    modulationDepthMs: 0, modulationRateHz: 0, highpassHz: 90,
    lowpassHz: 6500, targetRms: 0.14, frameSize: 1024, analysisHop: 256,
  }),
});
