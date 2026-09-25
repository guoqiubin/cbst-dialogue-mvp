"use strict";

const MODULES = [
  ["global", "全局通用"], ["dialogue", "CBST 对话"], ["logic-training", "逻辑字词训练"], ["cognitive", "认知谬误识别"], ["empathy", "共情训练"], ["emotion", "情绪识别训练"], ["listening", "倾听训练"]
];
const elements = {
  title: document.querySelector("#source-title"), file: document.querySelector("#source-file"), text: document.querySelector("#source-text"), tags: document.querySelector("#source-module-tags"), note: document.querySelector("#source-note"), upload: document.querySelector("#source-upload-button"), refresh: document.querySelector("#refresh-sources-button"), status: document.querySelector("#admin-status"), access: document.querySelector("#admin-access-message"), list: document.querySelector("#source-list")
};
let ready = false;

init();

function init() {
  elements.tags.innerHTML = MODULES.map(([value, label], index) => `<label class="module-tag-choice"><input type="checkbox" value="${value}" ${index === 0 ? "checked" : ""} /><span>${label}</span></label>`).join("");
  elements.upload.addEventListener("click", uploadSource);
  elements.refresh.addEventListener("click", loadSources);
  window.addEventListener("cbst:authchange", () => void initialize());
  void initialize();
}

async function initialize() {
  ready = false;
  elements.list.classList.add("hidden");
  if (!window.CBSTCloud?.isSignedIn?.()) {
    elements.access.textContent = "请先登录管理员账号后再进入知识库后台。";
    return;
  }
  await loadSources();
}

async function loadSources() {
  elements.refresh.disabled = true;
  elements.access.textContent = "正在读取资料清单...";
  try {
    const response = await requestKnowledge("list", {}, "GET");
    ready = true;
    elements.access.textContent = "已进入私有知识库。草稿不会参与用户侧训练，发布后才会生效。";
    renderSources(response.sources || []);
  } catch (error) {
    ready = false;
    elements.access.textContent = error.message || "暂时无法读取知识库。";
  } finally { elements.refresh.disabled = false; }
}

async function uploadSource() {
  if (!ready) return showStatus("请先使用有后台权限的账号登录。", "error");
  const file = elements.file.files?.[0];
  const text = elements.text.value.trim();
  if (!file && !text) return showStatus("请上传资料，或粘贴一段文本。", "error");
  if (file && file.size > 4 * 1024 * 1024) return showStatus("资料请控制在 4MB 以内后再上传。", "error");
  elements.upload.disabled = true;
  showStatus("正在保存原始资料并提取知识草稿，可能需要半分钟...", "info");
  try {
    const payload = {
      title: elements.title.value.trim() || file?.name?.replace(/\.[^.]+$/, "") || "未命名文本资料",
      moduleTags: selectedTags(), sourceNote: elements.note.value.trim(), pastedText: text,
      file: file ? await serializeFile(file) : null
    };
    await requestKnowledge("ingest", payload);
    elements.title.value = ""; elements.file.value = ""; elements.text.value = ""; elements.note.value = "";
    showStatus("资料已提取为待审核草稿。确认后点击“发布”，它才会影响训练。", "success");
    await loadSources();
  } catch (error) {
    showStatus(error.message || "资料处理未完成。", "error");
  } finally { elements.upload.disabled = false; }
}

async function sourceAction(action, source) {
  const labels = { publish: "发布", retract: "撤回", restore: "恢复", delete: "删除", purge: "永久删除" };
  if (action === "delete" && !window.confirm(`删除后将立即撤回这份资料的 ${source.entry_count || 0} 条知识，并保留 30 天恢复期。确定继续吗？`)) return;
  if (action === "purge" && !window.confirm("永久删除后无法恢复原始文件和知识条目。确定继续吗？")) return;
  if (action === "retract" && !window.confirm(`撤回后，这份资料的 ${source.entry_count || 0} 条知识将立即不再参与训练。确定继续吗？`)) return;
  showStatus(`正在${labels[action]}资料...`, "info");
  try {
    await requestKnowledge(action, { sourceId: source.id });
    showStatus(`资料已${labels[action]}。`, "success");
    await loadSources();
  } catch (error) { showStatus(error.message || "操作未完成。", "error"); }
}

