// Vanilla JS deliberately preserves the FastAPI endpoints and result payload contract.
// Rendering, connection state, and user actions are separated to keep merges localized.
const $ = (id) => document.getElementById(id);
let ws = null;
let isRecording = false;
let connected = false;
let busy = false;
let uploading = false;
let currentLanguage = "Chinese";
let selectedDevice = "";
let historyEntries = [];
const languageNames = { Chinese: "SIMPLIFIED CHINESE", Vietnamese: "VIETNAMESE" };
const languageCodes = { Chinese: "zh-Hans", Vietnamese: "vi" };
const placeholders = { Chinese: "选择麦克风，然后开始聆听。", Vietnamese: "Chọn micrô, sau đó bắt đầu nghe." };
const emptyHistory = $("historyList").innerHTML;

function showNotice(message = "") {
  $("notice").textContent = message;
  $("notice").hidden = !message;
}

// HTTP failures must be visible; fetch does not reject on 4xx/5xx responses.
async function request(endpoint, body) {
  const options = { method: "POST" };
  if (body instanceof FormData) options.body = body;
  else if (body) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(endpoint, options);
  if (!response.ok) {
    let detail = "";
    try { const error = await response.json(); if (typeof error.detail === "string") detail = error.detail; } catch (_) { /* Server errors can return plain text. */ }
    throw new Error(detail || `The server returned an error (${response.status}). Please try again.`);
  }
  return response.json();
}

function refreshControls() {
  $("toggleRecordBtn").disabled = !connected || busy || (!isRecording && !selectedDevice);
  $("audioDeviceSelect").disabled = !connected || busy || uploading || isRecording;
  $("btnLangChinese").disabled = $("btnLangVietnamese").disabled = !connected || busy || uploading;
  $("dropzone").disabled = !connected || busy || uploading;
  $("clearBtn").disabled = $("exportBtn").disabled = historyEntries.length === 0;
  $("sessionHint").textContent = !connected ? "Waiting for the local engine…" : isRecording ? "Listening · stop when your lecture ends" : !selectedDevice ? "Connect a microphone to listen, or upload a file" : "Ready · start when your lecturer speaks";
}

