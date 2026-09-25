// Live WebSocket results and recording HTTP streams have independent state and renderers.
// Rendering, connection state, and user actions are separated to keep merges localized.
const $ = (id) => document.getElementById(id);
let ws = null;
let isRecording = false;
let connected = false;
let busy = false;
let uploading = false;
let currentLanguage = "Chinese";
let selectedDevice = "";
let browserAudio = false;
let engineReady = true;
const microphone = window.BrowserMicrophone ? new BrowserMicrophone((message) => {
  updateRecordingState(false);
  if (message) showNotice(message);
}) : null;
let historyEntries = [];
const liveRows = new Map();
const clearedLiveIds = new Set();
let recordingDocuments = [];
let lastRecordingFile = null;
let failedDocument = null;
let liveStages = new Set();
let speechDetected = false;
let uploadStarted = 0;
let uploadTimer = null;
let selectedRecordingFile = null;
let recordingXHR = null;
let activeRecordingJob = null;
let stopRequested = false;
let recordingPhase = "idle";
const languageNames = { Chinese: "SIMPLIFIED CHINESE", Vietnamese: "VIETNAMESE" };
const languageCodes = { Chinese: "zh-Hans", Vietnamese: "vi" };
const emptyHistory = $("historyList").innerHTML;

function showNotice(message = "", setup = false) {
  $("notice").textContent = message;
  $("notice").hidden = !message;
  $("notice").classList.toggle("setup", setup);
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
  $("toggleRecordBtn").disabled = !connected || !engineReady || busy || (!isRecording && !selectedDevice);
  $("audioDeviceSelect").disabled = !connected || busy || isRecording;
  $("btnLangChinese").disabled = $("btnLangVietnamese").disabled = !connected || busy;
  $("dropzone").disabled = uploading;
  $("recordingLanguage").disabled = uploading;
  $("recordingMode").disabled = uploading;
  $("segmentLength").disabled = $("customSegmentLength").disabled = uploading;
  $("startRecordingBtn").disabled = !engineReady || uploading || !selectedRecordingFile;
  $("stopRecordingBtn").hidden = !uploading;
  $("stopRecordingBtn").disabled = stopRequested;
  $("recordingClearBtn").disabled = uploading || !recordingDocuments.length;
  $("recordingExportBtn").disabled = uploading || !recordingDocuments.some(d => d.entries.length);
  $("clearBtn").disabled = $("exportBtn").disabled = historyEntries.length === 0;
  refreshLiveStatus();
  $("sessionHint").textContent = !connected ? "Waiting for the local engine…" : !engineReady ? "Preparing models · please wait" : isRecording ? "Listening · stop when your lecture ends" : !selectedDevice ? "Connect a microphone to start listening" : "Ready · start when your lecturer speaks";
}

