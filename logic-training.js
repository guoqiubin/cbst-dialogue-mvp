const LOGIC_OPTIONS = [
  "一些/所有",
  "或许/一定",
  "之前/之后",
  "现在/以后",
  "是/不是",
  "和/或者",
  "如果/那么",
  "为什么/因为",
  "想要/必要",
  "与…有关",
  "公平/不公平"
];

const elements = {
  sceneSelect: document.querySelector("#logic-scene-select"),
  difficultySelect: document.querySelector("#logic-difficulty-select"),
  connectionBanner: document.querySelector("#logic-connection-banner"),
  generateButton: document.querySelector("#generate-logic-question-button"),
  statusBox: document.querySelector("#logic-status-box"),
  questionMeta: document.querySelector("#logic-question-meta"),
  questionCard: document.querySelector("#logic-question-card"),
  answerArea: document.querySelector("#logic-answer-area"),
  optionGrid: document.querySelector("#logic-option-grid"),
  responseInput: document.querySelector("#logic-response-input"),
  submitButton: document.querySelector("#submit-logic-answer-button"),
  nextButton: document.querySelector("#next-logic-question-button"),
  feedbackView: document.querySelector("#logic-feedback-view")
};

const state = {
  loading: false,
  question: null,
  selectedLogic: new Set(),
  feedback: null,
  questionHistory: []
};

const QUESTION_HISTORY_LIMIT = 18;
let cloudRestoredUserId = "";

init();

function init() {
  renderLogicOptions();
  bindEvents();
  window.addEventListener("cbst:authchange", () => void restoreCloudProgress());
  void detectConnection();
  void restoreCloudProgress();
}

function bindEvents() {
  elements.generateButton.addEventListener("click", generateQuestion);
  elements.nextButton.addEventListener("click", generateQuestion);
  elements.submitButton.addEventListener("click", submitAnswer);
  elements.optionGrid.addEventListener("change", handleLogicSelection);
}

async function detectConnection() {
  try {
    const response = await fetch("./api/status", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.serverReady || !data.openaiConfigured) throw new Error("模型未配置");
    elements.connectionBanner.className = "connection-banner ready";
    elements.connectionBanner.textContent = `模型已连通，题目与点评会参考课程知识库。当前模型：${data.model}。`;
  } catch {
    elements.connectionBanner.className = "connection-banner error";
    elements.connectionBanner.textContent = "模型暂未连通。请确认本地服务、密钥配置和网络后再试。";
  }
}

function renderLogicOptions() {
  elements.optionGrid.innerHTML = LOGIC_OPTIONS.map((label) => `
    <label class="logic-choice">
      <input type="checkbox" value="${escapeHtml(label)}" />
      <span>${escapeHtml(label)}</span>
    </label>`).join("");
}

function handleLogicSelection(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.checked) state.selectedLogic.add(input.value);
  else state.selectedLogic.delete(input.value);
  elements.submitButton.disabled = !state.question || !state.selectedLogic.size || state.loading || Boolean(state.feedback);
}

async function generateQuestion() {
  if (state.loading) return;
  state.loading = true;
  resetForNewQuestion();
  setLoadingState(true);
  showStatus("正在根据课程知识库生成训练题...", "info");

  try {
    const response = await fetch("./api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "generate_logic_question",
        config: {
          scene: elements.sceneSelect.value,
          difficulty: elements.difficultySelect.value,
          recentQuestions: state.questionHistory
        }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "生成题目失败");
    state.question = data.question;
    state.questionHistory = [
      {
        sentence: data.question.sentence,
        topic: data.question.topic || "",
        scene: data.question.scene,
        difficulty: data.question.difficulty
      },
      ...state.questionHistory
    ].slice(0, QUESTION_HISTORY_LIMIT);
    elements.questionMeta.textContent = `${state.question.scene} · ${state.question.difficulty}`;
    elements.questionCard.className = "logic-question-card";
    elements.questionCard.textContent = state.question.sentence;
    elements.answerArea.classList.remove("hidden");
    elements.connectionBanner.className = "connection-banner ready";
    elements.connectionBanner.textContent = `模型已连通，本题依据课程知识库生成。当前模型：${data.model}。`;
    void syncCloudProgress();
    showStatus("题目已生成。请先独立判断，再提交。", "success");
  } catch (error) {
    showStatus(error.message || "生成题目失败，请稍后再试。", "error");
  } finally {
    state.loading = false;
    setLoadingState(false);
  }
}

async function submitAnswer() {
  if (!state.question || !state.selectedLogic.size || state.loading || state.feedback) return;
  state.loading = true;
  setLoadingState(true);
  showStatus("正在根据课程规则点评你的判断...", "info");

  try {
    const response = await fetch("./api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "evaluate_logic_answer",
        question: state.question,
        answer: {
          selectedLogic: [...state.selectedLogic],
          responseText: elements.responseInput.value.trim()
        }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "点评失败");
    state.feedback = data.evaluation;
    renderFeedback(state.feedback);
    elements.nextButton.disabled = false;
    void syncCloudProgress();
    showStatus("点评已生成。你可以继续下一题。", "success");
  } catch (error) {
    showStatus(error.message || "点评失败，请稍后再试。", "error");
  } finally {
    state.loading = false;
    setLoadingState(false);
  }
}

