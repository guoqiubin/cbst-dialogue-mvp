"use strict";

const elements = {
  generateButton: document.querySelector("#generate-empathy-prompt-button"), nextButton: document.querySelector("#next-empathy-prompt-button"), submitButton: document.querySelector("#submit-empathy-response-button"), promptCard: document.querySelector("#empathy-prompt-card"), context: document.querySelector("#empathy-context"), answerArea: document.querySelector("#empathy-answer-area"), responseInput: document.querySelector("#empathy-response-input"), feedbackView: document.querySelector("#empathy-feedback-view"), statusBox: document.querySelector("#empathy-status-box"), meta: document.querySelector("#empathy-question-meta"), complexitySelect: document.querySelector("#empathy-complexity-select"), sharePanel: document.querySelector("#empathy-share-panel"), generateShareButton: document.querySelector("#generate-empathy-share-button"), copyShareButton: document.querySelector("#copy-empathy-share-button"), downloadShareButton: document.querySelector("#download-empathy-share-button"), sharePreview: document.querySelector("#empathy-share-preview"), shareStatus: document.querySelector("#empathy-share-status")
};
const state = { loading: false, prompt: null, feedback: null, history: [], shareImageUrl: "" };
const HISTORY_LIMIT = 18;
let restoredUserId = "";

init();

function init() {
  elements.generateButton.addEventListener("click", generatePrompt);
  elements.nextButton.addEventListener("click", generatePrompt);
  elements.submitButton.addEventListener("click", submitResponse);
  elements.responseInput.addEventListener("input", updateControls);
  elements.complexitySelect.addEventListener("change", () => { clearShareImage(); void syncCloudProgress(); });
  elements.generateShareButton.addEventListener("click", generateShareImage);
  elements.copyShareButton.addEventListener("click", copyShareImage);
  elements.downloadShareButton.addEventListener("click", downloadShareImage);
  window.addEventListener("cbst:authchange", () => void restoreCloudProgress());
  void restoreCloudProgress();
}

async function generatePrompt() {
  if (state.loading) return;
  state.loading = true;
  resetForPrompt();
  setLoading(true);
  showStatus("正在准备一句新的练习题...", "info");
  try {
    const data = await requestAi({ action: "generate_empathy_prompt", recentPrompts: state.history, emotionComplexity: elements.complexitySelect.value });
    state.prompt = data.prompt;
    state.history = [data.prompt, ...state.history].slice(0, HISTORY_LIMIT);
    elements.promptCard.className = "empathy-prompt-card";
    elements.promptCard.textContent = data.prompt.sentence;
    elements.meta.textContent = promptMeta(data.prompt);
    if (data.prompt.context) { elements.context.textContent = data.prompt.context; elements.context.classList.remove("hidden"); }
    elements.answerArea.classList.remove("hidden");
    showStatus("题目已生成。请按你的理解写下回应。", "success");
    void syncCloudProgress();
  } catch (error) {
    showStatus(error.message || "题目生成失败，请稍后再试。", "error");
  } finally { state.loading = false; setLoading(false); }
}

async function submitResponse() {
  if (state.loading || !state.prompt || !elements.responseInput.value.trim() || state.feedback) return;
  state.loading = true;
  setLoading(true);
  showStatus("正在分析这句回应...", "info");
  try {
    const data = await requestAi({ action: "evaluate_empathy_response", prompt: state.prompt, responseText: elements.responseInput.value.trim() });
    state.feedback = data.evaluation;
    renderFeedback(data.evaluation);
    elements.sharePanel.classList.remove("hidden");
    elements.nextButton.disabled = false;
    showStatus("反馈已生成。可以继续下一题。", "success");
    void syncCloudProgress();
  } catch (error) {
    showStatus(error.message || "点评未完成，请稍后再试。", "error");
  } finally { state.loading = false; setLoading(false); }
}

async function requestAi(payload) {
  const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json", ...cloudAuthHeaders() }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求未完成，请稍后再试。");
  return data;
}

function resetForPrompt() {
  state.prompt = null; state.feedback = null;
  clearShareImage();
  elements.promptCard.className = "empathy-prompt-card empty-state";
  elements.promptCard.textContent = "正在准备一句新的练习题...";
  elements.context.className = "empathy-context hidden"; elements.context.textContent = "";
  elements.answerArea.classList.add("hidden"); elements.responseInput.value = "";
  elements.feedbackView.className = "empathy-feedback-view hidden"; elements.feedbackView.innerHTML = "";
  elements.sharePanel.classList.add("hidden");
  elements.meta.textContent = "正在出题"; elements.nextButton.disabled = true;
}

