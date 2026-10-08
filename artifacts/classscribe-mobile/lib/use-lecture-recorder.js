import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { AudioModule } from 'expo-audio';
import { createRecorderLifecycle, recordingOptionsForPlatform } from './recorder-lifecycle';

export function useLectureRecorder(options, interval = 200) {
  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = createRecorderLifecycle(() =>
      new AudioModule.AudioRecorder(recordingOptionsForPlatform(options, Platform.OS)));
  }
  const recorder = controllerRef.current;
  const [status, setStatus] = useState(() => recorder.getStatus());
  useEffect(() => {
    recorder.activate();
    const timer = setInterval(() => setStatus({ ...recorder.poll() }), interval);
    return () => {
      clearInterval(timer);
      recorder.dispose();
    };
  }, [recorder, interval]);
  return [recorder, status];
}
