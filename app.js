const MEMORY_KEY = "cbst-dialogue-mvp-memory-v5";

const LOGIC_REFERENCE = [
  { label: "一些 / 所有", purpose: "把整体化判断拆成局部事实", valueTag: "乐观" },
  { label: "或许 / 一定", purpose: "降低绝对化表达", valueTag: "乐观" },
  { label: "之前 / 之后", purpose: "让变化过程变得可讨论", valueTag: "乐观" },
  { label: "现在 / 以后", purpose: "区分当下状态和未来可能", valueTag: "乐观" },
  { label: "是 / 不是", purpose: "澄清定义和边界", valueTag: "分解" },
  { label: "和 / 或者", purpose: "帮助看到不止一个选项", valueTag: "利他" },
  { label: "如果 / 那么", purpose: "推动后果思考与执行", valueTag: "真实" },
  { label: "为什么 / 因为", purpose: "寻找原因，不急于评价", valueTag: "真实" },
  { label: "想要 / 必要", purpose: "区分愿望和必须", valueTag: "有效" },
  { label: "与…有关", purpose: "把问题与人格做分离", valueTag: "分离" },
  { label: "公平 / 不公平", purpose: "回到尊重与边界", valueTag: "公平" }
];

const ROLE_PRESETS = {
  "parent-child": {
    aiRoles: ["爸爸", "妈妈", "家长"],
    userRoles: ["儿子", "女儿", "孩子"]
  },
  intimacy: {
    aiRoles: ["男友", "女友", "伴侣"],
    userRoles: ["女友", "男友", "伴侣"]
  },
  workplace: {
    aiRoles: ["领导", "同事", "客户"],
    userRoles: ["员工", "同事", "下属"]
  },
  parents: {
    aiRoles: ["爸爸", "妈妈", "长辈"],
    userRoles: ["儿子", "女儿", "成年子女"]
  }
};

const LOGIC_PATTERNS = [
  /一些|所有/,
  /或许|一定|总是/,
  /之前|之后/,
  /现在|以后/,
  /是|不是/,
  /和|或者|还是/,
  /如果|那么/,
  /为什么|因为/,
  /想要|必要|需要/,
  /有关/,
  /公平|不公平/
];

const state = {
  config: null,
  generatedCase: null,
  transcript: [],
  loading: false,
  finished: false,
  evaluation: null,
  hintExpanded: false,
  allowForceSubmit: false,
  connection: {
    phase: "checking",
    label: "正在检查模型连接状态..."
  },
  roleOptions: {
    aiRoles: [],
    userRoles: []
  }
};

let cloudRestoredUserId = "";

const elements = {
  sceneSelect: document.querySelector("#scene-select"),
  aiRoleSelect: document.querySelector("#ai-role-select"),
  aiRoleCustomInput: document.querySelector("#ai-role-custom-input"),
  userRoleSelect: document.querySelector("#user-role-select"),
  userRoleCustomInput: document.querySelector("#user-role-custom-input"),
  swapRolesButton: document.querySelector("#swap-roles-button"),
  eventEditor: document.querySelector("#event-editor"),
  generatorForm: document.querySelector("#generator-form"),
  resetMemoryButton: document.querySelector("#reset-memory-button"),
  connectionBanner: document.querySelector("#connection-banner"),
  statusBox: document.querySelector("#status-box"),
  caseCard: document.querySelector("#case-card"),
  focusTitle: document.querySelector("#focus-title"),
  focusBrief: document.querySelector("#focus-brief"),
  turnIndicator: document.querySelector("#turn-indicator"),
  hintToggleButton: document.querySelector("#hint-toggle-button"),
  hintPanel: document.querySelector("#hint-panel"),
  hintSummary: document.querySelector("#hint-summary"),
  hintTags: document.querySelector("#hint-tags"),
  validationPanel: document.querySelector("#validation-panel"),
  validationMessage: document.querySelector("#validation-message"),
  validationTags: document.querySelector("#validation-tags"),
  validationCloseButton: document.querySelector("#validation-close-button"),
  forceSubmitButton: document.querySelector("#force-submit-button"),
  responseInput: document.querySelector("#response-input"),
  submitTurnButton: document.querySelector("#submit-turn-button"),
  endDialogueButton: document.querySelector("#end-dialogue-button"),
  conversationView: document.querySelector("#conversation-view"),
  evaluationView: document.querySelector("#evaluation-view"),
  logicReference: document.querySelector("#logic-reference")
};

init();

function init() {
  restoreMemory();
  renderRoleSelects();
  renderConnectionBanner();
  renderLogicReference();
  renderCaseCard();
  renderComposer();
  renderConversation();
  bindEvents();
  window.addEventListener("cbst:authchange", () => void restoreCloudDialogue());
  void detectConnection();
  void restoreCloudDialogue();
}

