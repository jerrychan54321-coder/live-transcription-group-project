// Verify sample counts and signal amplitude across 44.1/48 kHz block boundaries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
for (const rate of [16000, 44100, 48000]) {
  const packets = [];
  let Processor;
  const context = {
    sampleRate: rate, Float32Array,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: buffer => packets.push(new Float32Array(buffer)) }; } },
    registerProcessor: (_, cls) => { Processor = cls; },
  };
  vm.runInNewContext(fs.readFileSync('static/audio-worklet.js', 'utf8'), context);
  const processor = new Processor();
  for (let sent = 0; sent < rate; sent += 128) {
    const n = Math.min(128, rate - sent);
    processor.process([[new Float32Array(n).fill(0.5), new Float32Array(n).fill(0.25)]]);
  }
  assert.equal(packets.reduce((n, p) => n + p.length, 0), 16000, `${rate}: exactly one second`);
  for (const packet of packets) for (const sample of packet) assert.ok(Math.abs(sample - 0.375) < 1e-6);
}
console.log('Audio resampling checks passed at 16, 44.1 and 48 kHz.');