function initWebSocket() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/ws/live`);
  ws.onopen = () => {
    connected = true;
    liveStages.clear();
    $("connectionStatus").textContent = "● Connected";
    $("connectionStatus").className = "status-indicator connected";
    refreshControls();
  };
  ws.onclose = () => {
    if (browserAudio && microphone?.socket) microphone.stop("Connection lost. Start listening after reconnecting.");
    connected = false;
    $("connectionStatus").textContent = "○ Reconnecting…";
    $("connectionStatus").className = "status-indicator disconnected";
    // A disconnected browser cannot know whether server-side recording has stopped.
    $("stageNote").textContent = "Connection lost · recording state unknown";
    $("audioMeterFill").style.width = "0%";
    $("vadStatusBadge").textContent = "Unavailable";
    refreshLiveStatus();
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
    speechDetected = Boolean(msg.is_speech);
    refreshLiveStatus();
    $("audioMeterFill").style.width = `${Math.min(Math.max((Number(msg.level) || 0) * 300, 0), 100)}%`;
    $("vadStatusBadge").textContent = msg.is_speech ? "Speaking" : isRecording ? "Listening" : "Idle";
    $("vadStatusBadge").classList.toggle("speaking", Boolean(msg.is_speech));
  } else if (msg.type === "live_status") {
    if (msg.active) liveStages.add(msg.stage); else liveStages.delete(msg.stage);
    if (msg.error) showNotice(msg.error);
    refreshLiveStatus();
  } else if (msg.type === "live_transcript") renderLiveEnglish(msg);
  else if (msg.type === "result" && msg.source !== "recording") renderSubtitleResult(msg);
  else if (msg.type === "devices") {
    browserAudio = msg.audio_source === "browser";
    $("microphoneHint").textContent = browserAudio ? "Uses this browser's microphone · permission required" : "Uses the microphone on the server computer";
    if (browserAudio) {
      populateAudioDevices([{ index: "default", name: "Default browser microphone" }], "default");
      microphone.devices().then(devices => { if (devices.length) populateAudioDevices(devices, "default"); }).catch(() => {});
    } else populateAudioDevices(msg.devices, msg.selected);
  }
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
  $("englishPosition").textContent = "Waiting for speech";
  for (const id of ["statVad", "statStt", "statLlm", "statTotal"]) $(id).textContent = "—";
  $("statTotalBadge").className = "latency-badge total";
  $("statTotalBadge").removeAttribute("title");
}

const milliseconds = (value) => Number.isFinite(value) ? `${value} ms` : "—";
const seconds = (value) => Number.isFinite(value) ? `${(value / 1000).toFixed(2)} s` : "—";
function renderLiveEnglish(data) {
  if (clearedLiveIds.has(data.segment_id)) return;
  $("liveEnglishText").textContent = data.original;
  $("englishPosition").textContent = `Speech at ${formatPosition(data.elapsed_s)} · ${seconds(data.stt_latency_ms)} recognition`;
  addHistoryItem({ ...data, translationState: "pending" });
}
function renderSubtitleResult(data) {
  if (clearedLiveIds.has(data.segment_id)) return;
  if (!data.original && !data.corrected && !data.translated) {
    showNotice("No speech was found. Try a clearer recording or move closer to the microphone.");
    return;
  }
  const language = data.language || currentLanguage;
  // Legacy/reconnected results can arrive without the immediate English event.
  if (!data.segment_id) $("liveEnglishText").textContent = data.original || "—";
  $("statVad").textContent = milliseconds(data.vad_latency_ms);
  $("statStt").textContent = milliseconds(data.stt_latency_ms);
  $("statLlm").textContent = milliseconds(data.llm_latency_ms);
  $("statTotal").textContent = seconds(data.total_latency_ms);
  $("statTotalBadge").className = `latency-badge total ${Number.isFinite(data.total_latency_ms) ? data.total_latency_ms <= 3000 ? "pass" : "fail" : ""}`;
  $("statTotalBadge").title = "Server processing time; see Processing details for measurement limits.";
  addHistoryItem({ ...data, language, translationState: data.translationState || "complete", timestamp: new Date().toLocaleTimeString() });
}

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}
function addHistoryItem(item) {
  $("historyList").querySelector(".empty-state")?.remove();
  const existing = item.segment_id && historyEntries.find(e => e.segment_id === item.segment_id);
  if (existing) { Object.assign(existing, item); item = existing; }
  else historyEntries.push(item);
  const entry = liveRows.get(item.segment_id) || textElement("article", "history-item", "");
  entry.replaceChildren();
  const metadata = textElement("div", "hist-time", "");
  metadata.append(textElement("span", "timestamp", formatPosition(item.elapsed_s)));
  const pending = item.translationState === "pending";
  metadata.append(textElement("span", "", `${item.language} · ${pending ? "English uncorrected · translation pending" : item.translationState === "failed" ? "Translation unavailable" : `${seconds(item.total_latency_ms)} processing`}`));
  entry.append(metadata);
  entry.append(textElement("div", "line-label", "ORIGINAL ENGLISH"));
  entry.append(textElement("div", "hist-en", item.original || "—"));
  const changed = item.corrected && item.corrected !== item.original;
  if (changed) {
    entry.append(textElement("div", "line-label correction-label", "CORRECTED ENGLISH"));
    entry.append(textElement("div", "hist-corrected", item.corrected));
  }
  entry.append(textElement("div", "line-label", `${languageNames[item.language] || item.language} · TRANSLATION`));
  const translation = textElement("div", "hist-trans", pending ? "Correction and translation pending…" : recordingTranslationText(item));
  translation.lang = pending || item.translationState === "failed" ? "en" : languageCodes[item.language] || "";
  entry.append(translation);
  // DOM text nodes keep model output and uploaded content from becoming executable markup.
  if (!existing) $("historyList").prepend(entry);
  if (item.segment_id) liveRows.set(item.segment_id, entry);
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
  refreshLiveStatus();
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
  if (browserAudio) {
    if (microphone.socket) microphone.stop();
    else {
      if (isRecording) throw new Error("Stop listening in the tab that started the microphone.");
      await microphone.start(selectedDevice, currentLanguage);
      updateRecordingState(true);
      const devices = await microphone.devices();
      if (devices.length) populateAudioDevices(devices, selectedDevice);
    }
    return;
  }
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
  if (browserAudio) { selectedDevice = nextDevice; return; }
  try { await request("/api/set_device", { device_index: Number(nextDevice) }); selectedDevice = nextDevice; }
  finally { $("audioDeviceSelect").value = selectedDevice; }
}));
$("clearBtn").addEventListener("click", () => {
  if (!window.confirm("Clear this tab’s transcript? Export it first if you want to keep a copy.")) return;
  for (const item of historyEntries) if (item.segment_id) clearedLiveIds.add(item.segment_id);
  liveRows.clear();
  historyEntries = [];
  $("historyList").innerHTML = emptyHistory;
  $("historyCount").textContent = "0 entries";
  resetSubtitle();
  refreshControls();
});
$("exportBtn").addEventListener("click", () => {
  downloadTranscript("live-transcript", "Classroom Live — Live transcript", historyEntries.map(item =>
    entryText(item, $("liveTimestamps").checked ? formatPosition(item.elapsed_s) : "")).join("\n\n"));
});

$("dropzone").addEventListener("click", () => $("mediaFileInput").click());
$("dropzone").addEventListener("dragover", (event) => { event.preventDefault(); if (!$("dropzone").disabled) $("dropzone").classList.add("drag-over"); });
$("dropzone").addEventListener("dragleave", () => $("dropzone").classList.remove("drag-over"));
$("dropzone").addEventListener("drop", (event) => {
  event.preventDefault();
  $("dropzone").classList.remove("drag-over");
  if (uploading) return;
  if (event.dataTransfer.files.length > 1) { recordingStatus("Please upload one recording at a time."); return; }
  if (event.dataTransfer.files[0]) selectRecordingFile(event.dataTransfer.files[0]);
});
$("mediaFileInput").addEventListener("change", (event) => { if (event.target.files[0]) selectRecordingFile(event.target.files[0]); });

function formatPosition(value) {
  const whole = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60) % 60;
  return `${hours ? `${hours}:` : ""}${String(minutes).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}
