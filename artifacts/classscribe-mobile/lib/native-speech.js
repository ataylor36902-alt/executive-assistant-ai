import { Platform } from "react-native";
import Constants from "expo-constants";

const NATIVE_EVENTS = [
  "audiostart",
  "audioend",
  "end",
  "error",
  "languagedetection",
  "nomatch",
  "result",
  "soundend",
  "soundstart",
  "speechend",
  "speechstart",
  "start",
  "volumechange",
];

const listeners = new Map();
let nativeModule = null;
let moduleResolutionAttempted = false;
let nativeSubscriptions = [];
let active = false;
let paused = false;
let previousOptions = {};

function getUnavailableReason() {
  if (Platform.OS === "web") {
    return "Live speech recognition requires a native iOS or Android build.";
  }
  if (Constants.appOwnership === "expo") {
    return "Live speech recognition requires a development or installable build; Expo Go does not include the native speech module.";
  }
  if (Platform.OS === "android" && Number(Platform.Version) < 33) {
    return "Live speech recording requires Android 13 or newer.";
  }
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    return `Live speech recognition is not supported on ${Platform.OS}.`;
  }
  return null;
}

function getNativeModule() {
  const unavailableReason = getUnavailableReason();
  if (unavailableReason) return { module: null, reason: unavailableReason };
  if (!moduleResolutionAttempted) {
    moduleResolutionAttempted = true;
    try {
      // The native package is deliberately loaded only after platform checks.
      nativeModule = require("expo-speech-recognition").ExpoSpeechRecognitionModule;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        module: null,
        reason: `The native speech module is unavailable in this build: ${message}`,
      };
    }
  }
  if (!nativeModule) {
    return {
      module: null,
      reason: "The native speech module is missing from this installable build.",
    };
  }
  return { module: nativeModule, reason: null };
}

function emit(eventName, payload) {
  const eventListeners = listeners.get(eventName);
  if (!eventListeners) return;
  for (const listener of [...eventListeners]) {
    try {
      listener(payload);
    } catch {
      // Keep an individual consumer callback from interrupting native events.
    }
  }
}

function emitState() {
  emit("state", { active, paused });
}

function attachNativeListeners(module) {
  if (nativeSubscriptions.length > 0) return;
  nativeSubscriptions = NATIVE_EVENTS.map((eventName) =>
    module.addListener(eventName, (payload) => {
      if (eventName === "end") {
        active = false;
        emitState();
      }
      emit(eventName, payload);
    }),
  );
}

/**
 * A safe bridge to expo-speech-recognition.
 *
 * addListener(name, callback) supports native event names listed above and
 * "state"; it returns { remove() }. Native audioend carries the finalized WAV
 * URI. Pause ends that WAV and resume starts a new recording segment because
 * the underlying speech-recognition API has no non-destructive pause method.
 */
