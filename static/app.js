// ADI205/501 Live Bilingual Classroom Translation Application
// Client-side WebSocket & UI Controller

let ws = null;
let isRecording = false;
let currentLanguage = "Chinese";

// DOM Elements
const connectionStatus = document.getElementById("connectionStatus");
const toggleRecordBtn = document.getElementById("toggleRecordBtn");
const recordBtnText = document.getElementById("recordBtnText");
const audioDeviceSelect = document.getElementById("audioDeviceSelect");
const btnLangChinese = document.getElementById("btnLangChinese");
const btnLangVietnamese = document.getElementById("btnLangVietnamese");
const clearBtn = document.getElementById("clearBtn");

const audioMeterFill = document.getElementById("audioMeterFill");
const vadStatusBadge = document.getElementById("vadStatusBadge");

const liveEnglishText = document.getElementById("liveEnglishText");
const liveTranslationText = document.getElementById("liveTranslationText");
const translationLineLabel = document.getElementById("translationLineLabel");
const rawDiffContainer = document.getElementById("rawDiffContainer");
const liveRawText = document.getElementById("liveRawText");
const liveCorrectionsList = document.getElementById("liveCorrectionsList");

const statVad = document.getElementById("statVad");
const statStt = document.getElementById("statStt");
const statLlm = document.getElementById("statLlm");
const statTotal = document.getElementById("statTotal");
const statTotalBadge = document.getElementById("statTotalBadge");

const historyList = document.getElementById("historyList");
const historyCount = document.getElementById("historyCount");

const dropzone = document.getElementById("dropzone");
const mediaFileInput = document.getElementById("mediaFileInput");
const uploadStatus = document.getElementById("uploadStatus");
const uploadFileName = document.getElementById("uploadFileName");
const uploadProgressText = document.getElementById("uploadProgressText");

let historyEntries = [];

