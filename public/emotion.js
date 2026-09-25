"use strict";

const lexicon = window.EMOTION_LEXICON || [];
const clarifiers = window.EMOTION_CLARIFIERS || [];
const elements = {
  tabs: document.querySelector("#emotion-family-tabs"), words: document.querySelector("#emotion-word-grid"), clarifiers: document.querySelector("#emotion-clarifiers"), time: document.querySelector("#emotion-time"), behavior: document.querySelector("#emotion-behavior"), behaviorField: document.querySelector("#behavior-field"), description: document.querySelector("#template-description"), intensity: document.querySelector("#emotion-intensity"), intensityValue: document.querySelector("#intensity-value"), selected: document.querySelector("#selected-emotion-copy"), preview: document.querySelector("#emotion-sentence-preview"), complete: document.querySelector("#complete-emotion-exercise"), reset: document.querySelector("#reset-emotion-exercise"), feedback: document.querySelector("#emotion-feedback"), progress: document.querySelector("#emotion-progress"), templates: [...document.querySelectorAll(".template-button")]
};
const state = { template: "one", family: lexicon[0]?.id || "", emotion: "", intensity: 5, completed: false };
let restoredUserId = "";

init();

function init() {
  elements.clarifiers.innerHTML = clarifiers.map((item) => `<details><summary>${escapeHtml(item.phrase)}</summary><p>${escapeHtml(item.hint)}</p></details>`).join("");
  elements.templates.forEach((button) => button.addEventListener("click", () => setTemplate(button.dataset.template)));
  elements.time.addEventListener("change", updateExpression);
  elements.behavior.addEventListener("input", updateExpression);
  elements.intensity.addEventListener("input", () => { state.intensity = Number(elements.intensity.value); paintIntensity(); updateExpression(); });
  elements.complete.addEventListener("click", completeExercise);
  elements.reset.addEventListener("click", resetExercise);
  window.addEventListener("cbst:authchange", () => void restoreCloudProgress());
  renderFamilies(); paintIntensity(); updateExpression(); void restoreCloudProgress();
}

function setTemplate(template) {
  state.template = template === "two" ? "two" : "one";
  state.completed = false;
  elements.templates.forEach((button) => button.classList.toggle("active", button.dataset.template === state.template));
  elements.behaviorField.classList.toggle("hidden", state.template !== "two");
  elements.description.textContent = state.template === "one" ? "我【时间段】的心情是【情绪词】，强度是【强度分数】。" : "你做了【行为名称】，我的情绪或感受是【情绪词】，强度是【强度分数】。";
  elements.progress.textContent = state.template === "one" ? "第 2 步：选择情绪" : "第 2 步：补充行为与情绪";
  elements.feedback.className = "emotion-feedback hidden";
  updateExpression();
}

function renderFamilies() {
  elements.tabs.innerHTML = lexicon.map((family) => `<button class="emotion-family-button ${family.id === state.family ? "active" : ""}" data-family="${escapeHtml(family.id)}" type="button">${escapeHtml(family.label)}</button>`).join("");
  for (const button of elements.tabs.querySelectorAll("button")) button.addEventListener("click", () => { state.family = button.dataset.family; state.emotion = ""; state.completed = false; renderFamilies(); renderWords(); updateExpression(); });
  renderWords();
}

function renderWords() {
  const family = lexicon.find((item) => item.id === state.family) || lexicon[0];
  elements.words.innerHTML = (family?.words || []).map((word) => `<button class="emotion-word-button ${word === state.emotion ? "selected" : ""}" data-word="${escapeHtml(word)}" type="button">${escapeHtml(word)}</button>`).join("");
  for (const button of elements.words.querySelectorAll("button")) button.addEventListener("click", () => { state.emotion = button.dataset.word; state.completed = false; renderWords(); updateExpression(); });
}

function paintIntensity() {
  const percentage = ((state.intensity - 1) / 9) * 100;
  elements.intensity.style.setProperty("--intensity", `${percentage}%`);
  elements.intensityValue.textContent = `${state.intensity} 分`;
}

