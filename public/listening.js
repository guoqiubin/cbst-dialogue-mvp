"use strict";

const elements = {
  generateButton: document.querySelector("#generate-listening-prompt-button"),
  nextButton: document.querySelector("#next-listening-prompt-button"),
  submitButton: document.querySelector("#submit-listening-response-button"),
  promptCard: document.querySelector("#listening-prompt-card"),
  context: document.querySelector("#listening-context"),
  answerArea: document.querySelector("#listening-answer-area"),
  responseInput: document.querySelector("#listening-response-input"),
  feedbackView: document.querySelector("#listening-feedback-view"),
  statusBox: document.querySelector("#listening-status-box"),
  meta: document.querySelector("#listening-question-meta"),
  historyList: document.querySelector("#listening-history-list"),
  historyCount: document.querySelector("#listening-history-count"),
  exportPanel: document.querySelector("#listening-export-panel"),
  exportButton: document.querySelector("#export-listening-image-button"),
  exportStatus: document.querySelector("#listening-export-status")
};
const HISTORY_LIMIT = 18;
const TRAINING_HISTORY_LIMIT = 40;
const TRAINING_HISTORY_STORAGE_KEY = "cbst-listening-training-history-v1";
const state = { loading: false, prompt: null, feedback: null, history: [], trainingHistory: loadTrainingHistory(), historyExpanded: false };
let restoredUserId = "";

init();

function init() {
  elements.generateButton.addEventListener("click", generatePrompt);
  elements.nextButton.addEventListener("click", generatePrompt);
  elements.submitButton.addEventListener("click", submitResponse);
  elements.responseInput.addEventListener("input", updateControls);
  elements.historyList.addEventListener("click", handleHistoryClick);
  elements.exportButton.addEventListener("click", exportExerciseImage);
  window.addEventListener("cbst:authchange", () => { restoredUserId = ""; void restoreCloudProgress(); });
  renderTrainingHistory();
  void restoreCloudProgress();
}

async function generatePrompt() {
  if (state.loading) return;
  state.loading = true;
  resetForPrompt();
  setLoading(true);
  showStatus("正在准备一段新的表达...", "info");
  try {
    const data = await requestAi({ action: "generate_listening_prompt", recentPrompts: state.history });
    state.prompt = data.prompt;
    state.history = [data.prompt, ...state.history].slice(0, HISTORY_LIMIT);
    elements.promptCard.className = "listening-prompt-card";
    elements.promptCard.textContent = data.prompt.sentence;
    elements.meta.textContent = data.prompt.riskLevel === "high" ? "安全优先情境" : "反映式倾听";
    if (data.prompt.context) {
      elements.context.textContent = data.prompt.context;
      elements.context.classList.remove("hidden");
    }
    elements.answerArea.classList.remove("hidden");
    showStatus("题目已生成。先用自己的话，让对方知道你听见了。", "success");
    void syncCloudProgress();
  } catch (error) {
    showStatus(error.message || "题目生成失败，请稍后再试。", "error");
  } finally {
    state.loading = false;
    setLoading(false);
  }
}

async function submitResponse() {
  if (state.loading || !state.prompt || !elements.responseInput.value.trim() || state.feedback) return;
  state.loading = true;
  setLoading(true);
  showStatus("正在看看这句回应听起来如何...", "info");
  try {
    const data = await requestAi({ action: "evaluate_reflective_listening", prompt: state.prompt, responseText: elements.responseInput.value.trim() });
    state.feedback = data.evaluation;
    renderFeedback(data.evaluation);
    saveTrainingHistory();
    elements.nextButton.disabled = false;
    showStatus("反馈已生成。可以继续下一题。", "success");
    void syncCloudProgress();
    if (window.CBSTCloud?.isSignedIn?.()) void window.CBSTCloud.recordBadgeCompletion("listening").catch(() => {});
  } catch (error) {
    showStatus(error.message || "点评未完成，请稍后再试。", "error");
  } finally {
    state.loading = false;
    setLoading(false);
  }
}

async function requestAi(payload) {
  const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json", ...cloudAuthHeaders() }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求未完成，请稍后再试。");
  return data;
}

function resetForPrompt() {
  state.prompt = null;
  state.feedback = null;
  elements.promptCard.className = "listening-prompt-card empty-state";
  elements.promptCard.textContent = "正在准备一段新的表达...";
  elements.context.className = "empathy-context hidden";
  elements.context.textContent = "";
  elements.answerArea.classList.add("hidden");
  elements.responseInput.value = "";
  elements.feedbackView.className = "listening-feedback-view hidden";
  elements.feedbackView.innerHTML = "";
  elements.exportPanel.classList.add("hidden");
  elements.exportStatus.textContent = "";
  elements.meta.textContent = "正在出题";
  elements.nextButton.disabled = true;
}

