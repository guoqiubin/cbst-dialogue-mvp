const FEATURED_STORAGE_KEY = "cbst-cognitive-featured-v1";
const DRAFT_STORAGE_KEY = "cbst-cognitive-draft-v1";
const HISTORY_STORAGE_KEY = "cbst-cognitive-history-v1";
const MAX_FEATURED_ITEMS = 30;
const MAX_HISTORY_ITEMS = 50;

const elements = {
  editor: document.querySelector("#analysis-editor"),
  analyzeButton: document.querySelector("#analyze-button"),
  clearButton: document.querySelector("#clear-analysis-button"),
  connectionBanner: document.querySelector("#cognitive-connection-banner"),
  statusBox: document.querySelector("#cognitive-status-box"),
  results: document.querySelector("#analysis-results"),
  resultCount: document.querySelector("#result-count"),
  featuredAction: document.querySelector("#featured-action"),
  toggleFeaturedButton: document.querySelector("#toggle-featured-button"),
  featuredActionNote: document.querySelector("#featured-action-note"),
  featuredCount: document.querySelector("#featured-count"),
  featuredList: document.querySelector("#featured-list"),
  historyCount: document.querySelector("#history-count"),
  historyList: document.querySelector("#history-list"),
  clearLocalRecordsButton: document.querySelector("#clear-local-records-button")
};

const state = {
  loading: false,
  connectionReady: false,
  currentText: "",
  currentAnalysis: null,
  featuredItems: [],
  historyItems: []
};

let cloudRestoredUserId = "";

init();

function init() {
  state.featuredItems = loadFeaturedItems();
  state.historyItems = loadHistoryItems();
  restoreDraft();
  elements.analyzeButton.addEventListener("click", analyzeText);
  elements.clearButton.addEventListener("click", clearText);
  elements.toggleFeaturedButton.addEventListener("click", toggleFeatured);
  elements.featuredList.addEventListener("click", handleFeaturedListClick);
  elements.historyList.addEventListener("click", handleHistoryListClick);
  elements.clearLocalRecordsButton.addEventListener("click", clearLocalRecords);
  elements.editor.addEventListener("input", handleEditorInput);
  elements.editor.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      analyzeText();
    }
  });
  window.addEventListener("cbst:authchange", () => void restoreCloudRecords());
  renderFeaturedList();
  renderHistoryList();
  renderFeaturedAction();
  void detectConnection();
  void restoreCloudRecords();
}

async function detectConnection() {
  try {
    const response = await fetch("./api/status", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.serverReady || !data.openaiConfigured) throw new Error("模型未配置");
    state.connectionReady = true;
    elements.connectionBanner.className = "connection-banner ready";
    elements.connectionBanner.textContent = `模型已连通，分析将使用真实生成。当前模型：${data.model}。`;
  } catch {
    state.connectionReady = false;
    elements.connectionBanner.className = "connection-banner error";
    elements.connectionBanner.textContent = "模型暂未连通。请确认本地服务、密钥配置和网络后再试。";
  }
}