// Initialize WebSocket Connection
function initWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws/live`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    connectionStatus.textContent = "● Connected (Local Engine)";
    connectionStatus.style.color = "var(--accent-green)";
  };

  ws.onclose = () => {
    connectionStatus.textContent = "○ Disconnected (Reconnecting...)";
    connectionStatus.style.color = "var(--accent-red)";
    setTimeout(initWebSocket, 2000);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleSocketMessage(data);
    } catch (e) {
      console.error("Error parsing WebSocket message:", e);
    }
  };
}

function handleSocketMessage(msg) {
  if (msg.type === "audio_level") {
    // Update volume visualizer
    const level = Math.min(Math.max(msg.level * 100 * 3, 2), 100);
    audioMeterFill.style.width = `${level}%`;

    if (msg.is_speech) {
      vadStatusBadge.textContent = "Speaking";
      vadStatusBadge.classList.add("speaking");
    } else {
      vadStatusBadge.textContent = "Silence";
      vadStatusBadge.classList.remove("speaking");
    }
  } else if (msg.type === "result") {
    // Display new subtitle segment
    renderSubtitleResult(msg);
  } else if (msg.type === "devices") {
    populateAudioDevices(msg.devices, msg.selected);
  } else if (msg.type === "state") {
    updateRecordingState(msg.is_recording);
  }
}

function renderSubtitleResult(data) {
  // Update live subtitle lines
  liveEnglishText.textContent = data.corrected || data.original;
  liveTranslationText.textContent = data.translated || "--";

  // Check if errors were detected/corrected
  const hasDiff = data.original && data.corrected && (data.original.trim().toLowerCase() !== data.corrected.trim().toLowerCase());
  if (hasDiff) {
    rawDiffContainer.style.display = "flex";
    liveRawText.textContent = data.original;
    if (data.errors_corrected && data.errors_corrected.length > 0) {
      liveCorrectionsList.textContent = `[${data.errors_corrected.join(", ")}]`;
    } else {
      liveCorrectionsList.textContent = "[Auto-corrected]";
    }
  } else {
    rawDiffContainer.style.display = "none";
  }

  // Update Latency Badges
  statVad.textContent = `${data.vad_latency_ms || 10}ms`;
  statStt.textContent = `${data.stt_latency_ms || 0}ms`;
  statLlm.textContent = `${data.llm_latency_ms || 0}ms`;

  const totalSec = (data.total_latency_ms / 1000).toFixed(2);
  statTotal.textContent = `${totalSec}s`;

  if (data.total_latency_ms <= 3000) {
    statTotalBadge.className = "latency-badge total pass";
    statTotalBadge.title = "Passes course delay constraint (<= 3.0s)";
  } else {
    statTotalBadge.className = "latency-badge total fail";
    statTotalBadge.title = "Exceeded 3.0s constraint";
  }

  // Add to History
  addHistoryItem(data);
}

function addHistoryItem(item) {
  const emptyState = historyList.querySelector(".empty-state");
  if (emptyState) emptyState.remove();

  const timestamp = new Date().toLocaleTimeString();
  const div = document.createElement("div");
  div.className = "history-item";
  div.innerHTML = `
    <div class="hist-time">
      <span>${timestamp} (${(item.duration_s || 0).toFixed(1)}s audio)</span>
      <span>Latency: ${(item.total_latency_ms / 1000).toFixed(2)}s</span>
    </div>
    <div class="hist-en">${escapeHtml(item.corrected || item.original)}</div>
    <div class="hist-trans">${escapeHtml(item.translated || "")}</div>
  `;

  historyList.prepend(div);
  historyEntries.push(item);
  historyCount.textContent = `${historyEntries.length} entries`;
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function populateAudioDevices(devices, selectedIndex) {
  audioDeviceSelect.innerHTML = "";
  devices.forEach((dev) => {
    const opt = document.createElement("option");
    opt.value = dev.index;
    opt.textContent = `${dev.name} (Ch: ${dev.channels})`;
    if (dev.index === selectedIndex) {
      opt.selected = true;
    }
    audioDeviceSelect.appendChild(opt);
  });
}

function updateRecordingState(recording) {
  isRecording = recording;
  if (isRecording) {
    toggleRecordBtn.classList.add("recording");
    recordBtnText.textContent = "Stop Listening";
  } else {
    toggleRecordBtn.classList.remove("recording");
    recordBtnText.textContent = "Start Listening";
    audioMeterFill.style.width = "0%";
    vadStatusBadge.textContent = "Idle";
    vadStatusBadge.classList.remove("speaking");
  }
}

// Event Listeners
toggleRecordBtn.addEventListener("click", async () => {
  const endpoint = isRecording ? "/api/stop" : "/api/start";
  try {
    const res = await fetch(endpoint, { method: "POST" });
    const data = await res.json();
    updateRecordingState(data.is_recording);
  } catch (e) {
    console.error("Failed to toggle recording:", e);
  }
});

btnLangChinese.addEventListener("click", () => setLanguage("Chinese"));
btnLangVietnamese.addEventListener("click", () => setLanguage("Vietnamese"));

async function setLanguage(lang) {
  currentLanguage = lang;
  if (lang === "Chinese") {
    btnLangChinese.classList.add("active");
    btnLangVietnamese.classList.remove("active");
    translationLineLabel.textContent = "Translation (Simplified Chinese)";
  } else {
    btnLangVietnamese.classList.add("active");
    btnLangChinese.classList.remove("active");
    translationLineLabel.textContent = "Translation (Vietnamese)";
  }

  try {
    await fetch("/api/set_language", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: lang })
    });
  } catch (e) {
    console.error("Failed to update language:", e);
  }
}

audioDeviceSelect.addEventListener("change", async (e) => {
  const deviceIndex = parseInt(e.target.value, 10);
  try {
    await fetch("/api/set_device", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_index: deviceIndex })
    });
  } catch (err) {
    console.error("Failed to switch audio device:", err);
  }
});

clearBtn.addEventListener("click", () => {
  historyList.innerHTML = '<div class="empty-state">No speech logged yet. Click "Start Listening" or upload a file.</div>';
  historyEntries = [];
  historyCount.textContent = "0 entries";
  liveEnglishText.innerHTML = '<span class="placeholder">Awaiting speech from instructor...</span>';
  liveTranslationText.innerHTML = '<span class="placeholder">等待讲师语音输入...</span>';
  rawDiffContainer.style.display = "none";
});

// File Upload & Normalization Testing (Assignment § 7)
dropzone.addEventListener("click", () => mediaFileInput.click());

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.style.borderColor = "var(--primary)";
});

dropzone.addEventListener("dragleave", () => {
  dropzone.style.borderColor = "";
});

dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.style.borderColor = "";
  if (e.dataTransfer.files.length > 0) {
    handleFileUpload(e.dataTransfer.files[0]);
  }
});

mediaFileInput.addEventListener("change", (e) => {
  if (e.target.files.length > 0) {
    handleFileUpload(e.target.files[0]);
  }
});

async function handleFileUpload(file) {
  uploadStatus.style.display = "block";
  uploadFileName.textContent = file.name;
  uploadProgressText.textContent = "Normalizing via FFmpeg & processing...";

  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch("/api/upload_media", {
      method: "POST",
      body: formData
    });
    const result = await res.json();
    uploadProgressText.textContent = "Done!";
    setTimeout(() => { uploadStatus.style.display = "none"; }, 3000);
    renderSubtitleResult(result);
  } catch (err) {
    uploadProgressText.textContent = `Error: ${err.message}`;
  }
}

// Start
window.addEventListener("DOMContentLoaded", () => {
  initWebSocket();
});