function renderFeedback(feedback) {
  const labels = { excellent: "回应贴近且清晰", improvable: "回应方向成立，还可更贴近", rethink: "建议换一种回应方式" };
  const safety = feedback.mode === "safety";
  const strengths = safety ? feedback.safetyStrengths : feedback.strengths;
  const adjustments = safety ? feedback.safetyGaps : feedback.adjustments;
  elements.feedbackView.className = `listening-feedback-view ${escapeHtml(feedback.level || "improvable")}`;
  elements.feedbackView.innerHTML = `
    <div class="feedback-level-head"><span class="feedback-level-badge ${escapeHtml(feedback.level || "improvable")}">${escapeHtml(labels[feedback.level] || labels.improvable)}</span>${safety ? '<span class="safety-label">安全优先情境</span>' : ""}</div>
    <h3>${escapeHtml(feedback.headline || "先让对方知道：你听见了。")}</h3><p>${escapeHtml(feedback.summary || "")}</p>
    ${!safety && feedback.heardContent ? `<div class="listening-feedback-section ${feedback.level === "excellent" ? "success" : "neutral"}"><strong>你听见了什么</strong><p>${escapeHtml(feedback.heardContent)}</p></div>` : ""}
    ${renderList(safety ? "回应中已经做到" : "你已经做到", strengths, "success")}
    ${renderList(safety ? "仍需优先补足" : "可以继续调整", adjustments, "warning")}
    <div class="listening-reference-reply"><strong>参考回应</strong><p>${escapeHtml(feedback.referenceReply || "")}</p><small>参考示例，不是唯一正确答案。</small></div>
    ${safety && feedback.nextStep ? `<div class="empathy-next-question"><strong>此刻最优先的现实行动</strong><p>${escapeHtml(feedback.nextStep)}</p></div>` : ""}
    ${renderReferences(feedback.courseReferences)}`;
  elements.exportPanel.classList.remove("hidden");
}