const NativeSpeech = {
  getStatus() {
    const { module, reason } = getNativeModule();
    if (!module) return { supported: false, available: false, reason };
    try {
      const recordingSupported = module.supportsRecording();
      const available = module.isRecognitionAvailable();
      return {
        supported: recordingSupported,
        available,
        reason: !recordingSupported
          ? "This device does not support persisted speech recordings."
          : !available
            ? "No speech-recognition service is available on this device."
            : null,
        onDeviceSupported: module.supportsOnDeviceRecognition(),
      };
    } catch (error) {
      return {
        supported: false,
        available: false,
        reason: `Unable to inspect native speech support: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  addListener(eventName, listener) {
    if (typeof listener !== "function") {
      throw new TypeError("NativeSpeech.addListener requires a callback.");
    }
    let eventListeners = listeners.get(eventName);
    if (!eventListeners) {
      eventListeners = new Set();
      listeners.set(eventName, eventListeners);
    }
    eventListeners.add(listener);
    return {
      remove() {
        eventListeners.delete(listener);
        if (eventListeners.size === 0) listeners.delete(eventName);
      },
    };
  },

  async start(options = {}) {
    const { module, reason } = getNativeModule();
    if (!module) return { started: false, reason };
    const status = this.getStatus();
    if (!status.supported || !status.available) {
      return { started: false, reason: status.reason };
    }
    if (active && !paused) {
      return { started: false, reason: "Speech recognition is already running." };
    }

    let permission;
    try {
      permission = await module.requestPermissionsAsync();
    } catch (error) {
      return {
        started: false,
        reason: `Unable to request microphone and speech permissions: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (!permission.granted) {
      const message = "Microphone and speech-recognition permissions are required.";
      emit("error", { error: "not-allowed", message });
      return { started: false, reason: message, permission };
    }

    attachNativeListeners(module);
    previousOptions = { ...options };
    const preferOnDevice = options.preferOnDevice !== false;
    let onDevice = false;
    if (preferOnDevice && status.onDeviceSupported) {
      try {
        const locales = await module.getSupportedLocales({});
        const requestedLocale = (options.lang ?? "en-US").toLowerCase();
        onDevice = locales.installedLocales.some(
          (locale) => locale.toLowerCase() === requestedLocale,
        );
      } catch {
        // Prefer an online recognizer over failing when offline locale metadata
        // is unavailable or the platform's recognition service cannot report it.
      }
    }
    const providedRecordingOptions = options.recordingOptions ?? {};
    const requestedFilename = providedRecordingOptions.outputFileName;
    const outputFileName = requestedFilename
      ? `${requestedFilename.replace(/\.wav$/i, "")}.wav`
      : `classscribe-${Date.now()}.wav`;
    const recognitionOptions = { ...options };
    delete recognitionOptions.preferOnDevice;
    recognitionOptions.lang = options.lang ?? "en-US";
    recognitionOptions.continuous = options.continuous ?? true;
    recognitionOptions.interimResults = options.interimResults ?? true;
    recognitionOptions.addsPunctuation = options.addsPunctuation ?? true;
    recognitionOptions.requiresOnDeviceRecognition = onDevice;
    recognitionOptions.recordingOptions = {
      ...providedRecordingOptions,
      persist: true,
      outputFileName,
      outputSampleRate: 16000,
      outputEncoding: "pcmFormatInt16",
    };
    recognitionOptions.volumeChangeEventOptions = {
      ...options.volumeChangeEventOptions,
      enabled: true,
    };

    try {
      paused = false;
      active = true;
      module.start(recognitionOptions);
      emitState();
      return { started: true, onDevice };
    } catch (error) {
      active = false;
      emitState();
      return {
        started: false,
        reason: `Unable to start speech recognition: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  stop() {
    const { module } = getNativeModule();
    paused = false;
    active = false;
    emitState();
    if (module) {
      try {
        module.stop();
      } catch (error) {
        return {
          stopped: false,
          reason: `Unable to stop speech recognition: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    return { stopped: true };
  },

  pause() {
    const { module, reason } = getNativeModule();
    if (!module) return { paused: false, reason };
    if (!active || paused) {
      return { paused: false, reason: "Speech recognition is not currently running." };
    }
    try {
      module.stop();
      active = false;
      paused = true;
      emitState();
      return { paused: true };
    } catch (error) {
      return {
        paused: false,
        reason: `Unable to pause speech recognition: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  async resume(options = {}) {
    if (!paused) {
      return { started: false, reason: "Speech recognition is not paused." };
    }
    return this.start({
      ...previousOptions,
      ...options,
      recordingOptions: {
        ...(previousOptions.recordingOptions || {}),
        ...(options.recordingOptions || {}),
      },
    });
  },

  removeAllListeners() {
    listeners.clear();
    for (const subscription of nativeSubscriptions) subscription.remove();
    nativeSubscriptions = [];
  },
};

export default NativeSpeech;
export const getStatus = () => NativeSpeech.getStatus();
export const addListener = (eventName, listener) =>
  NativeSpeech.addListener(eventName, listener);
export const start = (options) => NativeSpeech.start(options);
export const stop = () => NativeSpeech.stop();
export const pause = () => NativeSpeech.pause();
export const resume = () => NativeSpeech.resume();