function bindEvents() {
  elements.sceneSelect.addEventListener("change", handleSceneChange);
  elements.aiRoleSelect.addEventListener("change", persistMemory);
  elements.userRoleSelect.addEventListener("change", persistMemory);
  elements.eventEditor.addEventListener("input", persistMemory);
  elements.aiRoleCustomInput.addEventListener("keydown", (event) => handleCustomRoleInput(event, "ai"));
  elements.userRoleCustomInput.addEventListener("keydown", (event) => handleCustomRoleInput(event, "user"));
  elements.swapRolesButton.addEventListener("click", swapRoles);
  elements.generatorForm.addEventListener("submit", handleGenerateCase);
  elements.resetMemoryButton.addEventListener("click", resetMemoryAndForm);
  elements.hintToggleButton.addEventListener("click", toggleHintPanel);
  elements.validationCloseButton.addEventListener("click", () => {
    state.allowForceSubmit = false;
    renderValidationPanel();
  });
  elements.forceSubmitButton.addEventListener("click", () => {
    state.allowForceSubmit = true;
    renderValidationPanel();
    submitTurn();
  });
  elements.submitTurnButton.addEventListener("click", submitTurn);
  elements.endDialogueButton.addEventListener("click", endDialogue);
}

function handleSceneChange() {
  const currentScene = elements.sceneSelect.value;
  state.roleOptions = buildRoleOptions(currentScene);
  renderRoleSelects();
  persistMemory();
}

function handleCustomRoleInput(event, kind) {
  if (event.key !== "Enter") return;
  event.preventDefault();

  const input = kind === "ai" ? elements.aiRoleCustomInput : elements.userRoleCustomInput;
  const select = kind === "ai" ? elements.aiRoleSelect : elements.userRoleSelect;
  const value = normalizeRoleValue(input.value);
  if (!value) return;

  if (!state.roleOptions.aiRoles.includes(value)) {
    state.roleOptions.aiRoles.push(value);
  }

  if (!state.roleOptions.userRoles.includes(value)) {
    state.roleOptions.userRoles.push(value);
  }

  renderRoleSelects();
  select.value = value;
  input.value = "";
  persistMemory();
}

function buildRoleOptions(scene, memory = {}) {
  const preset = ROLE_PRESETS[scene] || ROLE_PRESETS["parent-child"];
  const sharedRoles = mergeUnique(
    preset.aiRoles,
    preset.userRoles,
    memory.aiRoleOptions || [],
    memory.userRoleOptions || []
  );

  return {
    aiRoles: [...sharedRoles],
    userRoles: [...sharedRoles]
  };
}

function renderRoleSelects() {
  renderSelectOptions(elements.aiRoleSelect, state.roleOptions.aiRoles);
  renderSelectOptions(elements.userRoleSelect, state.roleOptions.userRoles);
}

function renderSelectOptions(select, values) {
  const previous = select.value;
  select.innerHTML = values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  if (values.includes(previous)) {
    select.value = previous;
  } else {
    select.value = values[0] || "";
  }
}

function swapRoles() {
  const nextAiRole = elements.userRoleSelect.value;
  const nextUserRole = elements.aiRoleSelect.value;
  elements.aiRoleSelect.value = nextAiRole;
  elements.userRoleSelect.value = nextUserRole;
  persistMemory();
}

function persistMemory() {
  safeSetMemory(MEMORY_KEY, {
    scene: elements.sceneSelect.value,
    aiRole: elements.aiRoleSelect.value,
    userRole: elements.userRoleSelect.value,
    aiRoleOptions: state.roleOptions.aiRoles,
    userRoleOptions: state.roleOptions.userRoles,
    eventText: getEditorText()
  });
  void syncCloudDialogue();
}

function restoreMemory() {
  const payload = safeGetMemory(MEMORY_KEY) || {};
  elements.sceneSelect.value = payload.scene || "parent-child";
  state.roleOptions = buildRoleOptions(elements.sceneSelect.value, payload);
  renderRoleSelects();
  elements.aiRoleSelect.value = state.roleOptions.aiRoles.includes(payload.aiRole) ? payload.aiRole : state.roleOptions.aiRoles[0] || "";
  elements.userRoleSelect.value = state.roleOptions.userRoles.includes(payload.userRole) ? payload.userRole : state.roleOptions.userRoles[0] || "";
  setEditorText(payload.eventText || "");
}

function resetMemoryAndForm() {
  safeRemoveMemory(MEMORY_KEY);
  void window.CBSTCloud?.removeProgress("dialogue");
  state.config = null;
  state.generatedCase = null;
  state.transcript = [];
  state.loading = false;
  state.finished = false;
  state.evaluation = null;
  state.hintExpanded = false;
  state.allowForceSubmit = false;

  elements.sceneSelect.value = "parent-child";
  state.roleOptions = buildRoleOptions("parent-child");
  renderRoleSelects();
  elements.aiRoleCustomInput.value = "";
  elements.userRoleCustomInput.value = "";
  setEditorText("");
  elements.responseInput.value = "";
  elements.evaluationView.classList.add("hidden");
  clearStatus();
  renderCaseCard();
  renderComposer();
  renderConversation();
  renderValidationPanel();
}