function renderList(title, items, variant) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  return list.length ? `<div class="listening-feedback-section ${variant}"><strong>${escapeHtml(title)}</strong><ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : "";
}
function renderReferences(items) { const refs = Array.isArray(items) ? items.filter(Boolean) : []; return refs.length ? `<p class="course-references">参考依据：${refs.map(escapeHtml).join(" · ")}</p>` : ""; }
function setLoading(loading) { elements.generateButton.disabled = loading; elements.submitButton.disabled = loading || !state.prompt || !elements.responseInput.value.trim() || Boolean(state.feedback); elements.nextButton.disabled = loading || !state.feedback; }
function updateControls() { setLoading(state.loading); if (state.prompt && !state.feedback) void syncCloudProgress(); }
function showStatus(message, type) { elements.statusBox.className = message ? `status-box ${type || "info"}` : "status-box hidden"; elements.statusBox.textContent = message || ""; }
function cloudAuthHeaders() { const token = window.CBSTCloud?.getAccessToken?.(); return token ? { Authorization: `Bearer ${token}` } : {}; }

async function restoreCloudProgress() {
  const user = window.CBSTCloud?.getUser?.();
  if (!user || restoredUserId === user.id) return;
  restoredUserId = user.id;
  try {
    const payload = await window.CBSTCloud.loadProgress("listening");
    if (!payload) { void syncCloudProgress(); return; }
    state.prompt = payload.prompt || null;
    state.feedback = payload.feedback || null;
    state.history = Array.isArray(payload.history) ? payload.history.slice(0, HISTORY_LIMIT) : [];
    state.trainingHistory = mergeTrainingHistories(state.trainingHistory, payload.trainingHistory);
    persistTrainingHistory();
    renderTrainingHistory();
    elements.responseInput.value = payload.responseText || "";
    if (state.prompt?.sentence) {
      elements.promptCard.className = "listening-prompt-card";
      elements.promptCard.textContent = state.prompt.sentence;
      elements.meta.textContent = state.prompt.riskLevel === "high" ? "安全优先情境" : "反映式倾听";
      if (state.prompt.context) { elements.context.textContent = state.prompt.context; elements.context.classList.remove("hidden"); }
      elements.answerArea.classList.remove("hidden");
    }
    if (state.feedback) renderFeedback(state.feedback);
    setLoading(false);
    void syncCloudProgress();
  } catch { showStatus("云端练习记录暂未恢复，本次练习仍可继续。", "info"); }
}

async function syncCloudProgress() {
  if (!window.CBSTCloud?.isSignedIn?.()) return;
  try { await window.CBSTCloud.saveProgress("listening", { prompt: state.prompt, feedback: state.feedback, history: state.history, trainingHistory: state.trainingHistory, responseText: elements.responseInput.value.trim() }); } catch { /* Keep practice usable when sync is unavailable. */ }
}

function saveTrainingHistory() {
  if (!state.prompt || !state.feedback) return;
  const answer = elements.responseInput.value.trim();
  if (!answer) return;
  const item = {
    id: createId(),
    createdAt: new Date().toISOString(),
    prompt: state.prompt,
    responseText: answer,
    feedback: state.feedback
  };
  state.trainingHistory = [item, ...state.trainingHistory].slice(0, TRAINING_HISTORY_LIMIT);
  persistTrainingHistory();
  renderTrainingHistory();
}

function loadTrainingHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(TRAINING_HISTORY_STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter(isTrainingHistoryItem).slice(0, TRAINING_HISTORY_LIMIT) : [];
  } catch { return []; }
}

function persistTrainingHistory() {
  try { localStorage.setItem(TRAINING_HISTORY_STORAGE_KEY, JSON.stringify(state.trainingHistory)); } catch { /* Storage may be unavailable in private browser contexts. */ }
}

function mergeTrainingHistories(localItems, cloudItems) {
  const merged = new Map();
  [...(Array.isArray(localItems) ? localItems : []), ...(Array.isArray(cloudItems) ? cloudItems : [])]
    .filter(isTrainingHistoryItem)
    .forEach((item) => merged.set(item.id, item));
  return [...merged.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, TRAINING_HISTORY_LIMIT);
}

function isTrainingHistoryItem(item) {
  return Boolean(item && item.id && item.prompt?.sentence && item.responseText && item.feedback);
}

function renderTrainingHistory() {
  const count = state.trainingHistory.length;
  elements.historyCount.textContent = `${count} 条`;
  if (!count) {
    elements.historyList.innerHTML = '<p class="listening-history-empty">完成第一题后，这里会保留题目、你的回应和解析。</p>';
    return;
  }
  const visibleItems = state.historyExpanded ? state.trainingHistory : state.trainingHistory.slice(0, 6);
  elements.historyList.innerHTML = `${visibleItems.map((item) => `
    <button class="listening-history-item" type="button" data-history-id="${escapeHtml(item.id)}">
      <span class="listening-history-item-top"><strong>${escapeHtml(truncate(item.prompt.sentence, 34))}</strong><time>${escapeHtml(formatHistoryDate(item.createdAt))}</time></span>
      <span>${escapeHtml(item.feedback.headline || "查看本题解析")}</span>
    </button>`).join("")}${count > 6 ? `<button class="listening-history-more" type="button" data-history-toggle="true">${state.historyExpanded ? "收起较早记录" : `查看全部 ${count} 条记录`}</button>` : ""}`;
}

function handleHistoryClick(event) {
  if (event.target.closest("[data-history-toggle]")) {
    state.historyExpanded = !state.historyExpanded;
    renderTrainingHistory();
    return;
  }
  const button = event.target.closest("[data-history-id]");
  if (!button) return;
  const item = state.trainingHistory.find((entry) => entry.id === button.dataset.historyId);
  if (!item) return;
  state.prompt = item.prompt;
  state.feedback = item.feedback;
  elements.promptCard.className = "listening-prompt-card";
  elements.promptCard.textContent = item.prompt.sentence;
  elements.meta.textContent = item.prompt.riskLevel === "high" ? "安全优先情境" : "反映式倾听";
  elements.context.textContent = item.prompt.context || "";
  elements.context.className = item.prompt.context ? "empathy-context" : "empathy-context hidden";
  elements.answerArea.classList.remove("hidden");
  elements.responseInput.value = item.responseText;
  renderFeedback(item.feedback);
  setLoading(false);
  showStatus("已打开这次练习记录。", "success");
  void syncCloudProgress();
}

async function exportExerciseImage() {
  if (!state.prompt || !state.feedback) return;
  elements.exportButton.disabled = true;
  elements.exportStatus.textContent = "正在生成图片...";
  try {
    const blob = await canvasToBlob(drawExerciseCanvas());
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `倾听训练-${formatFileDate()}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    elements.exportStatus.textContent = "图片已开始下载。";
  } catch {
    elements.exportStatus.textContent = "图片生成未完成，请稍后再试。";
  } finally { elements.exportButton.disabled = false; }
}

