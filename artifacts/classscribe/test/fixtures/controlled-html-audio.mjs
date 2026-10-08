export class ControlledHtmlAudio {
  constructor({ readyState = 0 } = {}) {
    this.readyState = readyState;
    this.src = '';
    this.seekCalls = [];
    this.playCalls = 0;
    this.listeners = new Map();
    this.hidden = false;
    this.note = { textContent: '' };
    this._currentTime = 0;
  }

  get currentTime() {
    return this._currentTime;
  }

  set currentTime(value) {
    this._currentTime = value;
    this.seekCalls.push(value);
  }

  addEventListener(eventName, callback, options = {}) {
    const callbacks = this.listeners.get(eventName) || [];
    callbacks.push({ callback, once: Boolean(options.once) });
    this.listeners.set(eventName, callbacks);
  }

  dispatch(eventName) {
    if (eventName === 'loadedmetadata') this.readyState = 1;
    const callbacks = this.listeners.get(eventName) || [];
    this.listeners.set(eventName, callbacks.filter((listener) => !listener.once));
    callbacks.forEach(({ callback }) => callback());
  }

  play() {
    this.playCalls++;
    return Promise.resolve();
  }
}