function resetForNewQuestion() {
  state.question = null;
  state.selectedLogic.clear();
  state.feedback = null;
  elements.questionMeta.textContent = "正在出题";
  elements.questionCard.className = "logic-question-card empty-state";
  elements.questionCard.textContent = "正在准备一句新的训练题...";
  elements.answerArea.classList.add("hidden");
  elements.responseInput.value = "";
  elements.feedbackView.className = "logic-feedback-view hidden";
  elements.feedbackView.innerHTML = "";
  elements.nextButton.disabled = true;
  for (const input of elements.optionGrid.querySelectorAll("input")) input.checked = false;
}

function renderFeedback(feedback) {
  const levelMeta = {
    excellent: { label: "回答很棒", description: "策略与表达都较贴合。" },
    improvable: { label: "回答成立但可以更好", description: "这条路径可行，还能更具体或自然。" },
    rethink: { label: "建议重新思考", description: "当前路径与题目不够贴合，可以换个角度。" }
  }[feedback.level] || { label: "可以继续推敲", description: "下面看看不同策略如何展开。" };

  const strategyMap = Array.isArray(feedback.strategyMap) ? feedback.strategyMap : [];
  const references = Array.isArray(feedback.courseReferences) ? feedback.courseReferences : [];
  elements.feedbackView.className = `logic-feedback-view ${escapeHtml(feedback.level || "improvable")}`;
  elements.feedbackView.innerHTML = `
    <div class="feedback-level-head">
      <span class="feedback-level-badge ${escapeHtml(feedback.level || "improvable")}">${levelMeta.label}</span>
      <span class="muted-copy">${levelMeta.description}</span>
    </div>
    <h3>${escapeHtml(feedback.headline || "看看这条策略如何打开对话")}</h3>
    <p class="feedback-summary">${escapeHtml(feedback.summary || "")}</p>
    <div class="feedback-block">
      <strong>你选择的策略</strong>
      <p>${escapeHtml(feedback.selectedFeedback || "")}</p>
    </div>
    ${feedback.responseFeedback ? `<div class="feedback-block"><strong>你的回应</strong><p>${escapeHtml(feedback.responseFeedback)}</p></div>` : ""}
    <div class="strategy-map">
      <strong>本题可行策略地图</strong>
      <div class="strategy-map-list">${strategyMap.map(renderStrategy).join("")}</div>
    </div>
    <div class="course-reference"><strong>课程依据</strong><span>${references.map(escapeHtml).join("　") || "CBST 课程知识库"}</span></div>`;
}

function renderStrategy(item) {
  return `<article class="strategy-item ${item.selectedByUser ? "selected" : ""}">
    <div><span class="tag">${escapeHtml(item.logicLabel)}</span>${item.selectedByUser ? '<span class="selected-note">你已选择</span>' : ""}</div>
    <p>${escapeHtml(item.reason || "")}</p>
  </article>`;
}

function setLoadingState(loading) {
  elements.generateButton.disabled = loading;
  elements.submitButton.disabled = loading || !state.question || !state.selectedLogic.size || Boolean(state.feedback);
  elements.nextButton.disabled = loading || !state.feedback;
  elements.generateButton.textContent = loading && !state.question ? "正在生成..." : "生成一句训练题";
  elements.submitButton.textContent = loading && state.question ? "正在点评..." : "提交判断";
}

async function restoreCloudProgress() {
  const user = window.CBSTCloud?.getUser?.();
  if (!user || cloudRestoredUserId === user.id) return;
  cloudRestoredUserId = user.id;
  try {
    const payload = await window.CBSTCloud.loadProgress("logic-training");
    if (!payload) {
      await syncCloudProgress();
      return;
    }
    elements.sceneSelect.value = payload.scene || elements.sceneSelect.value;
    elements.difficultySelect.value = payload.difficulty || elements.difficultySelect.value;
    state.question = payload.question || null;
    state.questionHistory = Array.isArray(payload.questionHistory)
      ? payload.questionHistory.slice(0, QUESTION_HISTORY_LIMIT)
      : [];
    state.feedback = payload.feedback || null;
    state.selectedLogic = new Set(Array.isArray(payload.selectedLogic) ? payload.selectedLogic : []);
    elements.responseInput.value = payload.responseText || "";
    if (state.question) {
      elements.questionMeta.textContent = state.question.scene + " · " + state.question.difficulty;
      elements.questionCard.className = "logic-question-card";
      elements.questionCard.textContent = state.question.sentence;
      elements.answerArea.classList.remove("hidden");
      for (const input of elements.optionGrid.querySelectorAll("input")) {
        input.checked = state.selectedLogic.has(input.value);
      }
    }
    if (state.feedback) {
      renderFeedback(state.feedback);
      elements.nextButton.disabled = false;
    }
    setLoadingState(false);
  } catch {
    cloudRestoredUserId = "";
  }
}

async function syncCloudProgress() {
  if (!window.CBSTCloud?.isSignedIn?.()) return;
  try {
    await window.CBSTCloud.saveProgress("logic-training", {
      scene: elements.sceneSelect.value,
      difficulty: elements.difficultySelect.value,
      question: state.question,
      questionHistory: state.questionHistory,
      selectedLogic: [...state.selectedLogic],
      responseText: elements.responseInput.value,
      feedback: state.feedback
    });
  } catch {
    // A later completed exercise will retry the cloud save.
  }
}

function showStatus(message, type) {
  elements.statusBox.className = `status-box ${type}`;
  elements.statusBox.textContent = message;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