async function analyzeText() {
  if (state.loading) return;
  const text = getEditorText();
  if (!text) {
    showStatus("请先输入需要分析的文本。", "error");
    elements.editor.focus();
    return;
  }

  state.loading = true;
  setLoadingState(true);
  showStatus("正在根据原文证据分析，请稍候...", "info");

  try {
    const response = await fetch("./api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "analyze_fallacies", text })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "分析请求失败");

    state.connectionReady = true;
    elements.connectionBanner.className = "connection-banner ready";
    elements.connectionBanner.textContent = `模型已连通，当前分析正在使用真实生成。当前模型：${data.model}。`;
    state.currentText = text;
    state.currentAnalysis = data.analysis || {};
    saveDraft();
    saveAnalysisToHistory();
    renderResults(data.analysis || {});
    renderFeaturedAction();
    renderHistoryList();
    showStatus("分析已完成。", "success");
  } catch (error) {
    state.connectionReady = false;
    elements.connectionBanner.className = "connection-banner error";
    elements.connectionBanner.textContent = "模型暂未连通。请确认本地服务、密钥配置和网络后再试。";
    showStatus(error.message || "分析失败，请稍后再试。", "error");
  } finally {
    state.loading = false;
    setLoadingState(false);
  }
}

function renderResults(analysis) {
  const items = Array.isArray(analysis.items) ? analysis.items : [];
  const status = analysis.status || "insufficient_context";

  if (status !== "findings" || !items.length) {
    elements.resultCount.textContent = status === "none" ? "未发现谬误" : "需要更多语境";
    elements.results.innerHTML = `
      <article class="analysis-state-card ${escapeHtml(status)}">
        <p class="eyebrow">${status === "none" ? "分析结论" : "判断范围"}</p>
        <h3>${escapeHtml(analysis.summary || fallbackSummary(status))}</h3>
        <p>${status === "none" ? "系统不会为了给出结果而强行匹配概念。" : "补充前后发生了什么、双方各自说了什么，通常能让分析更可靠。"}</p>
      </article>`;
    return;
  }

  elements.resultCount.textContent = `发现 ${items.length} 项`;
  elements.results.innerHTML = `
    <div class="analysis-summary">${escapeHtml(analysis.summary || "以下结果均基于原文中的直接证据，仅供学习与自我观察。")}</div>
    <div class="analysis-list">
      ${items.map((item, index) => renderFinding(item, index)).join("")}
    </div>`;
}

function renderFeaturedAction() {
  const hasAnalysis = Boolean(state.currentText && state.currentAnalysis);
  elements.featuredAction.classList.toggle("hidden", !hasAnalysis);
  elements.toggleFeaturedButton.disabled = !hasAnalysis;
  if (!hasAnalysis) return;

  const saved = getCurrentFeaturedItem();
  elements.toggleFeaturedButton.textContent = saved ? "取消精选" : "加入精选";
  elements.toggleFeaturedButton.classList.toggle("is-featured", Boolean(saved));
  elements.featuredActionNote.textContent = saved
    ? "该条原文与解析已收藏在“小编精选”中。"
    : "将当前原文和本次解析一并收藏到“小编精选”。";
}

function toggleFeatured() {
  const currentItem = getCurrentFeaturedItem();
  if (currentItem) {
    state.featuredItems = state.featuredItems.filter((item) => item.id !== currentItem.id);
    persistFeaturedItems();
    renderFeaturedList();
    renderFeaturedAction();
    showStatus("已取消精选。", "info");
    return;
  }

  if (!state.currentText || !state.currentAnalysis) return;
  const item = {
    id: buildFeaturedId(state.currentText, state.currentAnalysis),
    text: state.currentText,
    analysis: state.currentAnalysis,
    createdAt: new Date().toISOString()
  };
  state.featuredItems = [item, ...state.featuredItems].slice(0, MAX_FEATURED_ITEMS);
  persistFeaturedItems();
  renderFeaturedList();
  renderFeaturedAction();
  showStatus("已加入小编精选。", "success");
}

function getCurrentFeaturedItem() {
  if (!state.currentText || !state.currentAnalysis) return null;
  const id = buildFeaturedId(state.currentText, state.currentAnalysis);
  return state.featuredItems.find((item) => item.id === id) || null;
}

function renderFeaturedList() {
  elements.featuredCount.textContent = `${state.featuredItems.length} 条`;
  if (!state.featuredItems.length) {
    elements.featuredList.innerHTML = '<div class="empty-state">还没有精选内容。完成一次分析后，可以在结果区加入精选。</div>';
    return;
  }

  elements.featuredList.innerHTML = state.featuredItems.map((item) => {
    const analysis = item.analysis || {};
    const findings = Array.isArray(analysis.items) ? analysis.items : [];
    const labels = findings.length
      ? findings.map((finding) => `<span class="tag">${escapeHtml(finding.canonicalName || "可能的思维模式")}</span>`).join("")
      : `<span class="tag">${escapeHtml(analysis.status === "none" ? "未发现谬误" : "需要更多语境")}</span>`;
    return `
      <article class="featured-item">
        <div class="featured-item-head">
          <div class="case-tags">${labels}</div>
          <button class="remove-featured-button" type="button" data-featured-id="${escapeHtml(item.id)}">取消精选</button>
        </div>
        <p class="featured-text">${escapeHtml(item.text)}</p>
        <p class="featured-summary">${escapeHtml(analysis.summary || fallbackSummary(analysis.status))}</p>
        <time class="source-label" datetime="${escapeHtml(item.createdAt)}">收藏于 ${escapeHtml(formatFeaturedTime(item.createdAt))}</time>
      </article>`;
  }).join("");
}

function handleFeaturedListClick(event) {
  const button = event.target.closest("[data-featured-id]");
  if (!button) return;
  const id = button.dataset.featuredId;
  state.featuredItems = state.featuredItems.filter((item) => item.id !== id);
  persistFeaturedItems();
  renderFeaturedList();
  renderFeaturedAction();
  showStatus("已取消精选。", "info");
}

function renderFinding(item, index) {
  const roleLine = item.role || item.location
    ? `<span class="analysis-location">${escapeHtml([item.role, item.location].filter(Boolean).join(" · "))}</span>`
    : "";
  return `
    <article class="finding-card">
      <div class="finding-head">
        <span class="finding-index">${index + 1}</span>
        <div>
          <h3>${escapeHtml(item.canonicalName || "可能的思维模式")}</h3>
          <div class="case-tags">
            <span class="tag">${escapeHtml(item.category || "文本分析")}</span>
            ${roleLine}
          </div>
        </div>
      </div>
      <div class="evidence-box">
        <strong>结合原文的证据</strong>
        <p>“${escapeHtml(item.evidence || "未提供") }”</p>
      </div>
      <div class="finding-explanation">
        <strong>谬误简单解释</strong>
        <p>${escapeHtml(item.explanation || "该表述可能呈现了需要进一步观察的推理结构。")}</p>
      </div>
      <p class="source-label">来源依据：${escapeHtml(item.sourceLabel || "受控术语库")}</p>
    </article>`;
}

function clearText() {
  elements.editor.textContent = "";
  state.currentText = "";
  state.currentAnalysis = null;
  elements.results.innerHTML = '<div class="empty-state">输入文本后点击“分析文本”。结果会优先引用原句证据，而不是对说话者下判断。</div>';
  elements.resultCount.textContent = "等待分析";
  saveDraft();
  renderFeaturedAction();
  hideStatus();
  elements.editor.focus();
}

function handleEditorInput() {
  const nextText = getEditorText();
  if (nextText !== state.currentText) {
    state.currentText = nextText;
    state.currentAnalysis = null;
    elements.results.innerHTML = '<div class="empty-state">文本已更新，请再次点击“分析文本”生成新的结果。</div>';
    elements.resultCount.textContent = "等待分析";
    renderFeaturedAction();
  }
  saveDraft();
}

function restoreDraft() {
  const draft = readLocalJson(DRAFT_STORAGE_KEY, null);
  if (!draft || typeof draft.text !== "string") return;
  elements.editor.textContent = draft.text;
  state.currentText = draft.text;
  if (draft.analysis && typeof draft.analysis === "object" && draft.text) {
    state.currentAnalysis = draft.analysis;
    renderResults(draft.analysis);
  }
}

function saveDraft() {
  writeLocalJson(DRAFT_STORAGE_KEY, {
    text: state.currentText || getEditorText(),
    analysis: state.currentAnalysis,
    updatedAt: new Date().toISOString()
  });
  void syncCloudRecords();
}

function saveAnalysisToHistory() {
  if (!state.currentText || !state.currentAnalysis) return;
  const id = buildHistoryId(state.currentText);
  const item = {
    id,
    text: state.currentText,
    analysis: state.currentAnalysis,
    updatedAt: new Date().toISOString()
  };
  state.historyItems = [item, ...state.historyItems.filter((historyItem) => historyItem.id !== id)].slice(0, MAX_HISTORY_ITEMS);
  writeLocalJson(HISTORY_STORAGE_KEY, state.historyItems);
  void syncCloudRecords();
}

function loadHistoryItems() {
  const value = readLocalJson(HISTORY_STORAGE_KEY, []);
  return Array.isArray(value) ? value.filter(isValidHistoryItem).slice(0, MAX_HISTORY_ITEMS) : [];
}

function renderHistoryList() {
  elements.historyCount.textContent = `${state.historyItems.length} 条`;
  if (!state.historyItems.length) {
    elements.historyList.innerHTML = '<div class="empty-state">还没有分析记录。完成一次分析后会自动保存在这里。</div>';
    return;
  }

  elements.historyList.innerHTML = state.historyItems.map((item) => `
    <article class="history-item">
      <div>
        <p class="history-text">${escapeHtml(item.text)}</p>
        <p class="history-summary">${escapeHtml(item.analysis?.summary || fallbackSummary(item.analysis?.status))}</p>
        <time class="source-label" datetime="${escapeHtml(item.updatedAt)}">分析于 ${escapeHtml(formatFeaturedTime(item.updatedAt))}</time>
      </div>
      <button class="restore-history-button" type="button" data-history-id="${escapeHtml(item.id)}">恢复查看</button>
    </article>`).join("");
}

function handleHistoryListClick(event) {
  const button = event.target.closest("[data-history-id]");
  if (!button) return;
  const item = state.historyItems.find((historyItem) => historyItem.id === button.dataset.historyId);
  if (!item) return;
  elements.editor.textContent = item.text;
  state.currentText = item.text;
  state.currentAnalysis = item.analysis;
  renderResults(item.analysis);
  renderFeaturedAction();
  saveDraft();
  showStatus("已恢复该条分析记录。", "success");
  elements.editor.focus();
}

function clearLocalRecords() {
  const confirmed = window.confirm("将清空当前浏览器中的草稿、最近分析和小编精选。此操作无法撤销，是否继续？");
  if (!confirmed) return;
  state.featuredItems = [];
  state.historyItems = [];
  state.currentText = "";
  state.currentAnalysis = null;
  elements.editor.textContent = "";
  removeLocalValue(FEATURED_STORAGE_KEY);
  removeLocalValue(HISTORY_STORAGE_KEY);
  removeLocalValue(DRAFT_STORAGE_KEY);
  void window.CBSTCloud?.removeProgress("cognitive");
  elements.results.innerHTML = '<div class="empty-state">输入文本后点击“分析文本”。结果会优先引用原句证据，而不是对说话者下判断。</div>';
  elements.resultCount.textContent = "等待分析";
  renderFeaturedList();
  renderHistoryList();
  renderFeaturedAction();
  showStatus("当前浏览器中的记录已清空。", "info");
}

function loadFeaturedItems() {
  const value = readLocalJson(FEATURED_STORAGE_KEY, []);
  return Array.isArray(value) ? value.filter(isValidFeaturedItem).slice(0, MAX_FEATURED_ITEMS) : [];
}

function persistFeaturedItems() {
  writeLocalJson(FEATURED_STORAGE_KEY, state.featuredItems);
  void syncCloudRecords();
}

async function restoreCloudRecords() {
  const user = window.CBSTCloud?.getUser?.();
  if (!user || cloudRestoredUserId === user.id) return;
  cloudRestoredUserId = user.id;

  try {
    const cloudPayload = await window.CBSTCloud.loadProgress("cognitive");
    if (!cloudPayload) {
      await syncCloudRecords();
      return;
    }
    const draft = cloudPayload.draft || {};
    state.featuredItems = Array.isArray(cloudPayload.featuredItems)
      ? cloudPayload.featuredItems.filter(isValidFeaturedItem).slice(0, MAX_FEATURED_ITEMS)
      : [];
    state.historyItems = Array.isArray(cloudPayload.historyItems)
      ? cloudPayload.historyItems.filter(isValidHistoryItem).slice(0, MAX_HISTORY_ITEMS)
      : [];
    elements.editor.textContent = typeof draft.text === "string" ? draft.text : "";
    state.currentText = elements.editor.textContent;
    state.currentAnalysis = draft.analysis && state.currentText ? draft.analysis : null;
    if (state.currentAnalysis) renderResults(state.currentAnalysis);
    writeLocalJson(FEATURED_STORAGE_KEY, state.featuredItems);
    writeLocalJson(HISTORY_STORAGE_KEY, state.historyItems);
    writeLocalJson(DRAFT_STORAGE_KEY, draft);
    renderFeaturedList();
    renderHistoryList();
    renderFeaturedAction();
  } catch {
    cloudRestoredUserId = "";
  }
}

async function syncCloudRecords() {
  if (!window.CBSTCloud?.isSignedIn?.()) return;
  try {
    await window.CBSTCloud.saveProgress("cognitive", {
      draft: {
        text: state.currentText || getEditorText(),
        analysis: state.currentAnalysis,
        updatedAt: new Date().toISOString()
      },
      featuredItems: state.featuredItems,
      historyItems: state.historyItems
    });
  } catch {
    // Local records are retained and will sync on a later successful save.
  }
}

function isValidFeaturedItem(item) {
  return item && typeof item.id === "string" && typeof item.text === "string" && item.analysis && typeof item.analysis === "object";
}

function isValidHistoryItem(item) {
  return item && typeof item.id === "string" && typeof item.text === "string" && item.analysis && typeof item.analysis === "object";
}

function buildFeaturedId(text, analysis) {
  const seed = `${text}\n${analysis.status || ""}\n${analysis.summary || ""}\n${JSON.stringify(analysis.items || [])}`;
  let hash = 5381;
  for (let index = 0; index < seed.length; index += 1) hash = ((hash << 5) + hash) ^ seed.charCodeAt(index);
  return `featured-${hash >>> 0}`;
}

function buildHistoryId(text) {
  return `history-${hashText(text)}`;
}

function hashText(value) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  return hash >>> 0;
}

function formatFeaturedTime(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function readLocalJson(key, fallback) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLocalJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    showStatus("本机记录暂时无法保存到当前浏览器。", "error");
  }
}

function removeLocalValue(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // The UI state is already cleared even when browser storage is unavailable.
  }
}

function setLoadingState(loading) {
  elements.analyzeButton.disabled = loading;
  elements.clearButton.disabled = loading;
  elements.analyzeButton.textContent = loading ? "正在分析..." : "分析文本";
}

function getEditorText() {
  return (elements.editor.innerText || elements.editor.textContent || "").replace(/\u00a0/g, " ").trim();
}

function showStatus(message, type) {
  elements.statusBox.className = `status-box ${type}`;
  elements.statusBox.textContent = message;
}

function hideStatus() {
  elements.statusBox.className = "status-box hidden";
  elements.statusBox.textContent = "";
}

function fallbackSummary(status) {
  return status === "none"
    ? "该内容不存在任何谬误。"
    : "仅凭当前文本，暂无法判断是否存在明确的认知或逻辑谬误；可补充前后语境后再分析。";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
