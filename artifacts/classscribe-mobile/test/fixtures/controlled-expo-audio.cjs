class ControlledExpoAudio {
  constructor() {
    this.loaded = false;
    this.seekCalls = [];
    this.playCalls = 0;
  }

  async seekTo(seconds) {
    if (!this.loaded) throw new Error('Audio has not loaded');
    this.seekCalls.push(seconds);
  }

  play() {
    if (!this.loaded) throw new Error('Audio has not loaded');
    this.playCalls++;
  }

  load() {
    this.loaded = true;
  }
}

module.exports = { ControlledExpoAudio };