async function restoreCloudDialogue() {
  const user = window.CBSTCloud?.getUser?.();
  if (!user || cloudRestoredUserId === user.id) return;
  cloudRestoredUserId = user.id;
  try {
    const payload = await window.CBSTCloud.loadProgress("dialogue");
    if (!payload) {
      await syncCloudDialogue();
      return;
    }
    elements.sceneSelect.value = payload.scene || "parent-child";
    state.roleOptions = buildRoleOptions(elements.sceneSelect.value, payload);
    renderRoleSelects();
    elements.aiRoleSelect.value = state.roleOptions.aiRoles.includes(payload.aiRole)
      ? payload.aiRole
      : state.roleOptions.aiRoles[0] || "";
    elements.userRoleSelect.value = state.roleOptions.userRoles.includes(payload.userRole)
      ? payload.userRole
      : state.roleOptions.userRoles[0] || "";
    setEditorText(payload.eventText || "");
    state.config = payload.config || null;
    state.generatedCase = payload.generatedCase || null;
    state.transcript = Array.isArray(payload.transcript) ? payload.transcript : [];
    state.finished = Boolean(payload.finished);
    state.evaluation = payload.evaluation || null;
    state.hintExpanded = false;
    state.allowForceSubmit = false;
    renderCaseCard();
    renderComposer();
    renderConversation();
    renderEvaluation();
    safeSetMemory(MEMORY_KEY, {
      scene: elements.sceneSelect.value,
      aiRole: elements.aiRoleSelect.value,
      userRole: elements.userRoleSelect.value,
      aiRoleOptions: state.roleOptions.aiRoles,
      userRoleOptions: state.roleOptions.userRoles,
      eventText: getEditorText()
    });
  } catch {
    cloudRestoredUserId = "";
  }
}

async function syncCloudDialogue() {
  if (!window.CBSTCloud?.isSignedIn?.()) return;
  try {
    await window.CBSTCloud.saveProgress("dialogue", {
      scene: elements.sceneSelect.value,
      aiRole: elements.aiRoleSelect.value,
      userRole: elements.userRoleSelect.value,
      aiRoleOptions: state.roleOptions.aiRoles,
      userRoleOptions: state.roleOptions.userRoles,
      eventText: getEditorText(),
      config: state.config,
      generatedCase: state.generatedCase,
      transcript: state.transcript,
      finished: state.finished,
      evaluation: state.evaluation
    });
  } catch {
    // The local draft remains available and a later save retries cloud sync.
  }
}

async function handleGenerateCase(event) {
  event.preventDefault();
  if (state.loading) return;

  const config = collectConfig();
  if (!config.eventText) {
    showStatus("请先输入事件描述，再生成案例。", "error");
    return;
  }

  state.loading = true;
  state.finished = false;
  state.evaluation = null;
  state.config = config;
  state.hintExpanded = false;
  state.allowForceSubmit = false;
  persistMemory();
  showStatus("正在生成案例和第一句话...", "info");
  renderComposer();

  try {
    const result = await callApi("generate_case", { config });
    markConnectionLive("模型已连通，当前对话正在使用真实生成。");
    state.generatedCase = result.case;
    state.transcript = [
      {
        type: "system",
        speaker: state.generatedCase.aiRole,
        text: state.generatedCase.openingLine,
        meta: "AI 生成案例开场",
        hintWords: state.generatedCase.logicHints || [],
        hintReason: state.generatedCase.hintReason || ""
      }
    ];
    elements.responseInput.value = "";
    elements.evaluationView.classList.add("hidden");
    showStatus("案例已生成，现在可以开始作答。", "success");
    renderCaseCard();
    renderComposer();
    renderConversation();
    renderValidationPanel();
    persistMemory();
  } catch (error) {
    showStatus(error.message || "生成案例失败，请稍后再试。", "error");
  } finally {
    state.loading = false;
    renderComposer();
  }
}

function submitTurn() {
  if (!state.generatedCase || state.loading || state.finished) return;
  const reply = elements.responseInput.value.trim();
  if (!reply) {
    showStatus("请先输入你的回复。", "error");
    return;
  }

  if (!state.allowForceSubmit && !containsLogicWords(reply)) {
    state.hintExpanded = true;
    renderComposer();
    renderValidationPanel(getCurrentHintWords(), "你这句还没有明显体现 CBST 逻辑字词，建议先修改。");
    showStatus("请尽量使用 CBST 逻辑字词进行回复。", "error");
    return;
  }

  state.allowForceSubmit = false;
  renderValidationPanel();
  continueDialogue(reply);
}

async function continueDialogue(reply) {
  state.loading = true;
  clearStatus();
  renderComposer();

  state.transcript.push({
    type: "user",
    speaker: state.generatedCase.userRole,
    text: reply,
    meta: `用户第 ${getUserTurnCount() + 1} 轮回复`
  });
  renderConversation();

  try {
    const result = await callApi("continue_dialogue", {
      config: state.config,
      caseData: state.generatedCase,
      transcript: state.transcript
    });
    markConnectionLive("模型已连通，当前对话正在使用真实生成。");
    state.transcript.push({
      type: "system",
      speaker: state.generatedCase.aiRole,
      text: result.reply.counterpartReply,
      meta: result.reply.meta || "AI 延续对话",
      hintWords: result.reply.logicHints || [],
      hintReason: result.reply.hintReason || ""
    });
    state.hintExpanded = false;
    elements.responseInput.value = "";
    renderConversation();
    renderComposer();
    persistMemory();
  } catch (error) {
    state.transcript.pop();
    renderConversation();
    showStatus(error.message || "生成下一句失败，请稍后再试。", "error");
  } finally {
    state.loading = false;
    renderComposer();
  }
}