function refreshLiveStatus() {
  const pending = historyEntries.filter(item => item.translationState === "pending").length;
  const failed = historyEntries.filter(item => item.translationState === "failed").length;
  $("translationStatus").textContent = !connected ? "Connection lost · translation progress unknown" : pending ? `${pending} ${pending === 1 ? "segment" : "segments"} pending · English keeps updating` : failed ? `${failed} ${failed === 1 ? "translation" : "translations"} unavailable · English retained in history` : historyEntries.length ? "Translations up to date" : "Corrections and translation will follow here.";
  const processing = [...liveStages].join(" & ");
  $("liveSpinner").hidden = !connected || !processing;
  $("stageNote").textContent = !connected ? "Connection lost · recording state unknown" :
    processing || (isRecording ? speechDetected ? "Speech detected" : "Listening" : "Ready");
  $("listeningBanner").hidden = !isRecording;
  $("persistentLiveStatus").textContent = connected ? "● Live listening" : "Live connection lost · microphone state unknown";
  $("stopLiveBtn").disabled = !connected || busy;
}
function selectWorkspace(name) {
  for (const mode of ["live", "recording"]) {
    const active = mode === name;
    $(`${mode}Tab`).setAttribute("aria-selected", String(active));
    $(`${mode}Tab`).tabIndex = active ? 0 : -1;
    $(`${mode}Workspace`).hidden = !active;
  }
  document.querySelector(".skip-link").href = name === "live" ? "#liveSubtitles" : "#recordingResultsHeading";
}
for (const mode of ["live", "recording"]) {
  $(`${mode}Tab`).addEventListener("click", () => selectWorkspace(mode));
  $(`${mode}Tab`).addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "live" : event.key === "End" ? "recording" : mode === "live" ? "recording" : "live";
    selectWorkspace(next); $(`${next}Tab`).focus();
  });
  $(`${mode}Timestamps`).addEventListener("change", () => {
    $(`${mode}Workspace`).classList.toggle("hide-timestamps", !$(`${mode}Timestamps`).checked);
  });
}
$("stopLiveBtn").addEventListener("click", () => runAction(async () => {
  if (browserAudio) {
    if (!microphone.socket) throw new Error("Stop listening in the tab that started the microphone.");
    microphone.stop();
    return;
  }
  const result = await request("/api/stop");
  updateRecordingState(result.is_recording);
}));
function entryText(item, timestamp) {
  if (item.translationState === "omitted") return `${timestamp ? `[${timestamp}] ` : ""}English · transcribed\n${item.original || ""}\nAutomatic correction not applied.`;
  if (item.translationState && item.translationState !== "complete") {
    return `${timestamp ? `[${timestamp}] ` : ""}${item.language}\nEnglish (draft, uncorrected): ${item.original || ""}\nTranslation: ${recordingTranslationText(item)}`;
  }
  return `${timestamp ? `[${timestamp}] ` : ""}${item.language}\nOriginal: ${item.original || ""}\nCorrected: ${item.corrected || item.original || ""}\nTranslation: ${item.translated || "Translation unavailable"}\nCorrections: ${(item.errors_corrected || []).join("; ")}`;
}
function downloadTranscript(prefix, heading, text) {
  const url = URL.createObjectURL(new Blob(["\uFEFF", heading, "\n\n", text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.txt`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("recordingExportBtn").addEventListener("click", () => {
  const text = recordingDocuments.map(doc => `${doc.name} · ${doc.status}\n\n` + doc.entries.map(item =>
    entryText(item, $("recordingTimestamps").checked ? `${formatPosition(item.start)}–${formatPosition(item.end)}` : "")
  ).join("\n\n")).join("\n\n────\n\n");
  downloadTranscript("recording-transcripts", "Classroom Live — Recording transcripts", text);
});
const emptyRecordings = $("recordingResults").innerHTML;
$("recordingClearBtn").addEventListener("click", () => {
  if (!window.confirm("Clear recording transcripts? Export them first to keep a copy.")) return;
  recordingDocuments = []; failedDocument = null; lastRecordingFile = null;
  $("recordingResults").innerHTML = emptyRecordings;
  $("uploadStatus").hidden = $("recordingProgress").hidden = $("recordingElapsed").hidden = $("retryRecordingBtn").hidden = true;
  refreshControls();
});
function recordingStatus(message, completed = null, total = null) {
  $("uploadStatus").hidden = false;
  $("uploadProgressText").textContent = message;
  const progress = $("recordingProgress");
  progress.hidden = !uploading;
  if (completed != null && total > 0) { progress.max = total; progress.value = completed; }
  else progress.removeAttribute("value");
}
function appendRecordingSegment(doc, item) {
  const existing = doc.entries.find(entry => entry.segment_id === item.segment_id);
  if (existing) {
    Object.assign(existing, item);
    updateRecordingSegment(doc, existing);
    return;
  }
  doc.entries.push(item);
  const entry = textElement("article", "history-item", "");
  entry.append(textElement("div", "timestamp hist-time", `${formatPosition(item.start)}–${formatPosition(item.end)}`));
  entry.append(textElement("div", "line-label english-label", ""));
  entry.append(textElement("div", "hist-en", item.corrected || item.original || "—"));
  entry.append(textElement("div", "line-label translation-label", `${languageNames[item.language] || item.language} · TRANSLATION`));
  const translation = textElement("div", "hist-trans", item.translated || "Translation unavailable");
  translation.lang = languageCodes[item.language]; entry.append(translation);
  const details = document.createElement("details");
  details.append(textElement("summary", "", "Original English & corrections"));
  details.append(textElement("p", "", item.original || "—"));
  details.append(textElement("p", "", (item.errors_corrected || []).join(" · ") || "No corrections"));
  entry.append(details); doc.element.append(entry);
  doc.rows.set(item.segment_id, entry);
  updateRecordingSegment(doc, item);
}
function recordingTranslationText(item) {
  const states = { pending: "Translation pending…", translating: "Translating…", stopped: "Translation stopped", failed: "Translation unavailable" };
  return states[item.translationState] || item.translated || "Translation unavailable";
}
function updateRecordingSegment(doc, item) {
  const entry = doc.rows.get(item.segment_id);
  const draft = item.translationState !== "complete";
  const transcriptionOnly = doc.mode === "transcribe";
  entry.querySelector(".timestamp").textContent = `${formatPosition(item.start)}–${formatPosition(item.end)}`;
  entry.querySelector(".english-label").textContent = transcriptionOnly ? "ENGLISH · TRANSCRIBED" : draft ? "ENGLISH · DRAFT (UNCORRECTED)" : "ENGLISH · CORRECTED";
  entry.querySelector(".hist-en").textContent = draft ? item.original : item.corrected || item.original;
  const translation = entry.querySelector(".hist-trans");
  translation.hidden = transcriptionOnly;
  entry.querySelector(".translation-label").hidden = transcriptionOnly;
  translation.textContent = recordingTranslationText(item);
  translation.classList.toggle("translation-pending", item.translationState !== "complete");
  const details = entry.querySelector("details");
  details.hidden = draft;
  const paragraphs = details.querySelectorAll("p");
  paragraphs[0].textContent = item.original || "—";
  paragraphs[1].textContent = (item.errors_corrected || []).join(" · ") || "No corrections";
}
function uploadWithProgress(form, onEvent) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let offset = 0, pending = "", complete = false, streamError = null;
    recordingXHR = xhr;
    xhr.open("POST", "/api/upload_media");
    xhr.upload.onprogress = event => {
      if (stopRequested) return;
      if (event.lengthComputable) recordingStatus(`Uploading · ${Math.round(event.loaded / event.total * 100)}%`, event.loaded, event.total);
    };
    xhr.upload.onload = () => {
      recordingPhase = "processing"; $("stopRecordingBtn").textContent = "Stop processing";
      if (!stopRequested) recordingStatus("Upload received · waiting for processing…");
    };
    function consume(final = false) {
      if (xhr.status !== 200) return;
      pending += xhr.responseText.slice(offset); offset = xhr.responseText.length;
      const lines = pending.split("\n"); pending = lines.pop();
      if (final && pending.trim()) { lines.push(pending); pending = ""; }
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "error") streamError = event.message;
        if (event.type === "complete" || event.type === "stopped") complete = true;
        onEvent(event);
      }
    }
    xhr.onprogress = () => { try { consume(); } catch (_) { streamError = "A processing update could not be read."; xhr.abort(); } };
    xhr.onload = () => {
      try {
        consume(true);
        if (xhr.status !== 200) {
          let message = `The server returned an error (${xhr.status}).`;
          try { const data = JSON.parse(xhr.responseText); if (typeof data.detail === "string") message = data.detail; } catch (_) {}
          throw new Error(message);
        }
        if (streamError || !complete) throw new Error(streamError || "Processing connection ended early. Retry the recording.");
        resolve();
      } catch (error) { reject(error); }
    };
    xhr.onerror = () => reject(new Error("Connection lost. Check the local server and retry."));
    xhr.onabort = () => stopRequested ? resolve() : reject(new Error(streamError || "Upload interrupted. Retry the recording."));
    xhr.send(form);
  });
}
function selectRecordingFile(file) {
  if (uploading) return;
  selectedRecordingFile = file;
  $("selectedRecordingName").textContent = file.name;
  $("mediaFileInput").value = "";
  refreshControls();
}
$("segmentLength").addEventListener("change", () => { $("customSegmentField").hidden = $("segmentLength").value !== "custom"; });
$("recordingMode").addEventListener("change", () => {
  const transcriptionOnly = $("recordingMode").value === "transcribe";
  $("recordingTranslationSettings").hidden = transcriptionOnly;
  $("transcriptionOnlyNote").hidden = !transcriptionOnly;
});
$("startRecordingBtn").addEventListener("click", () => { if (selectedRecordingFile) handleFileUpload(selectedRecordingFile); });
$("stopRecordingBtn").addEventListener("click", async () => {
  if (!uploading || stopRequested) return;
  stopRequested = true; refreshControls();
  recordingStatus("Stopping… waiting for the current operation to finish.");
  try {
    if (activeRecordingJob) await request(`/api/recording_jobs/${activeRecordingJob}/stop`);
    if (recordingPhase === "uploading" && recordingXHR) recordingXHR.abort();
  } catch (error) {
    stopRequested = false; refreshControls();
    recordingStatus(`Could not stop: ${error.message}. Try Stop again.`);
  }
});
async function handleFileUpload(file, retry = false) {
  if (uploading) return;
  if (!file.size) { recordingStatus("This file is empty. Choose an audio or video recording."); return; }
  if (!/^(audio|video)\//.test(file.type) && !/\.(mp4|mov|mkv|mp3|wav|m4a|aac|flac|ogg|webm|avi|wma|aiff|opus)$/i.test(file.name)) {
    recordingStatus("Choose an audio or video file, such as MP3, WAV, M4A or MP4."); return;
  }
  const mode = retry && failedDocument ? failedDocument.mode : $("recordingMode").value;
  const segmentSeconds = mode === "transcribe" ? 60 : retry && failedDocument ? failedDocument.segmentSeconds :
    $("segmentLength").value === "custom" ? Number($("customSegmentLength").value) : parseInt($("segmentLength").value, 10);
  if (!Number.isInteger(segmentSeconds) || segmentSeconds < 15 || segmentSeconds > 300) {
    recordingStatus("Choose a segment length between 15 and 300 seconds."); return;
  }
  // Retrying replaces only the failed attempt; other recording documents stay intact.
  const language = mode === "transcribe" ? "English" : retry && failedDocument ? failedDocument.language : $("recordingLanguage").value;
  if (retry && failedDocument) {
    failedDocument.element.remove();
    recordingDocuments = recordingDocuments.filter(doc => doc !== failedDocument);
  }
  failedDocument = null; lastRecordingFile = file; uploading = true;
  stopRequested = false; activeRecordingJob = null; recordingXHR = null; recordingPhase = "starting";
  $("stopRecordingBtn").textContent = "Cancel upload";
  $("retryRecordingBtn").hidden = true;
  $("uploadFileName").textContent = file.name;
  $("uploadStatus").setAttribute("aria-busy", "true");
  $("recordingResults").querySelector(".empty-state")?.remove();
  const element = textElement("section", "recording-document", "");
  element.append(textElement("h3", "", file.name));
  const statusElement = textElement("p", "document-status", `${language} · Processing`);
  element.append(statusElement); $("recordingResults").append(element);
  if (mode === "transcribe") element.append(textElement("p", "panel-desc", "Automatic correction is not applied."));
  const doc = { name: file.name, language, mode, segmentSeconds, entries: [], rows: new Map(), element, status: "Processing" };
  recordingDocuments.push(doc);
  uploadStarted = Date.now();
  const updateElapsed = () => { $("recordingElapsed").textContent = `Elapsed ${formatPosition((Date.now() - uploadStarted) / 1000)}`; };
  $("recordingElapsed").hidden = false; updateElapsed(); uploadTimer = setInterval(updateElapsed, 1000);
  refreshControls(); recordingStatus("Uploading…", 0, 100);
  const form = new FormData(); form.append("file", file); form.append("language", language);
  form.append("mode", mode);
  try {
    const job = await request("/api/recording_jobs");
    activeRecordingJob = job.job_id;
    if (stopRequested) {
      await request(`/api/recording_jobs/${activeRecordingJob}/stop`);
    } else {
    form.append("job_id", activeRecordingJob); form.append("segment_seconds", String(segmentSeconds));
    recordingPhase = "uploading";
    await uploadWithProgress(form, event => {
      if (event.type === "stopped") stopRequested = true;
      if (event.type === "transcript_segment") {
        appendRecordingSegment(doc, { ...event, language, translationState: mode === "transcribe" ? "omitted" : "pending" });
      }
      if (!stopRequested && ["transcript_segment", "transcription_progress"].includes(event.type)) {
        const message = `Transcribing · ${formatPosition(event.processed_s)} of ${formatPosition(event.duration_s)} processed`;
        recordingStatus(message, event.processed_s, event.duration_s);
        statusElement.textContent = `${language} · ${message}`;
      }
      if (event.type === "transcript") {
        for (const item of event.segments) appendRecordingSegment(doc, { ...item, language: event.language, translationState: "pending" });
      }
      if (event.type === "translating") {
        const item = doc.entries.find(item => item.segment_id === event.segment_id);
        if (item) { item.translationState = "translating"; updateRecordingSegment(doc, item); }
      }
      if (!stopRequested && (event.type === "status" || event.type === "translating" || event.type === "transcript")) {
        const message = event.total > 0
          ? `Transcript ready · ${event.type === "translating" ? `Translating paragraph ${event.segment_id + 1} of ${event.total}` : `${event.completed || 0} of ${event.total} paragraphs translated`}`
          : event.type === "status" ? event.stage + "…" : "No speech detected";
        recordingStatus(message, event.completed || 0, event.total);
        statusElement.textContent = `${language} · ${message}`;
      }
      if (event.type === "segment") {
        appendRecordingSegment(doc, { ...event, translationState: event.error ? "failed" : "complete" });
        if (!stopRequested) {
          const message = `Transcript ready · ${event.completed} of ${event.total} paragraphs translated`;
          recordingStatus(message, event.completed, event.total);
          statusElement.textContent = `${language} · ${message}`;
        }
      }
    });
    }
    doc.status = stopRequested ? (mode === "transcribe" ? "Stopped · partial transcript kept" : "Stopped · transcript and completed translations kept") : doc.entries.length ? "Complete" : "Complete · no speech detected";
    recordingStatus(doc.status, 1, 1);
  } catch (error) {
    doc.status = `Failed · ${error.message}`; failedDocument = doc;
    recordingStatus(doc.status); $("retryRecordingBtn").hidden = false;
  } finally {
    for (const item of doc.entries) {
      if (["pending", "translating"].includes(item.translationState)) {
        item.translationState = stopRequested ? "stopped" : "failed";
        updateRecordingSegment(doc, item);
      }
    }
    statusElement.textContent = `${language} · ${doc.status}`;
    uploading = false; recordingPhase = "idle"; recordingXHR = null; activeRecordingJob = null;
    clearInterval(uploadTimer); updateElapsed();
    $("uploadStatus").setAttribute("aria-busy", "false");
    $("recordingProgress").hidden = true;
    $("mediaFileInput").value = "";
    if (doc.status.startsWith("Stopped") || doc.status.startsWith("Failed")) {
      const discard = textElement("button", "btn btn-quiet", "Discard these results");
      discard.addEventListener("click", () => {
        if (!window.confirm("Discard this recording’s results?")) return;
        doc.element.remove(); recordingDocuments = recordingDocuments.filter(item => item !== doc);
        if (!recordingDocuments.length) $("recordingResults").innerHTML = emptyRecordings;
        refreshControls();
      });
      doc.element.append(discard);
    }
    refreshControls();
  }
}
$("retryRecordingBtn").addEventListener("click", () => { if (lastRecordingFile) handleFileUpload(lastRecordingFile, true); });
refreshControls();
initWebSocket();

async function checkEngineReady() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) return;
    const status = await response.json();
    if (typeof status.ready !== "boolean") return;
    const wasReady = engineReady;
    engineReady = status.ready;
    if (!engineReady) showNotice(status.error ? `${status.stage}: ${status.error}. Restart the container after fixing the problem.` : status.stage, !status.error);
    else if (!wasReady) showNotice();
    refreshControls();
    if (!engineReady) setTimeout(checkEngineReady, 2000);
  } catch (_) { setTimeout(checkEngineReady, 2000); }
}
checkEngineReady();
window.addEventListener("pagehide", () => { if (browserAudio) microphone?.stop(); });
