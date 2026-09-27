// Microphone data stays on the machine running this app, unless you deliberately tunnel it.
class BrowserMicrophone {
  constructor(onStopped) {
    this.onStopped = onStopped;
    this.stream = null;
    this.context = null;
    this.socket = null;
  }
  async devices() {
    if (!navigator.mediaDevices?.getUserMedia) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === "audioinput").map((d, index) => ({
      index: d.deviceId || "default", name: d.label || `Microphone ${index + 1}`,
    }));
  }
  async start(deviceId, language) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access requires localhost or an HTTPS address.");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: {
        deviceId: deviceId && deviceId !== "default" ? { exact: deviceId } : undefined,
        channelCount: 1, echoCancellation: true, noiseSuppression: true,
      }});
      this.context = new AudioContext();
      await this.context.resume();
      await this.context.audioWorklet.addModule("/static/audio-worklet.js?v=20260925");
      const socket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws/audio`);
      this.socket = socket;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Audio connection timed out.")), 15000);
        const fail = message => { clearTimeout(timer); reject(new Error(message)); };
        socket.onopen = () => socket.send(JSON.stringify({ sample_rate: 16000, format: "f32le", language }));
        socket.onerror = () => fail("Could not connect the microphone to the app.");
        socket.onclose = () => fail("Audio connection closed before it was ready.");
        socket.onmessage = event => {
          const message = JSON.parse(event.data);
          if (message.error) fail(message.error);
          else if (message.type === "ready") { clearTimeout(timer); resolve(); }
        };
      });
      socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.error) this.stop(message.error);
      };
      socket.onclose = () => this.stop("Microphone connection ended. Start listening to reconnect.");
      this.source = this.context.createMediaStreamSource(this.stream);
      this.worklet = new AudioWorkletNode(this.context, "classroom-audio");
      this.worklet.port.onmessage = event => {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount > 256000) { this.stop("Connection too slow for live audio. Try again."); return; }
        socket.send(event.data);
      };
      this.source.connect(this.worklet);
      // The worklet emits silence to the output, preventing microphone feedback.
      this.worklet.connect(this.context.destination);
      for (const track of this.stream.getTracks()) track.onended = () => this.stop("The microphone was disconnected.");
    } catch (error) {
      this.stop();
      throw error;
    }
  }
  stop(message = "") {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onerror = null;
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" }));
      socket.close();
    }
    this.worklet?.disconnect();
    this.source?.disconnect();
    this.worklet = this.source = null;
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.stream = null;
    this.context?.close().catch(() => {});
    this.context = null;
    this.onStopped(message);
  }
}
window.BrowserMicrophone = BrowserMicrophone;