async function endDialogue() {
  if (!state.generatedCase || state.loading || state.finished) return;
  if (!state.transcript.some((item) => item.type === "user")) {
    showStatus("请至少完成一轮作答后再结束对话。", "error");
    return;
  }

  state.loading = true;
  clearStatus();
  renderComposer();

  try {
    const result = await callApi("evaluate_dialogue", {
      config: state.config,
      caseData: state.generatedCase,
      transcript: state.transcript
    });
    markConnectionLive("模型已连通，当前对话正在使用真实生成。");
    state.finished = true;
    state.evaluation = result.evaluation;
    persistMemory();
    showStatus("点评已生成。", "success");
    renderComposer();
    renderEvaluation();
  } catch (error) {
    showStatus(error.message || "生成点评失败，请稍后再试。", "error");
  } finally {
    state.loading = false;
    renderComposer();
  }
}

function collectConfig() {
  return {
    scene: elements.sceneSelect.value,
    aiRole: elements.aiRoleSelect.value,
    userRole: elements.userRoleSelect.value,
    eventText: getEditorText()
  };
}

async function callApi(action, payload) {
  if (typeof window !== "undefined" && !/^https?:$/i.test(window.location?.protocol || "")) {
    throw new Error("当前不是服务端运行环境。请用 `npm run dev` 启动项目，并通过 http://127.0.0.1:3000 打开。");
  }

  try {
    const response = await fetch("./api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "请求失败");
    }
    return data;
  } catch (error) {
    markConnectionError("模型未连通：请检查本地服务、密钥配置和网络。");
    throw error;
  }
}

function buildLocalCase(config) {
  return {
    scene: config.scene,
    aiRole: config.aiRole,
    userRole: config.userRole,
    eventText: config.eventText,
    summary: buildCaseSummary(config),
    openingLine: buildOpeningLine(config),
    logicHints: pickInitialLogicHints(config.scene, config.eventText),
    hintReason: buildInitialHintReason(config.scene)
  };
}

function buildCaseSummary(config) {
  const sceneLabel = sceneLabelText(config.scene);
  const detail = normalizeSentence(config.eventText);
  return `背景信息：在${sceneLabel}里，${config.aiRole}和${config.userRole}正围绕“${detail}”发生紧张沟通。此刻由${config.aiRole}先开口，用户需要顺着这句话继续作答。`;
}

function buildOpeningLine(config) {
  const topic = inferTopicLabel(config.scene, config.eventText);
  const pool = getOpeningTemplates(config.scene, topic);
  return pool[Math.floor(Math.random() * pool.length)];
}

function getOpeningTemplates(scene, topic) {
  if (scene === "parent-child") {
    return [
      `关于${topic}这件事，我已经提醒你好几次了，你到底准备什么时候动起来？`,
      `你是不是又想把${topic}这件事一直拖下去？`,
      `这件事你现在到底是没想做，还是不知道怎么开始？`
    ];
  }

  if (scene === "intimacy") {
    return [
      `关于${topic}这件事，你是不是根本没有把我的感受放进去？`,
      `这件事让我很不舒服，你到底是没意识到，还是不在乎？`,
      `你现在这样处理${topic}，我很难不怀疑你有没有认真看待这段关系。`
    ];
  }

  if (scene === "workplace") {
    return [
      `关于${topic}，你现在准备怎么处理？我需要一个明确说法。`,
      `这件事不能再拖了，你到底是卡在什么地方？`,
      `现在最关键的问题就是${topic}，你给我一个能落地的处理方案。`
    ];
  }

  return [
    `关于${topic}，你到底想清楚没有？我现在最担心的不是嘴上说说。`,
    `这件事你准备拖到什么时候？你总得给我一个明确打算。`,
    `我不是不让你自己决定，但关于${topic}，你现在的想法到底是什么？`
  ];
}

function pickInitialLogicHints(scene, eventText) {
  const text = String(eventText || "");
  if (/一直|总是|每次|从来/.test(text)) return ["一些/所有", "现在/以后", "为什么/因为"];
  if (/必须|一定|立刻|马上/.test(text)) return ["想要/必要", "如果/那么", "和/或者"];
  if (scene === "workplace") return ["一些/所有", "如果/那么", "和/或者"];
  if (scene === "intimacy") return ["是/不是", "为什么/因为", "现在/以后"];
  if (scene === "parents") return ["公平/不公平", "为什么/因为", "想要/必要"];
  return ["一些/所有", "为什么/因为", "现在/以后"];
}