function initWebSocket() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/ws/live`);
  ws.onopen = () => {
    connected = true;
    $("connectionStatus").textContent = "● Connected";
    $("connectionStatus").className = "status-indicator connected";
    refreshControls();
  };
  ws.onclose = () => {
    connected = false;
    $("connectionStatus").textContent = "○ Reconnecting…";
    $("connectionStatus").className = "status-indicator disconnected";
    // A disconnected browser cannot know whether server-side recording has stopped.
    $("stageNote").textContent = "Connection lost · recording state unknown";
    $("audioMeterFill").style.width = "0%";
    $("vadStatusBadge").textContent = "Unavailable";
    refreshControls();
    setTimeout(initWebSocket, 2000);
  };
  ws.onmessage = (event) => {
    try { handleSocketMessage(JSON.parse(event.data)); }
    catch (error) { console.error("Invalid engine message", error); showNotice("A result could not be displayed. Please try again."); }
  };
}

function handleSocketMessage(msg) {
  if (msg.type === "audio_level") {
    $("audioMeterFill").style.width = `${Math.min(Math.max((Number(msg.level) || 0) * 300, 0), 100)}%`;
    $("vadStatusBadge").textContent = msg.is_speech ? "Speaking" : isRecording ? "Listening" : "Idle";
    $("vadStatusBadge").classList.toggle("speaking", Boolean(msg.is_speech));
  } else if (msg.type === "result") renderSubtitleResult(msg);
  else if (msg.type === "devices") populateAudioDevices(msg.devices, msg.selected);
  else if (msg.type === "state") {
    if (languageNames[msg.language]) applyLanguage(msg.language);
    updateRecordingState(msg.is_recording);
  }
}

function applyLanguage(lang) {
  currentLanguage = lang;
  for (const name of Object.keys(languageNames)) {
    const button = $(`btnLang${name}`);
    button.classList.toggle("active", name === lang);
    button.setAttribute("aria-pressed", String(name === lang));
  }
  // Keep a completed subtitle's label unchanged when choosing the next target language.
  if (!historyEntries.length) resetSubtitle();
}

function resetSubtitle() {
  $("liveEnglishText").innerHTML = '<span class="placeholder">Your lecture starts here.</span>';
  $("liveTranslationText").replaceChildren();
  const placeholder = document.createElement("span");
  placeholder.className = "placeholder";
  placeholder.textContent = placeholders[currentLanguage];
  $("liveTranslationText").append(placeholder);
  $("translationLineLabel").textContent = `${languageNames[currentLanguage]} · TRANSLATION`;
  $("liveTranslationText").lang = languageCodes[currentLanguage];
  $("rawDiffContainer").hidden = true;
  for (const id of ["statVad", "statStt", "statLlm", "statTotal"]) $(id).textContent = "—";
  $("statTotalBadge").className = "latency-badge total";
  $("statTotalBadge").removeAttribute("title");
}

const milliseconds = (value) => Number.isFinite(value) ? `${value} ms` : "—";
const seconds = (value) => Number.isFinite(value) ? `${(value / 1000).toFixed(2)} s` : "—";
function renderSubtitleResult(data) {
  if (!data.original && !data.corrected && !data.translated) {
    showNotice("No speech was found. Try a clearer recording or move closer to the microphone.");
    return;
  }
  const language = data.language || currentLanguage;
  $("liveEnglishText").textContent = data.corrected || data.original || "—";
  $("liveTranslationText").textContent = data.translated || "Translation unavailable";
  $("translationLineLabel").textContent = `${languageNames[language] || language} · TRANSLATION`;
  $("liveTranslationText").lang = languageCodes[language] || "";
  // Always expose original English, including punctuation/case-only corrections (PDF requirement).
  $("rawDiffContainer").hidden = false;
  $("liveRawText").textContent = data.original || "—";
  const changed = data.original && data.corrected && data.original !== data.corrected;
  $("liveCorrectionsList").textContent = changed ? (data.errors_corrected || []).join(" · ") || "Text corrected" : "No corrections";
  $("statVad").textContent = milliseconds(data.vad_latency_ms);
  $("statStt").textContent = milliseconds(data.stt_latency_ms);
  $("statLlm").textContent = milliseconds(data.llm_latency_ms);
  $("statTotal").textContent = seconds(data.total_latency_ms);
  $("statTotalBadge").className = `latency-badge total ${Number.isFinite(data.total_latency_ms) ? data.total_latency_ms <= 3000 ? "pass" : "fail" : ""}`;
  $("statTotalBadge").title = "Server processing time; see Processing details for measurement limits.";
  addHistoryItem({ ...data, language, timestamp: new Date().toLocaleTimeString() });
}

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}
function addHistoryItem(item) {
  $("historyList").querySelector(".empty-state")?.remove();
  const entry = textElement("article", "history-item", "");
  entry.append(textElement("div", "hist-time", `${item.timestamp} · ${item.language} · ${seconds(item.total_latency_ms)} processing`));
  entry.append(textElement("div", "hist-en", item.corrected || item.original || "—"));
  const translation = textElement("div", "hist-trans", item.translated || "Translation unavailable");
  translation.lang = languageCodes[item.language] || "";
  entry.append(translation);
  const original = document.createElement("details");
  original.append(textElement("summary", "", "Original English & corrections"));
  original.append(textElement("p", "", item.original || "—"));
  original.append(textElement("p", "", (item.errors_corrected || []).join(" · ") || (item.corrected && item.corrected !== item.original ? "Text corrected" : "No corrections")));
  entry.append(original);
  // DOM text nodes keep model output and uploaded content from becoming executable markup.
  $("historyList").prepend(entry);
  historyEntries.push(item);
  $("historyCount").textContent = `${historyEntries.length} ${historyEntries.length === 1 ? "entry" : "entries"}`;
  refreshControls();
}

function populateAudioDevices(devices, selectedIndex) {
  $("audioDeviceSelect").replaceChildren();
  for (const device of devices || []) {
    const option = document.createElement("option");
    option.value = device.index;
    option.textContent = device.name;
    $("audioDeviceSelect").append(option);
  }
  if (selectedIndex != null) $("audioDeviceSelect").value = String(selectedIndex);
  selectedDevice = $("audioDeviceSelect").value;
  if (!devices?.length) $("audioDeviceSelect").append(new Option("No microphones found", ""));
  refreshControls();
}
function updateRecordingState(recording) {
  isRecording = Boolean(recording);
  $("toggleRecordBtn").classList.toggle("recording", isRecording);
  document.body.classList.toggle("is-recording", isRecording);
  $("recordBtnText").textContent = isRecording ? "Stop listening" : "Start listening";
  $("stageNote").textContent = isRecording ? "Listening for your next idea…" : "Ready when you are";
  if (!isRecording) {
    $("audioMeterFill").style.width = "0%";
    $("vadStatusBadge").textContent = "Idle";
    $("vadStatusBadge").classList.remove("speaking");
  }
  refreshControls();
}

// Serialize setting changes and commit UI state only after the server accepts them.
async function runAction(action) {
  if (busy) return;
  busy = true;
  showNotice();
  refreshControls();
  try { await action(); } catch (error) { showNotice(error.message || "Could not reach the local server. Please try again."); }
  finally { busy = false; refreshControls(); }
}
$("toggleRecordBtn").addEventListener("click", () => runAction(async () => {
  if (!isRecording) {
    // The initial server device can be null. Explicitly apply the microphone displayed in the UI.
    await request("/api/set_device", { device_index: Number(selectedDevice) });
    await request("/api/set_language", { language: currentLanguage });
  }
  const result = await request(isRecording ? "/api/stop" : "/api/start");
  updateRecordingState(result.is_recording);
}));
for (const lang of Object.keys(languageNames)) $(`btnLang${lang}`).addEventListener("click", () => runAction(async () => {
  await request("/api/set_language", { language: lang });
  applyLanguage(lang);
}));
$("audioDeviceSelect").addEventListener("change", () => runAction(async () => {
  const nextDevice = $("audioDeviceSelect").value;
  try { await request("/api/set_device", { device_index: Number(nextDevice) }); selectedDevice = nextDevice; }
  finally { $("audioDeviceSelect").value = selectedDevice; }
}));
$("clearBtn").addEventListener("click", () => {
  if (!window.confirm("Clear this tab’s transcript? Export it first if you want to keep a copy.")) return;
  historyEntries = [];
  $("historyList").innerHTML = emptyHistory;
  $("historyCount").textContent = "0 entries";
  resetSubtitle();
  refreshControls();
});
$("exportBtn").addEventListener("click", () => {
  const text = historyEntries.map((item) => `[${item.timestamp}] ${item.language}\nOriginal: ${item.original || ""}\nCorrected: ${item.corrected || item.original || ""}\nTranslation: ${item.translated || ""}\nCorrections: ${(item.errors_corrected || []).join("; ")}\nProcessing time: ${seconds(item.total_latency_ms)}`).join("\n\n");
  const url = URL.createObjectURL(new Blob(["\uFEFFClassroom Live — Lecture transcript\n\n", text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `lecture-transcript-${new Date().toISOString().slice(0, 10)}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$("dropzone").addEventListener("click", () => $("mediaFileInput").click());
