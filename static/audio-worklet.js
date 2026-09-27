// Convert the actual browser sample rate to mono 16 kHz, preserving phase across blocks.
class ClassroomAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.remaining = this.ratio;
    this.sum = 0;
    this.packet = new Float32Array(640);
    this.offset = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] / channels.length;
      let weight = 1;
      while (weight > 1e-9) {
        const used = Math.min(weight, this.remaining);
        this.sum += value * used;
        this.remaining -= used;
        weight -= used;
        if (this.remaining < 1e-9) {
          this.packet[this.offset++] = this.sum / this.ratio;
          this.sum = 0;
          this.remaining = this.ratio;
          if (this.offset === this.packet.length) {
            this.port.postMessage(this.packet.buffer, [this.packet.buffer]);
            this.packet = new Float32Array(640);
            this.offset = 0;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor("classroom-audio", ClassroomAudio);