function buildInitialHintReason(scene) {
  if (scene === "workplace") return "这一轮适合先拆解要求边界、优先级和可执行条件。";
  if (scene === "intimacy") return "这一轮适合先接住关系感受，再拆掉绝对化和读心式推断。";
  if (scene === "parents") return "这一轮适合先区分担心、控制和比较，再讨论真正需求。";
  return "这一轮适合先接住情绪，再把笼统判断拆得更具体。";
}

function buildLocalReply(caseData, transcript) {
  const userTurns = transcript.filter((item) => item.type === "user");
  const lastUser = userTurns[userTurns.length - 1];
  const replyIndex = Math.max(0, userTurns.length - 1);
  const strong = lastUser && containsLogicWords(lastUser.text);
  const replyBank = getReplyBank(caseData.scene || "parent-child");
  const replyPool = strong ? replyBank.strong : replyBank.defensive;

  return {
    counterpartReply: replyPool[Math.min(replyIndex, replyPool.length - 1)],
    logicHints: nextHintWords(replyIndex + 1, strong, caseData.scene),
    hintReason: strong ? "你刚才已经开始拆解问题了，下一轮可以继续推进到界限、选项或后果。" : "你刚才的回复还偏表面，下一轮更适合先把对方在意的点拆清楚。",
    meta: strong ? "本地兜底模式：AI 角色在被更好接住后继续表达" : "本地兜底模式：AI 角色在防守状态下继续回应"
  };
}

function getReplyBank(scene) {
  if (scene === "parent-child") {
    return {
      strong: [
        "我不是单纯想冲你发火，我是看到这件事一拖再拖，心里就会越来越急。",
        "也不是每次都这样，是今天我已经提醒了几次，你还是没动，我才更上火。",
        "如果你愿意把你现在卡住的点说清楚，我可以先听你讲。",
        "我更想知道的是，这件事接下来你准备怎么做。"
      ],
      defensive: [
        "你现在还是没有听懂我到底在烦什么。",
        "我不是只在说眼前这一下，我是在说这件事总被拖着。",
        "如果你只是一直反问我，我会觉得你还是没接住我的意思。",
        "我现在不想被这样轻轻带过去。"
      ]
    };
  }

  if (scene === "intimacy") {
    return {
      strong: [
        "我不是故意为难你，我是真的会因为这件事怀疑自己在你心里的位置。",
        "也不是所有时候我都会这样，是这次又碰到了我最在意的点。",
        "如果你愿意继续听，我可以把我最难受的地方说得更具体。",
        "我更在意的是，这件事以后我们能不能有个更稳定的处理方式。"
      ],
      defensive: [
        "你又开始分析了，可我现在更需要的是你先听见我难受。",
        "我不是在跟你抬杠，我是在说这件事真的伤到我了。",
        "如果你一直只拆逻辑，我会觉得你还是在躲开感受。",
        "我现在不想再被当成是我自己想太多。"
      ]
    };
  }

  if (scene === "workplace") {
    return {
      strong: [
        "我不是故意在压你，我是在担心这件事再拖下去会直接影响结果。",
        "也不是所有地方都出了问题，是现在最关键的部分还没有落下来。",
        "如果你能把真正卡住的地方说清楚，我们还能一起排优先级。",
        "我更在意的是，你接下来准备怎么推进。"
      ],
      defensive: [
        "你现在还是没有正面回应我最担心的点。",
        "我不是在听漂亮话，我是在要一个能执行的说法。",
        "如果你只是在绕着讲，我会觉得这件事还是没有实质推进。",
        "我现在需要的不是安抚，是明确动作。"
      ]
    };
  }

  return {
    strong: [
      "我不是想直接否定你，我是真的担心你现在这个决定会让后面更被动。",
      "也不是所有地方我都不放心，是这件事牵扯到的后果让我比较紧张。",
      "如果你愿意把你的打算讲具体一点，我会更容易听进去。",
      "我更想知道的是，你接下来准备怎么安排。"
    ],
    defensive: [
      "你现在还是没有回应到我最担心的后果。",
      "我不是故意逼你，但我也不想这件事一直悬着。",
      "如果你只是把话拨开，我会觉得你还是没有认真面对。",
      "我现在不想只听一个模糊态度。"
    ]
  };
}

function nextHintWords(round, strong, scene) {
  if (round === 1) return pickInitialLogicHints(scene, "");
  if (round === 2) return strong ? ["如果/那么", "和/或者", "想要/必要"] : ["一些/所有", "是/不是", "为什么/因为"];
  return strong ? ["如果/那么", "公平/不公平", "想要/必要"] : ["现在/以后", "为什么/因为", "一些/所有"];
}

