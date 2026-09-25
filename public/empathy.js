"use strict";

const elements = {
  generateButton: document.querySelector("#generate-empathy-prompt-button"), nextButton: document.querySelector("#next-empathy-prompt-button"), submitButton: document.querySelector("#submit-empathy-response-button"), promptCard: document.querySelector("#empathy-prompt-card"), context: document.querySelector("#empathy-context"), answerArea: document.querySelector("#empathy-answer-area"), responseInput: document.querySelector("#empathy-response-input"), feedbackView: document.querySelector("#empathy-feedback-view"), statusBox: document.querySelector("#empathy-status-box"), meta: document.querySelector("#empathy-question-meta")
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
  showStatus("正在准备一句新的练习题...", "info");
  try {
    const data = await requestAi({ action: "generate_empathy_prompt", recentPrompts: state.history });
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
    elements.nextButton.disabled = false;
    showStatus("反馈已生成。可以继续下一题。", "success");
    void syncCloudProgress();
  } catch (error) {
    showStatus(error.message || "点评未完成，请稍后再试。", "error");
  } finally { state.loading = false; setLoading(false); }
}

async function requestAi(payload) {
  const response = await fetch("./api/chat", { method: "POST", headers: { "Content-Type": "application/json", ...cloudAuthHeaders() }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求未完成，请稍后再试。");
  return data;
}

function resetForPrompt() {
  state.prompt = null; state.feedback = null;
  elements.promptCard.className = "empathy-prompt-card empty-state";
  elements.promptCard.textContent = "正在准备一句新的练习题...";
  elements.context.className = "empathy-context hidden"; elements.context.textContent = "";
  elements.answerArea.classList.add("hidden"); elements.responseInput.value = "";
  elements.feedbackView.className = "empathy-feedback-view hidden"; elements.feedbackView.innerHTML = "";
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
function promptMeta(prompt) { return prompt.emotionType === "positive" ? "积极情绪" : prompt.emotionType === "complex" ? "复杂情绪" : "一句练习"; }
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
    elements.responseInput.value = payload.responseText || "";
    if (state.prompt?.sentence) {
      elements.promptCard.className = "empathy-prompt-card"; elements.promptCard.textContent = state.prompt.sentence; elements.meta.textContent = promptMeta(state.prompt);
      if (state.prompt.context) { elements.context.textContent = state.prompt.context; elements.context.classList.remove("hidden"); }
      elements.answerArea.classList.remove("hidden");
    }
    if (state.feedback) renderFeedback(state.feedback);
    setLoading(false);
  } catch { showStatus("云端练习记录暂未恢复，本次练习仍可继续。", "info"); }
}

async function syncCloudProgress() {
  if (!window.CBSTCloud?.isSignedIn?.()) return;
  try { await window.CBSTCloud.saveProgress("empathy", { prompt: state.prompt, feedback: state.feedback, history: state.history, responseText: elements.responseInput.value.trim() }); } catch { /* Do not interrupt practice on sync errors. */ }
}

function escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