function renderFeedback(feedback) {
  const labels = { excellent: "回应很有承接力", improvable: "回应方向成立，还可更贴近", rethink: "建议换一种回应方式" };
  const safety = feedback.mode === "safety";
  const strengths = safety ? feedback.safetyStrengths : feedback.strengths;
  const adjustments = safety ? feedback.safetyGaps : feedback.adjustments;
  elements.feedbackView.className = `empathy-feedback-view ${escapeHtml(feedback.level || "improvable")}`;
  elements.feedbackView.innerHTML = `
    <div class="feedback-level-head"><span class="feedback-level-badge ${escapeHtml(feedback.level || "improvable")}">${escapeHtml(labels[feedback.level] || labels.improvable)}</span>${safety ? '<span class="safety-label">安全优先情境</span>' : ""}</div>
    <h3>${escapeHtml(feedback.headline || "看看这句回应如何被对方听见。")}</h3><p>${escapeHtml(feedback.summary || "")}</p>
    ${!safety && feedback.emotionRecognition ? `<div class="empathy-detail"><strong>对情绪与处境的识别</strong><p>${escapeHtml(feedback.emotionRecognition)}</p></div>` : ""}
    ${renderList(safety ? "回应中已经做到" : "你已经做到", strengths)}
    ${renderList(safety ? "仍需优先补足" : "可以继续调整", adjustments)}
    <div class="empathy-model-reply"><strong>一种更合适的回应示范</strong><p>${escapeHtml(feedback.improvedReply || "")}</p></div>
    <div class="empathy-next-question"><strong>${safety ? "此刻最优先的现实行动" : "可以继续了解的一句话"}</strong><p>${escapeHtml(safety ? feedback.nextStep || "" : feedback.nextQuestion || "")}</p></div>
    ${renderReferences(feedback.courseReferences)}`;
}