function drawExerciseCanvas() {
  const width = 1080;
  const padding = 76;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const feedback = state.feedback;
  const safety = feedback.mode === "safety";
  const strengths = safety ? feedback.safetyStrengths : feedback.strengths;
  const adjustments = safety ? feedback.safetyGaps : feedback.adjustments;
  const blocks = [];
  const append = (label, value, type = "body") => { if (value) blocks.push({ label, value: String(value), type }); };
  append("题目", state.prompt.sentence, "prompt");
  append("情境", state.prompt.context);
  append("我的回应", elements.responseInput.value.trim(), "answer");
  append("解析", feedback.headline);
  append("点评", feedback.summary);
  append("你听见了什么", feedback.heardContent);
  append(safety ? "回应中已经做到" : "你已经做到", Array.isArray(strengths) ? strengths.filter(Boolean).join("；") : "");
  append(safety ? "仍需优先补足" : "可以继续调整", Array.isArray(adjustments) ? adjustments.filter(Boolean).join("；") : "");
  append("参考回应", feedback.referenceReply, "answer");
  append("课程依据", Array.isArray(feedback.courseReferences) ? feedback.courseReferences.filter(Boolean).join(" · ") : "");

  let height = 280;
  context.font = '32px "Noto Serif SC", "Songti SC", serif';
  for (const block of blocks) {
    const isPrompt = block.type === "prompt";
    height += 78 + wrapLines(context, block.value, width - padding * 2, isPrompt ? 48 : 35).length * (isPrompt ? 62 : 46);
  }
  canvas.width = width;
  canvas.height = Math.max(height + 110, 1120);

  const background = context.createLinearGradient(0, 0, width, canvas.height);
  background.addColorStop(0, "#F5F1EA"); background.addColorStop(0.58, "#E8D8C7"); background.addColorStop(1, "#C4B8A5");
  context.fillStyle = background; context.fillRect(0, 0, width, canvas.height);
  context.fillStyle = "rgba(255,253,248,.79)"; roundRect(context, 34, 34, width - 68, canvas.height - 68, 30); context.fill();
  context.fillStyle = "#456C68"; roundRect(context, padding, 76, 180, 42, 21); context.fill();
  context.fillStyle = "#FFF9F3"; context.font = "700 20px sans-serif"; context.fillText("倾听训练", padding + 28, 104);
  context.fillStyle = "#2A2620"; context.font = '700 52px "Noto Serif SC", "Songti SC", serif'; context.fillText("先听见，再回应", padding, 182);
  context.fillStyle = "#746D63"; context.font = "24px sans-serif"; context.fillText("反映式倾听练习记录", padding, 224);

  let y = 300;
  for (const block of blocks) {
    context.fillStyle = "#456C68"; context.font = "700 22px sans-serif"; context.fillText(block.label.toUpperCase(), padding, y);
    y += 40;
    const isPrompt = block.type === "prompt";
    context.fillStyle = "#2A2620";
    context.font = isPrompt ? '700 43px "Noto Serif SC", "Songti SC", serif' : block.type === "answer" ? '32px "Noto Serif SC", "Songti SC", serif' : '29px "Noto Serif SC", "Songti SC", serif';
    const lineHeight = isPrompt ? 62 : 46;
    wrapLines(context, block.value, width - padding * 2, isPrompt ? 48 : 35).forEach((line) => { context.fillText(line, padding, y); y += lineHeight; });
    y += 38;
    context.strokeStyle = "rgba(196,184,165,.7)"; context.lineWidth = 1; context.beginPath(); context.moveTo(padding, y - 12); context.lineTo(width - padding, y - 12); context.stroke(); y += 16;
  }
  context.fillStyle = "#746D63"; context.font = "20px sans-serif"; context.fillText("托德学院出品 · 仅供沟通学习", padding, canvas.height - 76);
  return canvas;
}

function wrapLines(context, text, maxWidth, maxChars) {
  const result = []; let line = "";
  for (const char of String(text || "")) {
    const next = line + char;
    if (next.length > maxChars || context.measureText(next).width > maxWidth) { if (line) result.push(line); line = char; } else line = next;
  }
  if (line) result.push(line);
  return result;
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  if (typeof context.roundRect === "function") { context.roundRect(x, y, width, height, radius); return; }
  const r = Math.min(radius, width / 2, height / 2);
  context.moveTo(x + r, y); context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r); context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r); context.closePath();
}

function canvasToBlob(canvas) { return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("empty")), "image/png")); }
function createId() { return globalThis.crypto?.randomUUID?.() || `history-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function truncate(value, length) { const text = String(value || ""); return text.length > length ? `${text.slice(0, length)}...` : text; }
function formatHistoryDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "练习记录" : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date); }
function formatFileDate() { const date = new Date(); return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`; }

function escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