function updateExpression() {
  const time = elements.time.value;
  const emotion = state.emotion || "【情绪词】";
  const intensity = `${state.intensity} 分`;
  const behavior = elements.behavior.value.trim() || "【行为名称】";
  elements.selected.textContent = state.emotion ? `已选择：${state.emotion}` : "尚未选择";
  elements.preview.textContent = state.template === "one" ? `我${time}的心情是${emotion}，强度是${intensity}。` : `你做了${behavior}，我的情绪或感受是${emotion}，强度是${intensity}。`;
  elements.complete.disabled = !state.emotion || (state.template === "two" && !elements.behavior.value.trim());
  if (!state.completed) elements.feedback.className = "emotion-feedback hidden";
  void syncCloudProgress();
}

function completeExercise() {
  if (elements.complete.disabled) return;
  state.completed = true;
  const family = lexicon.find((item) => item.id === state.family);
  elements.feedback.className = "emotion-feedback";
  elements.feedback.innerHTML = `<strong>表达已完成</strong><p>你把体验说成了“${escapeHtml(state.emotion)}”，并标记为 ${state.intensity} 分。${state.intensity >= 8 ? "强度较高时，可以先给自己一点暂停与支持，再决定是否沟通。" : "这让感受有了更清晰的边界，也更容易被自己和他人理解。"}</p><span>情绪家族：${escapeHtml(family?.label || "未分类")}</span>`;
  elements.progress.textContent = "本次表达已完成";
  void syncCloudProgress();
}

function resetExercise() {
  state.template = "one"; state.family = lexicon[0]?.id || ""; state.emotion = ""; state.intensity = 5; state.completed = false;
  elements.time.value = "现在"; elements.behavior.value = ""; elements.intensity.value = "5";
  elements.templates.forEach((button) => button.classList.toggle("active", button.dataset.template === "one"));
  elements.behaviorField.classList.add("hidden"); elements.description.textContent = "我【时间段】的心情是【情绪词】，强度是【强度分数】。"; elements.progress.textContent = "第 1 步：选择模板";
  renderFamilies(); paintIntensity(); updateExpression();
}

async function restoreCloudProgress() {
  const user = window.CBSTCloud?.getUser?.();
  if (!user || restoredUserId === user.id) return;
  restoredUserId = user.id;
  try {
    const payload = await window.CBSTCloud.loadProgress("emotion");
    if (!payload) return;
    state.template = payload.template === "two" ? "two" : "one"; state.family = lexicon.some((family) => family.id === payload.family) ? payload.family : state.family; state.emotion = String(payload.emotion || ""); state.intensity = Math.min(10, Math.max(1, Number(payload.intensity || 5))); state.completed = Boolean(payload.completed);
    elements.time.value = payload.time || "现在"; elements.behavior.value = payload.behavior || ""; elements.intensity.value = String(state.intensity);
    elements.templates.forEach((button) => button.classList.toggle("active", button.dataset.template === state.template)); elements.behaviorField.classList.toggle("hidden", state.template !== "two"); elements.description.textContent = state.template === "two" ? "你做了【行为名称】，我的情绪或感受是【情绪词】，强度是【强度分数】。" : "我【时间段】的心情是【情绪词】，强度是【强度分数】。";
    renderFamilies(); paintIntensity(); updateExpression(); if (state.completed) completeExercise();
  } catch { /* Cloud progress is optional for this exercise. */ }
}

async function syncCloudProgress() {
  if (!window.CBSTCloud?.isSignedIn?.()) return;
  try { await window.CBSTCloud.saveProgress("emotion", { template: state.template, family: state.family, emotion: state.emotion, intensity: state.intensity, time: elements.time.value, behavior: elements.behavior.value.trim(), completed: state.completed }); } catch { /* Keep the exercise usable when sync is unavailable. */ }
}

function escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