function renderList(title, items) { const list = Array.isArray(items) ? items.filter(Boolean) : []; return list.length ? `<div class="empathy-detail"><strong>${escapeHtml(title)}</strong><ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""; }
function renderReferences(items) { const refs = Array.isArray(items) ? items.filter(Boolean) : []; return refs.length ? `<p class="course-references">参考依据：${refs.map(escapeHtml).join(" · ")}</p>` : ""; }
function promptMeta(prompt) { return prompt.riskLevel === "high" ? "安全优先情境" : prompt.emotionComplexity === "complex" || prompt.emotionType === "complex" ? "复杂情绪" : prompt.emotionType === "positive" ? "积极情绪" : "单一情绪"; }
function setLoading(loading) { elements.generateButton.disabled = loading; elements.submitButton.disabled = loading || !state.prompt || !elements.responseInput.value.trim() || Boolean(state.feedback); elements.nextButton.disabled = loading || !state.feedback; }
function updateControls() { setLoading(state.loading); if (state.prompt && !state.feedback) void syncCloudProgress(); }
function showStatus(message, type) { elements.statusBox.className = message ? `status-box ${type || "info"}` : "status-box hidden"; elements.statusBox.textContent = message || ""; }
function cloudAuthHeaders() { const token = window.CBSTCloud?.getAccessToken?.(); return token ? { Authorization: `Bearer ${token}` } : {}; }

async function restoreCloudProgress() {
  const user = window.CBSTCloud?.getUser?.();
  if (!user || restoredUserId === user.id) return;
  restoredUserId = user.id;
  try {
    const payload = await window.CBSTCloud.loadProgress("empathy");
    if (!payload) return;
    state.prompt = payload.prompt || null; state.feedback = payload.feedback || null; state.history = Array.isArray(payload.history) ? payload.history.slice(0, HISTORY_LIMIT) : [];
    elements.complexitySelect.value = payload.emotionComplexity === "complex" ? "complex" : "simple";
    elements.responseInput.value = payload.responseText || "";
    if (state.prompt?.sentence) {
      elements.promptCard.className = "empathy-prompt-card"; elements.promptCard.textContent = state.prompt.sentence; elements.meta.textContent = promptMeta(state.prompt);
      if (state.prompt.context) { elements.context.textContent = state.prompt.context; elements.context.classList.remove("hidden"); }
      elements.answerArea.classList.remove("hidden");
    }
    if (state.feedback) { renderFeedback(state.feedback); elements.sharePanel.classList.remove("hidden"); }
    setLoading(false);
  } catch { showStatus("云端练习记录暂未恢复，本次练习仍可继续。", "info"); }
}

async function syncCloudProgress() {
  if (!window.CBSTCloud?.isSignedIn?.()) return;
  try { await window.CBSTCloud.saveProgress("empathy", { prompt: state.prompt, feedback: state.feedback, history: state.history, responseText: elements.responseInput.value.trim(), emotionComplexity: elements.complexitySelect.value }); } catch { /* Do not interrupt practice on sync errors. */ }
}

async function generateShareImage() {
  if (!state.prompt || !state.feedback) return;
  elements.generateShareButton.disabled = true;
  elements.shareStatus.textContent = "正在生成长图...";
  try {
    const canvas = drawShareCanvas();
    const blob = await canvasToBlob(canvas);
    clearShareImage();
    state.shareImageUrl = URL.createObjectURL(blob);
    elements.sharePreview.src = state.shareImageUrl;
    elements.sharePreview.classList.remove("hidden");
    elements.copyShareButton.classList.remove("hidden");
    elements.downloadShareButton.classList.remove("hidden");
    elements.shareStatus.textContent = "长图已生成，可复制或下载。";
  } catch {
    elements.shareStatus.textContent = "长图生成未完成，请稍后重试。";
  } finally { elements.generateShareButton.disabled = false; }
}

async function copyShareImage() {
  if (!state.shareImageUrl) return;
  try {
    const blob = await (await fetch(state.shareImageUrl)).blob();
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("unsupported");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    elements.shareStatus.textContent = "图片已复制，可直接粘贴分享。";
  } catch {
    elements.shareStatus.textContent = "当前浏览器不支持复制图片，请使用“下载图片”。";
  }
}

function downloadShareImage() {
  if (!state.shareImageUrl) return;
  const link = document.createElement("a");
  link.href = state.shareImageUrl;
  link.download = "共情训练-题目与解析.png";
  link.click();
  elements.shareStatus.textContent = "图片已开始下载。";
}

function clearShareImage() {
  if (state.shareImageUrl) URL.revokeObjectURL(state.shareImageUrl);
  state.shareImageUrl = "";
  elements.sharePreview.removeAttribute("src");
  elements.sharePreview.classList.add("hidden");
  elements.copyShareButton.classList.add("hidden");
  elements.downloadShareButton.classList.add("hidden");
  elements.shareStatus.textContent = "";
}

function drawShareCanvas() {
  const width = 1080;
  const padding = 76;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const lines = [];
  const append = (label, value, type = "body") => { if (value) lines.push({ label, value: String(value), type }); };
  const feedback = state.feedback;
  const strengths = Array.isArray(feedback.mode === "safety" ? feedback.safetyStrengths : feedback.strengths)
    ? (feedback.mode === "safety" ? feedback.safetyStrengths : feedback.strengths) : [];
  const adjustments = Array.isArray(feedback.mode === "safety" ? feedback.safetyGaps : feedback.adjustments)
    ? (feedback.mode === "safety" ? feedback.safetyGaps : feedback.adjustments) : [];
  append("题目", state.prompt.sentence, "prompt");
  append("情境", state.prompt.context);
  append("我的回应", elements.responseInput.value.trim(), "answer");
  append("点评", feedback.headline);
  append("解析", feedback.summary);
  append("已做到", strengths.filter(Boolean).join("；"));
  append("可调整", adjustments.filter(Boolean).join("；"));
  append("示范回应", feedback.improvedReply, "answer");
  append(feedback.mode === "safety" ? "现实行动" : "继续了解", feedback.mode === "safety" ? feedback.nextStep : feedback.nextQuestion);
  append("课程依据", (feedback.courseReferences || []).filter(Boolean).join(" · "));

  let height = 270;
  context.font = '32px "Noto Serif SC", "Songti SC", serif';
  for (const item of lines) height += 78 + wrapLines(context, item.value, width - padding * 2, item.type === "prompt" ? 48 : 35).length * (item.type === "prompt" ? 62 : 46);
  height += 110;
  canvas.width = width;
  canvas.height = Math.max(height, 1100);

  const background = context.createLinearGradient(0, 0, width, canvas.height);
  background.addColorStop(0, "#F5F1EA"); background.addColorStop(0.58, "#F2DDD0"); background.addColorStop(1, "#D9C9B8");
  context.fillStyle = background; context.fillRect(0, 0, width, canvas.height);
  context.fillStyle = "rgba(255,253,248,.76)"; roundRect(context, 34, 34, width - 68, canvas.height - 68, 30); context.fill();
  context.fillStyle = "#E85D4E"; roundRect(context, padding, 76, 180, 42, 21); context.fill();
  context.fillStyle = "#FFF9F3"; context.font = "700 20px sans-serif"; context.fillText("共情训练", padding + 28, 104);
  context.fillStyle = "#2A2620"; context.font = '700 52px "Noto Serif SC", "Songti SC", serif'; context.fillText("一句回应，一次靠近", padding, 182);
  context.fillStyle = "#746D63"; context.font = "24px sans-serif"; context.fillText(state.prompt.emotionComplexity === "complex" ? "复杂情绪练习" : "单一情绪练习", padding, 224);

  let y = 300;
  for (const item of lines) {
    context.fillStyle = "#E85D4E"; context.font = "700 22px sans-serif"; context.fillText(item.label.toUpperCase(), padding, y);
    y += 40;
    context.fillStyle = "#2A2620";
    context.font = item.type === "prompt" ? '700 43px "Noto Serif SC", "Songti SC", serif' : item.type === "answer" ? '32px "Noto Serif SC", "Songti SC", serif' : '29px "Noto Serif SC", "Songti SC", serif';
    const lineHeight = item.type === "prompt" ? 62 : 46;
    const wrapped = wrapLines(context, item.value, width - padding * 2, item.type === "prompt" ? 48 : 35);
    for (const line of wrapped) { context.fillText(line, padding, y); y += lineHeight; }
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

function escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