function renderSources(sources) {
  if (!sources.length) {
    elements.list.className = "source-list";
    elements.list.innerHTML = '<div class="source-empty">还没有课程资料。上传后会先生成待审核草稿。</div>';
    return;
  }
  elements.list.className = "source-list";
  elements.list.innerHTML = sources.map((source) => {
    const status = source.status || "draft";
    return `<article class="source-card"><div class="source-card-head"><div><span class="source-status ${escapeHtml(status)}">${statusLabel(status)}</span><h3>${escapeHtml(source.title)}</h3></div><span class="source-count">${Number(source.entry_count || 0)} 条知识</span></div><p class="source-summary">${escapeHtml(source.summary || source.source_note || "等待提取结果")}</p><p class="source-meta">${escapeHtml((source.module_tags || []).map(moduleLabel).join(" · "))} · 更新于 ${formatDate(source.updated_at)}</p>${source.status === "deleted" && source.purge_after ? `<p class="source-recovery">可恢复至 ${formatDate(source.purge_after)}</p>` : ""}<div class="source-actions">${sourceButtons(source)}</div></article>`;
  }).join("");
  for (const button of elements.list.querySelectorAll("[data-source-action]")) {
    button.addEventListener("click", () => sourceAction(button.dataset.sourceAction, sources.find((source) => source.id === button.dataset.sourceId)));
  }
}

function sourceButtons(source) {
  const id = escapeHtml(source.id);
  if (source.status === "draft") return `<button class="primary-button small-button" data-source-action="publish" data-source-id="${id}" type="button">发布</button><button class="secondary-button small-button" data-source-action="delete" data-source-id="${id}" type="button">删除</button>`;
  if (source.status === "published") return `<button class="secondary-button small-button" data-source-action="retract" data-source-id="${id}" type="button">撤回</button><button class="secondary-button small-button" data-source-action="delete" data-source-id="${id}" type="button">删除</button>`;
  if (source.status === "retracted") return `<button class="primary-button small-button" data-source-action="publish" data-source-id="${id}" type="button">重新发布</button><button class="secondary-button small-button" data-source-action="delete" data-source-id="${id}" type="button">删除</button>`;
  if (source.status === "deleted") return `<button class="primary-button small-button" data-source-action="restore" data-source-id="${id}" type="button">恢复</button><button class="secondary-button small-button" data-source-action="purge" data-source-id="${id}" type="button">永久删除</button>`;
  return "";
}

async function requestKnowledge(action, payload, method = "POST") {
  const token = window.CBSTCloud?.getAccessToken?.();
  if (!token) throw new Error("请先登录管理员账号。 ");
  const url = method === "GET" ? `../api/knowledge?action=${encodeURIComponent(action)}` : "../api/knowledge";
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: method === "GET" ? undefined : JSON.stringify({ action, ...payload }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "后台请求未完成。 ");
  return data;
}

function selectedTags() { const tags = [...elements.tags.querySelectorAll("input:checked")].map((input) => input.value); return tags.length ? tags : ["global"]; }
function serializeFile(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("读取资料失败。")); reader.onload = () => resolve({ name: file.name, mimeType: file.type, base64: String(reader.result).split(",")[1] || "" }); reader.readAsDataURL(file); }); }
function showStatus(message, type) { elements.status.className = message ? `status-box ${type || "info"}` : "status-box hidden"; elements.status.textContent = message || ""; }
function statusLabel(status) { return ({ processing: "处理中", draft: "待审核", published: "已发布", retracted: "已撤回", deleted: "恢复期内", failed: "处理失败" })[status] || status; }
function moduleLabel(value) { return MODULES.find(([key]) => key === value)?.[1] || value; }
function formatDate(value) { return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(value)) : "未记录"; }
function escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