function buildLocalEvaluation(caseData, transcript) {
  const userTurns = transcript.filter((item) => item.type === "user");
  const logicTurnCount = userTurns.filter((item) => containsLogicWords(item.text)).length;
  const empathyCount = userTurns.filter((item) => /我明白|我知道|听起来|你现在|我能理解|是不是|看起来/.test(item.text)).length;
  const commandCount = userTurns.filter((item) => /应该|必须|赶紧|放弃算了|别闹|闭嘴/.test(item.text)).length;
  const actionCount = userTurns.filter((item) => /如果|那么|先|再|要不要|或者|下一步/.test(item.text)).length;

  const empathy = clamp(Math.round((empathyCount / Math.max(userTurns.length, 1)) * 10), 3, 9);
  const logic = clamp(Math.round((logicTurnCount / Math.max(userTurns.length, 1)) * 10), 3, 9);
  const boundary = clamp(8 - commandCount * 2, 2, 9);
  const action = clamp(Math.round((actionCount / Math.max(userTurns.length, 1)) * 10), 3, 9);
  const score = ((empathy + logic + boundary + action) / 4).toFixed(1);

  const strengths = [];
  const weaknesses = [];
  const logicUsed = collectLogicUsed(userTurns);

  if (empathy >= 7) strengths.push("你有尝试先接住对方的情绪和状态，而不是立刻转入反驳。");
  if (logic >= 7) strengths.push("你的回复里出现了有效的 CBST 逻辑字词，能够把问题往更具体处推进。");
  if (action >= 7) strengths.push("你不仅回应情绪，也尝试把对话推进到下一步或选项层面。");
  if (!strengths.length) strengths.push("你已经开始把冲突当作可练习的对话题，而不是只凭直觉回应。");

  if (empathy < 7) weaknesses.push("共情还不够稳定，建议先标出对方此刻的情绪或处境，再继续拆解。");
  if (logic < 7) weaknesses.push("逻辑拆解还不够，建议更主动使用“一些/所有”“为什么/因为”“现在/以后”这类字词。");
  if (boundary < 7) weaknesses.push("表达里有命令感或评判感，容易让对方进一步防守。");
  if (action < 7) weaknesses.push("你还可以更明确地推动到可执行的下一步，而不是停在表层确认。");

  return {
    score,
    summary: `这段对话已经进入 CBST 训练状态，但整体上${logic >= 7 ? "有一定拆解能力" : "拆解还不够稳定"}，${boundary >= 7 ? "边界感相对稳定" : "仍然容易滑向评判或命令"}。`,
    strengths,
    weaknesses,
    logicUsed,
    suggestedReply: buildSuggestedReply(caseData),
    metrics: {
      empathy: String(empathy),
      logic: String(logic),
      boundary: String(boundary),
      action: String(action)
    }
  };
}

function collectLogicUsed(userTurns) {
  const map = [
    ["一些/所有", /一些|所有/],
    ["为什么/因为", /为什么|因为/],
    ["现在/以后", /现在|以后/],
    ["如果/那么", /如果|那么/],
    ["想要/必要", /想要|必要|需要/],
    ["公平/不公平", /公平|不公平/]
  ];

  return map
    .filter(([, pattern]) => userTurns.some((turn) => pattern.test(turn.text)))
    .map(([label]) => label);
}

function buildSuggestedReply(caseData) {
  if (caseData.scene === "workplace") {
    return "我先确认一下，你现在最担心的是结果不能掉，还是时间已经不够？如果是两个要求同时成立，我们是不是可以先把优先级和交付边界拆开说清楚，再决定下一步怎么推进？";
  }

  if (caseData.scene === "intimacy") {
    return "听起来你现在不只是对这一次不舒服，而是会把它理解成我没有把你放在心上，对吗？我想先确认一下：你更难受的是这一次的处理方式，还是这种事最近已经反复发生？";
  }

  if (caseData.scene === "parents") {
    return "我先确认一下，你现在更担心的是我这个决定本身，还是你怕我后面会承担不了结果？如果我们先把担心的点拆开，我会更容易认真回应你。";
  }

  return "我先确认一下，你现在是在为这一次生气，还是担心这种情况后面还会一直重复？如果是两件事，我们可以先说眼前这一轮，再谈以后怎么避免重复。";
}

function renderLogicReference() {
  elements.logicReference.innerHTML = LOGIC_REFERENCE.map((item) => `
    <article class="logic-card">
      <strong>${item.label}</strong>
      <small>${item.valueTag}</small>
      <p>${item.purpose}</p>
    </article>
  `).join("");
}

function renderConnectionBanner() {
  elements.connectionBanner.className = `connection-banner ${state.connection.phase}`;
  elements.connectionBanner.textContent = state.connection.label;
}

function renderCaseCard() {
  if (!state.generatedCase) {
    elements.caseCard.innerHTML = `
      <div class="empty-state">
        这里会显示 AI 根据你输入的场景、双方角色和事件背景生成的情景描述，以及 AI 先说出的第一句话。
      </div>
    `;
    return;
  }

  elements.caseCard.innerHTML = `
    <div class="case-meta">
      <span class="hint-tag">关系场景：${escapeHtml(sceneLabel(state.generatedCase.scene))}</span>
      <span class="hint-tag">AI 角色：${escapeHtml(state.generatedCase.aiRole)}</span>
      <span class="hint-tag">你的角色：${escapeHtml(state.generatedCase.userRole)}</span>
    </div>
    <div class="quote-box">
      <strong>模拟对话场景</strong>
      <div>${escapeHtml(state.generatedCase.summary)}</div>
    </div>
    <div class="quote-box">
      <strong>AI 先说的第一句话</strong>
      <div>${escapeHtml(`${state.generatedCase.aiRole}：${state.generatedCase.openingLine}`)}</div>
    </div>
  `;
}

