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
  meta: document.querySelector("#listening-question-meta")
};
const state = { loading: false, prompt: null, feedback: null, history: [] };
const HISTORY_LIMIT = 18;
let restoredUserId = "";

init();

function init() {
  elements.generateButton.addEventListener("click", generatePrompt);
  elements.nextButton.addEventListener("click", generatePrompt);
  elements.submitButton.addEventListener("click", submitResponse);
  elements.responseInput.addEventListener("input", updateControls);
  window.addEventListener("cbst:authchange", () => void restoreCloudProgress());
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
    elements.nextButton.disabled = false;
    showStatus("反馈已生成。可以继续下一题。", "success");
    void syncCloudProgress();
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
    ${!safety && feedback.heardContent ? `<div class="empathy-detail"><strong>你听见了什么</strong><p>${escapeHtml(feedback.heardContent)}</p></div>` : ""}
    ${renderList(safety ? "回应中已经做到" : "你已经做到", strengths)}
    ${renderList(safety ? "仍需优先补足" : "可以继续调整", adjustments)}
    <div class="listening-reference-reply"><strong>参考回应</strong><p>${escapeHtml(feedback.referenceReply || "")}</p><small>参考示例，不是唯一正确答案。</small></div>
    ${safety && feedback.nextStep ? `<div class="empathy-next-question"><strong>此刻最优先的现实行动</strong><p>${escapeHtml(feedback.nextStep)}</p></div>` : ""}
    ${renderReferences(feedback.courseReferences)}`;
}

function renderList(title, items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  return list.length ? `<div class="empathy-detail"><strong>${escapeHtml(title)}</strong><ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : "";
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
    if (!payload) return;
    state.prompt = payload.prompt || null;
    state.feedback = payload.feedback || null;
    state.history = Array.isArray(payload.history) ? payload.history.slice(0, HISTORY_LIMIT) : [];
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
  } catch { showStatus("云端练习记录暂未恢复，本次练习仍可继续。", "info"); }
}

async function syncCloudProgress() {
  if (!window.CBSTCloud?.isSignedIn?.()) return;
  try { await window.CBSTCloud.saveProgress("listening", { prompt: state.prompt, feedback: state.feedback, history: state.history, responseText: elements.responseInput.value.trim() }); } catch { /* Keep practice usable when sync is unavailable. */ }
}

function escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