$("dropzone").addEventListener("dragover", (event) => { event.preventDefault(); if (!$("dropzone").disabled) $("dropzone").classList.add("drag-over"); });
$("dropzone").addEventListener("dragleave", () => $("dropzone").classList.remove("drag-over"));
$("dropzone").addEventListener("drop", (event) => {
  event.preventDefault();
  $("dropzone").classList.remove("drag-over");
  if (event.dataTransfer.files.length > 1) { showNotice("Please upload one recording at a time."); return; }
  if (event.dataTransfer.files[0]) handleFileUpload(event.dataTransfer.files[0]);
});
$("mediaFileInput").addEventListener("change", (event) => { if (event.target.files[0]) handleFileUpload(event.target.files[0]); });
async function handleFileUpload(file) {
  if (uploading || busy || !connected) return;
  if (!file.size) { showNotice("This file is empty. Choose an audio or video recording."); return; }
  if (!/^(audio|video)\//.test(file.type) && !/\.(mp4|mov|mkv|mp3|wav|m4a|aac|flac|ogg|webm|avi|wma|aiff|opus)$/i.test(file.name)) {
    showNotice("Choose an audio or video file, such as MP3, WAV, M4A or MP4."); return;
  }
  uploading = true;
  showNotice();
  refreshControls();
  $("uploadStatus").hidden = false;
  $("uploadStatus").setAttribute("aria-busy", "true");
  $("uploadFileName").textContent = file.name;
  $("uploadProgressText").textContent = "Uploading and processing… Longer recordings may take a while.";
  const language = currentLanguage;
  const form = new FormData();
  form.append("file", file);
  try {
    await request("/api/set_language", { language });
    const result = await request("/api/upload_media", form);
    renderSubtitleResult({ ...result, language: result.language || language });
    $("uploadProgressText").textContent = result.original || result.corrected ? "Complete · added to your transcript" : "Complete · no speech detected";
  } catch (error) {
    $("uploadProgressText").textContent = `Upload failed: ${error.message}`;
  } finally {
    uploading = false;
    $("uploadStatus").setAttribute("aria-busy", "false");
    $("mediaFileInput").value = ""; // Allow retrying the same file after an error.
    refreshControls();
  }
}
refreshControls();
initWebSocket();