function renderComposer() {
  if (!state.generatedCase) {
    elements.focusTitle.textContent = "等待生成案例";
    elements.turnIndicator.textContent = "0 轮";
    elements.focusBrief.innerHTML = "先输入参数并点击“提交并生成案例”。AI 会先基于你的输入生成场景描述和第一句话。";
    elements.responseInput.disabled = true;
    elements.submitTurnButton.disabled = true;
    elements.endDialogueButton.disabled = true;
    elements.hintToggleButton.disabled = true;
    renderHintPanel();
    return;
  }

  if (state.finished) {
    elements.focusTitle.textContent = "对话已结束";
    elements.turnIndicator.textContent = `${getUserTurnCount()} 轮`;
    elements.focusBrief.innerHTML = "你已经主动结束本轮对话。现在可以查看下方的 CBST 专业点评。";
    elements.responseInput.disabled = true;
    elements.submitTurnButton.disabled = true;
    elements.endDialogueButton.disabled = true;
    elements.hintToggleButton.disabled = true;
    renderHintPanel();
    return;
  }

  elements.focusTitle.textContent = state.loading ? "AI 处理中" : "继续回复";
  elements.turnIndicator.textContent = `${getUserTurnCount()} 轮`;
  elements.focusBrief.innerHTML = state.loading
    ? "AI 正在根据你的回复继续对话，请稍候。"
    : `你当前扮演的是“${escapeHtml(state.generatedCase.userRole)}”，顺着 AI 的第一句话继续作答。如果想看推荐逻辑字词，点一下“需要提示？”。`;
  elements.responseInput.disabled = state.loading;
  elements.submitTurnButton.disabled = state.loading;
  elements.endDialogueButton.disabled = state.loading;
  elements.hintToggleButton.disabled = state.loading;
  renderHintPanel();
}

function toggleHintPanel() {
  if (!state.generatedCase || state.finished) return;
  state.hintExpanded = !state.hintExpanded;
  renderHintPanel();
}

function renderHintPanel() {
  const hintWords = getCurrentHintWords();
  const hintReason = getCurrentHintReason();
  elements.hintPanel.classList.toggle("hidden", !state.hintExpanded || !hintWords.length);
  elements.hintSummary.textContent = hintReason;
  elements.hintTags.innerHTML = hintWords.map((item) => `<span class="hint-tag">${escapeHtml(item)}</span>`).join("");
}

function renderValidationPanel(words = [], message = "") {
  const visible = Boolean(message);
  elements.validationPanel.classList.toggle("hidden", !visible);
  if (!visible) return;
  elements.validationMessage.textContent = message;
  elements.validationTags.innerHTML = words.map((item) => `<span class="hint-tag">${escapeHtml(item)}</span>`).join("");
}

function renderConversation() {
  if (!state.transcript.length) {
    elements.conversationView.innerHTML = `
      <div class="empty-state">
        生成案例后，这里会显示 AI 和用户的完整多轮对话。
      </div>
    `;
    return;
  }

  elements.conversationView.innerHTML = state.transcript.map((entry) => `
    <article class="message ${entry.type}">
      <div class="message-header">
        <strong>${escapeHtml(entry.speaker)}</strong>
        <span class="conversation-meta">${escapeHtml(entry.meta || "")}</span>
      </div>
      <div>${escapeHtml(entry.text)}</div>
    </article>
  `).join("");
}

function renderEvaluation() {
  if (!state.evaluation) return;
  const { score, strengths, weaknesses, logicUsed, suggestedReply, summary, metrics } = state.evaluation;
  const scoreAngle = `${Number(score) * 36}deg`;

  elements.evaluationView.style.setProperty("--score-angle", scoreAngle);
  elements.evaluationView.classList.remove("hidden");
  elements.evaluationView.innerHTML = `
    <section class="score-hero">
      <div class="score-ring">
        <div>
          <strong>${escapeHtml(score)}</strong>
          <span>/ 10 分</span>
        </div>
      </div>
      <div>
        <p class="eyebrow">专业点评</p>
        <h3>专业评估与解读</h3>
        <p class="muted-copy">${escapeHtml(summary)}</p>
      </div>
    </section>

    <div class="metric-grid">
      <article class="metric-card"><strong>共情</strong><b>${escapeHtml(metrics.empathy)}</b><small>是否先接住感受</small></article>
      <article class="metric-card"><strong>逻辑拆解</strong><b>${escapeHtml(metrics.logic)}</b><small>是否把问题拆开说清楚</small></article>
      <article class="metric-card"><strong>边界感</strong><b>${escapeHtml(metrics.boundary)}</b><small>是否避免评价与甩锅</small></article>
      <article class="metric-card"><strong>行动推进</strong><b>${escapeHtml(metrics.action)}</b><small>是否推动到下一步</small></article>
    </div>

    <div class="lists-grid">
      <article class="list-card">
        <h4>优点</h4>
        <ul>${strengths.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </article>
      <article class="list-card">
        <h4>不足</h4>
        <ul>${weaknesses.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </article>
    </div>

    <article class="suggestion-card">
      <h4>你这段对话用了哪些 CBST 逻辑</h4>
      <p>${logicUsed.length ? logicUsed.map(escapeHtml).join("、") : "本轮体现得还不明显"}</p>
    </article>

    <article class="suggestion-card">
      <h4>哪些地方没用好 CBST</h4>
      <p>${weaknesses.length ? weaknesses.map(escapeHtml).join("；") : "整体表现较稳定。"}</p>
    </article>

    <article class="suggestion-card">
      <h4>更优改写示范</h4>
      <pre>${escapeHtml(suggestedReply)}</pre>
    </article>
  `;
}

