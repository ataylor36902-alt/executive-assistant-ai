import { File, Paths } from 'expo-file-system';

// Run only from the development recovery screen on an iOS/Android device.
// A short audible WAV makes the preview check possible without microphone access.
export function createRecoveryDeviceFixture(corrupt = false) {
  if (!__DEV__) throw new Error('Recovery fixtures are only available in development.');
  if (corrupt) {
    const file = new File(Paths.document, `classscribe-recovery-damaged-${Date.now()}.wav`);
    const bytes = new Uint8Array([110, 111, 116, 45, 97, 117, 100, 105, 111]);
    file.write(bytes);
    if (!file.exists || file.size !== bytes.length) throw new Error('The damaged sample was not written to documents.');
    return file.name;
  }
  const sampleRate = 8000;
  const samples = sampleRate;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const label = (offset, text) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  label(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  label(8, 'WAVE');
  label(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  label(36, 'data');
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const fade = Math.min(1, i / 400, (samples - i) / 400);
    view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 440 * i / sampleRate) * 10000 * fade), true);
  }
  const file = new File(Paths.document, `classscribe-recovery-check-${Date.now()}.wav`);
  file.write(bytes);
  if (!file.exists || file.size !== bytes.length) throw new Error('The sample audio was not written to documents.');
  return file.name;
}