function containsLogicWords(text) {
  return LOGIC_PATTERNS.some((pattern) => pattern.test(text));
}

function getCurrentHintWords() {
  const latestSystemTurn = [...state.transcript].reverse().find((item) => item.type === "system");
  return latestSystemTurn?.hintWords || [];
}

function getCurrentHintReason() {
  const latestSystemTurn = [...state.transcript].reverse().find((item) => item.type === "system");
  return latestSystemTurn?.hintReason || "";
}

function getUserTurnCount() {
  return state.transcript.filter((item) => item.type === "user").length;
}

function sceneLabel(scene) {
  if (scene === "parent-child") return "亲子关系";
  if (scene === "intimacy") return "亲密关系";
  if (scene === "workplace") return "职场沟通";
  return "父母关系";
}

async function detectConnection() {
  if (typeof window !== "undefined" && !/^https?:$/i.test(window.location?.protocol || "")) {
    markConnectionError("未连接服务端：请使用 `npm run dev` 启动，并通过 http://127.0.0.1:3000 打开。");
    return;
  }

  try {
    const response = await fetch("./api/status");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "状态检查失败");
    }

    if (!data.openaiConfigured) {
      markConnectionError("服务端已启动，但未检测到模型密钥配置。");
      return;
    }

    state.connection = {
      phase: "ready",
      label: `服务端已就绪，模型接口已配置，当前模型：${data.model || "未指定"}。`
    };
    renderConnectionBanner();
  } catch (error) {
    markConnectionError(error.message || "无法连接本地服务端。");
  }
}

function markConnectionLive(label) {
  state.connection = {
    phase: "ready",
    label
  };
  renderConnectionBanner();
}

function markConnectionError(label) {
  state.connection = {
    phase: "error",
    label
  };
  renderConnectionBanner();
}

function sceneLabelText(scene) {
  if (scene === "workplace") return "职场关系";
  if (scene === "intimacy") return "亲密关系";
  if (scene === "parents") return "父母关系";
  return "亲子关系";
}

function inferTopicLabel(scene, text) {
  const clean = normalizeSentence(text)
    .replace(/^背景信息[:：]*/, "")
    .replace(/[。！？；]+$/g, "");

  if (scene === "parent-child") {
    if (/洗澡/.test(clean)) return "洗澡";
    if (/作业|写作业|学习/.test(clean)) return "作业和学习";
    if (/手机|游戏|短视频/.test(clean)) return "玩手机和时间安排";
    if (/睡觉|作息/.test(clean)) return "作息";
  }

  if (scene === "intimacy") {
    if (/陪|陪伴|见面/.test(clean)) return "陪伴";
    if (/回消息|联系|冷淡/.test(clean)) return "联系频率";
    if (/家长|承诺|结婚/.test(clean)) return "关系推进";
  }

  if (scene === "workplace") {
    if (/任务|截止|12点|中午|交付/.test(clean)) return "这项任务";
    if (/复盘|责任|甩锅/.test(clean)) return "责任划分";
    if (/沟通|返工|项目/.test(clean)) return "项目推进";
  }

  if (scene === "parents") {
    if (/催婚|结婚/.test(clean)) return "结婚安排";
    if (/辞职|换工作|工作/.test(clean)) return "换工作";
    if (/比较|别人家/.test(clean)) return "比较这件事";
  }

  const short = clean.split(/[，,。；;：:]/)[0].trim();
  if (short.length <= 12) return short;
  return `${short.slice(0, 12)}...`;
}

function normalizeSentence(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function normalizeRoleValue(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function mergeUnique(...groups) {
  const set = new Set(groups.flatMap((group) => group || []).map(normalizeRoleValue).filter(Boolean));
  return [...set];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function showStatus(message, type) {
  elements.statusBox.className = `status-box ${type}`;
  elements.statusBox.textContent = message;
}

function clearStatus() {
  elements.statusBox.className = "status-box hidden";
  elements.statusBox.textContent = "";
}

function getEditorText() {
  return normalizeSentence(elements.eventEditor.textContent);
}

function setEditorText(text) {
  elements.eventEditor.textContent = text || "";
}

function safeSetMemory(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function safeGetMemory(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeRemoveMemory(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
