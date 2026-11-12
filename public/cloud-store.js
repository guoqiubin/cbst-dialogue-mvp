"use strict";

const CLOUD_SESSION_KEY = "cbst-cloud-session-v1";
const cloudState = { config: null, session: null, user: null, badgeProgress: null, ready: false };
const BADGE_DEFINITIONS = [
  { id: "first-step", icon: "✦", title: "开始练习", description: "完成 1 次有效训练", unlocked: (progress) => progress.totalCompleted >= 1, progress: (progress) => `${Math.min(progress.totalCompleted, 1)}/1 次` },
  { id: "dialogue", icon: "◇", title: "对话起点", description: "完成 1 次 CBST 对话", unlocked: (progress) => moduleCount(progress, "dialogue") >= 1, progress: (progress) => moduleProgress(progress, "dialogue", 1) },
  { id: "cognitive", icon: "◈", title: "思维观察", description: "完成 1 次认知谬误识别", unlocked: (progress) => moduleCount(progress, "cognitive") >= 1, progress: (progress) => moduleProgress(progress, "cognitive", 1) },
  { id: "logic", icon: "⌁", title: "逻辑练习", description: "完成 1 次逻辑字词训练", unlocked: (progress) => moduleCount(progress, "logic-training") >= 1, progress: (progress) => moduleProgress(progress, "logic-training", 1) },
  { id: "empathy", icon: "♡", title: "共情回应", description: "完成 1 次共情训练", unlocked: (progress) => moduleCount(progress, "empathy") >= 1, progress: (progress) => moduleProgress(progress, "empathy", 1) },
  { id: "emotion", icon: "☼", title: "情绪命名", description: "完成 1 次情绪识别训练", unlocked: (progress) => moduleCount(progress, "emotion") >= 1, progress: (progress) => moduleProgress(progress, "emotion", 1) },
  { id: "listening", icon: "◌", title: "倾听回声", description: "完成 1 次反映式倾听训练", unlocked: (progress) => moduleCount(progress, "listening") >= 1, progress: (progress) => moduleProgress(progress, "listening", 1) },
  { id: "practice-five", icon: "◎", title: "持续练习", description: "累计完成 5 次训练", unlocked: (progress) => progress.totalCompleted >= 5, progress: (progress) => `${Math.min(progress.totalCompleted, 5)}/5 次` },
  { id: "practice-twenty", icon: "✺", title: "稳定练习", description: "累计完成 20 次训练", unlocked: (progress) => progress.totalCompleted >= 20, progress: (progress) => `${Math.min(progress.totalCompleted, 20)}/20 次` },
  { id: "all-rounder", icon: "✹", title: "全域练习者", description: "六个训练模块各完成 1 次", unlocked: (progress) => ["dialogue", "cognitive", "logic-training", "empathy", "emotion", "listening"].every((module) => moduleCount(progress, module) >= 1), progress: (progress) => `${["dialogue", "cognitive", "logic-training", "empathy", "emotion", "listening"].filter((module) => moduleCount(progress, module) >= 1).length}/6 个模块` }
];

window.CBSTCloud = {
  isSignedIn: () => Boolean(cloudState.user),
  getUser: () => cloudState.user,
  getAccessToken: () => cloudState.session?.access_token || "",
  loadProgress,
  saveProgress,
  removeProgress,
  loadBadgeProgress,
  recordBadgeCompletion
};

void init();

async function init() {
  injectBadgeInterface();
  injectContactInterface();
  injectAccountInterface();
  try {
    const response = await fetch("/api/public-config", { cache: "no-store" });
    const config = await response.json();
    if (response.ok && config.cloudSyncEnabled) {
      cloudState.config = config;
      cloudState.session = readSession();
      if (cloudState.session) await restoreSession();
      if (cloudState.user) await loadBadgeProgress();
    }
  } catch {
    // The local version remains fully usable before cloud sync is configured.
  } finally {
    cloudState.ready = true;
    renderAccountInterface();
    announceAuthChange();
  }
}

function injectBadgeInterface() {
  const host = document.querySelector(".module-hub-actions") || document.querySelector(".module-hub");
  if (!host || document.querySelector("#badge-wall-button")) return;

  const trigger = document.createElement("button");
  trigger.id = "badge-wall-button";
  trigger.className = "badge-wall-button";
  trigger.type = "button";
  trigger.innerHTML = '<span aria-hidden="true">🏅</span><span>勋章墙</span>';
  trigger.addEventListener("click", () => void openBadgeWall());
  host.append(trigger);

  const dialog = document.createElement("dialog");
  dialog.id = "badge-wall-dialog";
  dialog.className = "badge-wall-dialog";
  dialog.innerHTML = [
    '<div class="badge-wall-dialog-card">',
    '<button class="dialog-close-button" type="button" aria-label="关闭">×</button>',
    '<p class="eyebrow">训练足迹</p>',
    '<h2>我的勋章墙</h2>',
    '<p class="badge-wall-copy">每完成一次有效训练，都会在这里留下一个可见的进步痕迹。</p>',
    '<div id="badge-wall-body" class="badge-wall-body" aria-live="polite"></div>',
    '</div>'
  ].join("");
  dialog.querySelector(".dialog-close-button").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  document.body.append(dialog);
}

async function openBadgeWall() {
  const dialog = document.querySelector("#badge-wall-dialog");
  if (!dialog) return;
  dialog.showModal();
  renderBadgeWall();
  if (!cloudState.user) return;
  try {
    await loadBadgeProgress();
  } catch {
    showAccountNotice("勋章进度暂未同步，稍后会自动重试。", "info");
  }
  renderBadgeWall();
}

function renderBadgeWall() {
  const body = document.querySelector("#badge-wall-body");
  if (!body) return;
  if (!cloudState.user) {
    body.innerHTML = '<div class="badge-sign-in-state"><strong>登录后开始收集勋章</strong><p>勋章会和训练进度一起保存到云端，并在不同设备间同步。</p><button id="badge-sign-in-button" class="primary-button" type="button">登录保存进度</button></div>';
    body.querySelector("#badge-sign-in-button").addEventListener("click", () => {
      document.querySelector("#badge-wall-dialog")?.close();
      document.querySelector("#account-dialog")?.showModal();
    });
    return;
  }

  const progress = normalizeBadgeProgress(cloudState.badgeProgress);
  const unlocked = BADGE_DEFINITIONS.filter((badge) => badge.unlocked(progress)).length;
  body.innerHTML = `
    <div class="badge-summary"><strong>${unlocked}/${BADGE_DEFINITIONS.length}</strong><span>已点亮勋章</span><small>累计完成 ${progress.totalCompleted} 次训练</small></div>
    <div class="badge-grid">${BADGE_DEFINITIONS.map((badge) => renderBadgeCard(badge, progress)).join("")}</div>`;
}

function renderBadgeCard(badge, progress) {
  const unlocked = badge.unlocked(progress);
  return `<article class="badge-card ${unlocked ? "unlocked" : "locked"}">
    <span class="badge-icon" aria-hidden="true">${badge.icon}</span>
    <div><strong>${badge.title}</strong><p>${badge.description}</p><small>${unlocked ? "已点亮" : badge.progress(progress)}</small></div>
  </article>`;
}

function injectContactInterface() {
  const host = document.querySelector(".module-hub-actions") || document.querySelector(".module-hub");
  if (!host || document.querySelector("#contact-button")) return;

  const trigger = document.createElement("button");
  trigger.id = "contact-button";
  trigger.className = "contact-button";
  trigger.type = "button";
  trigger.innerHTML = '<span aria-hidden="true">✦</span><span>联系我们</span>';

  const dialog = document.createElement("dialog");
  dialog.id = "contact-dialog";
  dialog.className = "contact-dialog";
  dialog.innerHTML = [
    '<div class="contact-dialog-card">',
    '<button class="dialog-close-button" type="button" aria-label="关闭">×</button>',
    '<p class="eyebrow">联系托德学院</p>',
    '<h2>扫码添加企业微信</h2>',
    '<p>产品反馈、读书会咨询与训练建议，欢迎通过企业微信联系读书会大管家。</p>',
    '<img src="/assets/todd-academy-wechat.jpg?v=20260929b" alt="读书会大管家企业微信二维码" />',
    '<small>请使用微信扫描二维码</small>',
    '</div>'
  ].join("");

  trigger.addEventListener("click", () => dialog.showModal());
  dialog.querySelector(".dialog-close-button").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  host.append(trigger);
  document.body.append(dialog);
}

function injectAccountInterface() {
  const host = document.querySelector(".module-hub-actions") || document.querySelector(".module-hub");
  if (!host || document.querySelector("#account-button")) return;

  const controls = document.createElement("div");
  controls.className = "account-controls";

  const stateLabel = document.createElement("span");
  stateLabel.id = "account-state-label";
  stateLabel.className = "account-state-label";
  stateLabel.textContent = "未登录";

  const trigger = document.createElement("button");
  trigger.id = "account-button";
  trigger.className = "account-button";
  trigger.type = "button";
  trigger.textContent = "登录保存进度";
  trigger.addEventListener("click", () => {
    if (cloudState.user) {
      showAccountNotice("你已登录，训练进度正在同步到云端。", "success");
      return;
    }
    document.querySelector("#account-dialog")?.showModal();
  });

  const signOutButton = document.createElement("button");
  signOutButton.id = "account-signout-quick";
  signOutButton.className = "account-signout-quick hidden";
  signOutButton.type = "button";
  signOutButton.textContent = "退出登录";
  signOutButton.addEventListener("click", signOut);

  const notice = document.createElement("p");
  notice.id = "account-inline-status";
  notice.className = "account-inline-status";
  notice.setAttribute("aria-live", "polite");

  controls.append(stateLabel, trigger, signOutButton, notice);
  host.append(controls);

  const dialog = document.createElement("dialog");
  dialog.id = "account-dialog";
  dialog.className = "account-dialog";
  dialog.innerHTML = [
    '<form class="account-dialog-card" novalidate>',
    '<button class="dialog-close-button" type="button" aria-label="关闭">×</button>',
    '<p class="eyebrow">账户与进度</p>',
    '<h2 id="account-dialog-title">登录以保存进度</h2>',
    '<p id="account-dialog-copy" class="account-dialog-copy">登录后，你的训练记录会自动保存到云端，并在不同设备间同步。</p>',
    '<div id="account-form-fields" class="account-form-fields">',
    '<label>邮箱<input id="account-email" type="email" autocomplete="email" required placeholder="name@example.com" /></label>',
    '<label>密码<input id="account-password" type="password" autocomplete="current-password" minlength="8" required placeholder="至少 8 位" /></label>',
    '<button id="account-submit-button" class="primary-button" type="button">登录</button>',
    '<button id="account-mode-button" class="text-button" type="button">还没有账号？注册</button>',
    '</div>',
    '<div id="account-signed-in" class="account-signed-in hidden">',
    '<p id="account-email-display"></p><button id="account-signout-button" class="secondary-button" type="button">退出登录</button>',
    '</div>',
    '<p id="account-status" class="account-status" aria-live="polite"></p>',
    '<p class="account-disclaimer">账号仅用于保存训练进度。密码由 Supabase Auth 安全处理，本工具不会保存或查看你的密码。</p>',
    '</form>'
  ].join("");
  document.body.append(dialog);
  dialog.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    void submitAccountForm();
  });
  dialog.querySelector("#account-submit-button").addEventListener("click", submitAccountForm);
  dialog.querySelector("#account-mode-button").addEventListener("click", toggleAccountMode);
  dialog.querySelector("#account-signout-button").addEventListener("click", signOut);
  dialog.querySelector(".dialog-close-button").addEventListener("click", () => dialog.close());
}

function renderAccountInterface() {
  const trigger = document.querySelector("#account-button");
  const stateLabel = document.querySelector("#account-state-label");
  const quickSignOut = document.querySelector("#account-signout-quick");
  const signedIn = Boolean(cloudState.user);
  if (trigger) {
    trigger.classList.toggle("signed-in", signedIn);
    trigger.textContent = signedIn ? "已登录 · 云端同步" : "登录保存进度";
    trigger.setAttribute("aria-label", signedIn ? "当前已登录，云端同步已开启" : "登录后保存训练进度");
    trigger.disabled = signedIn || (!cloudState.config && cloudState.ready);
  }
  if (stateLabel) {
    stateLabel.classList.toggle("signed-in", signedIn);
    stateLabel.textContent = signedIn ? "已登录" : "未登录";
  }
  if (quickSignOut) quickSignOut.classList.toggle("hidden", !signedIn);
  const form = document.querySelector("#account-form-fields");
  const signedInView = document.querySelector("#account-signed-in");
  if (!form || !signedInView) return;
  form.classList.toggle("hidden", signedIn);
  signedInView.classList.toggle("hidden", !signedIn);
  const email = document.querySelector("#account-email-display");
  if (email) email.textContent = signedIn ? "当前账号：" + (cloudState.user.email || "已登录用户") : "";
}

function toggleAccountMode() {
  const submit = document.querySelector("#account-submit-button");
  const registering = submit.dataset.mode !== "register";
  submit.dataset.mode = registering ? "register" : "signin";
  submit.textContent = registering ? "注册" : "登录";
  document.querySelector("#account-dialog-title").textContent = registering ? "注册账号" : "登录以保存进度";
  document.querySelector("#account-dialog-copy").textContent = registering
    ? "注册后需要完成邮箱验证。验证成功后即可登录并同步训练记录。"
    : "登录后，你的训练记录会自动保存到云端，并在不同设备间同步。";
  document.querySelector("#account-mode-button").textContent = registering ? "已有账号？登录" : "还没有账号？注册";
  document.querySelector("#account-password").autocomplete = registering ? "new-password" : "current-password";
  setAccountStatus("");
}

async function submitAccountForm() {
  if (!cloudState.config) return setAccountStatus("账号服务正在配置，请稍后再试。", "error");
  const email = document.querySelector("#account-email").value.trim();
  const password = document.querySelector("#account-password").value;
  const submit = document.querySelector("#account-submit-button");
  const registering = submit.dataset.mode === "register";
  if (!email || password.length < 8) return setAccountStatus("请输入有效邮箱和至少 8 位密码。", "error");
  submit.disabled = true;
  setAccountStatus(registering ? "正在创建账号..." : "正在登录...");
  try {
    const data = registering
      ? await authRequest("/auth/v1/signup", { email, password, options: { emailRedirectTo: window.location.origin } })
      : await authRequest("/auth/v1/token?grant_type=password", { email, password });
    const session = data.session || (data.access_token ? data : null);
    if (registering && !session) {
      setAccountStatus("注册成功，请前往邮箱完成验证后再登录。", "success");
    } else {
      if (!session?.access_token) {
        throw new Error("登录未取得有效会话。请完成邮箱验证后重新登录。");
      }
      await setSession(session);
      setAccountStatus("登录成功，正在同步你的训练进度。", "success");
      document.querySelector("#account-dialog")?.close();
      showAccountNotice("登录成功，云端同步已开启。", "success");
    }
  } catch (error) {
    setAccountStatus(error.message || "操作未完成，请检查邮箱和密码后重试。", "error");
  } finally {
    submit.disabled = false;
  }
}

async function restoreSession() {
  try {
    cloudState.user = await currentUser(cloudState.session.access_token);
  } catch {
    try {
      const next = await authRequest("/auth/v1/token?grant_type=refresh_token", { refresh_token: cloudState.session.refresh_token });
      await setSession(next, false);
    } catch {
      clearSession(false);
    }
  }
}

async function setSession(session, announce = true) {
  cloudState.session = session;
  writeSession(session);
  try {
    cloudState.user = await currentUser(session.access_token);
  } catch (error) {
    clearSession(false);
    throw new Error(error.message || "登录凭证校验失败，请重新登录。");
  }
  try {
    await loadBadgeProgress();
  } catch {
    cloudState.badgeProgress = null;
  }
  renderAccountInterface();
  renderBadgeWall();
  if (announce) announceAuthChange();
}

async function signOut() {
  try {
    if (cloudState.session?.access_token) {
      await request("/auth/v1/logout", { method: "POST", headers: { Authorization: "Bearer " + cloudState.session.access_token } });
    }
  } catch {
    // Clearing this browser session is still the safe outcome.
  }
  clearSession();
  document.querySelector("#account-dialog")?.close();
  showAccountNotice("你已退出登录。当前记录仅保存在本机浏览器中。", "info");
}

function clearSession(announce = true) {
  cloudState.session = null;
  cloudState.user = null;
  cloudState.badgeProgress = null;
  window.localStorage.removeItem(CLOUD_SESSION_KEY);
  renderAccountInterface();
  renderBadgeWall();
  if (announce) announceAuthChange();
}

async function loadProgress(module) {
  if (!cloudState.user || !cloudState.session) return null;
  const rows = await request("/rest/v1/user_progress?module=eq." + encodeURIComponent(module) + "&select=payload&limit=1", {
    headers: { Authorization: "Bearer " + cloudState.session.access_token }
  });
  return Array.isArray(rows) && rows[0]?.payload ? rows[0].payload : null;
}

async function saveProgress(module, payload) {
  if (!cloudState.user || !cloudState.session) return false;
  await request("/rest/v1/user_progress?on_conflict=user_id,module", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + cloudState.session.access_token,
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({
      user_id: cloudState.user.id,
      module,
      payload,
      updated_at: new Date().toISOString()
    })
  });
  return true;
}

async function removeProgress(module) {
  if (!cloudState.user || !cloudState.session) return false;
  await request("/rest/v1/user_progress?module=eq." + encodeURIComponent(module), {
    method: "DELETE",
    headers: { Authorization: "Bearer " + cloudState.session.access_token }
  });
  return true;
}

async function loadBadgeProgress() {
  if (!cloudState.user || !cloudState.session) return null;
  const rows = await request("/rest/v1/user_badge_progress?select=module_counts,total_completed,seen_modules,updated_at&limit=1", {
    headers: { Authorization: "Bearer " + cloudState.session.access_token }
  });
  cloudState.badgeProgress = normalizeBadgeProgress(Array.isArray(rows) ? rows[0] : null);
  return cloudState.badgeProgress;
}

async function recordBadgeCompletion(module) {
  if (!cloudState.user || !cloudState.session) return { recorded: false, unlocked: [] };
  const previous = normalizeBadgeProgress(cloudState.badgeProgress);
  const before = new Set(BADGE_DEFINITIONS.filter((badge) => badge.unlocked(previous)).map((badge) => badge.id));
  const payload = await request("/rest/v1/rpc/record_badge_completion", {
    method: "POST",
    headers: { Authorization: "Bearer " + cloudState.session.access_token },
    body: JSON.stringify({ p_module: module, p_event_key: createBadgeEventKey() })
  });
  cloudState.badgeProgress = normalizeBadgeProgress(payload);
  const unlocked = BADGE_DEFINITIONS.filter((badge) => badge.unlocked(cloudState.badgeProgress) && !before.has(badge.id));
  if (unlocked.length) showAccountNotice(`解锁勋章：${unlocked.map((badge) => badge.title).join("、")}。`, "success");
  window.dispatchEvent(new CustomEvent("cbst:badgechange", { detail: { progress: cloudState.badgeProgress, unlocked } }));
  return { recorded: true, unlocked };
}

function normalizeBadgeProgress(value) {
  const moduleCounts = value?.moduleCounts || value?.module_counts || {};
  return {
    moduleCounts: moduleCounts && typeof moduleCounts === "object" ? moduleCounts : {},
    totalCompleted: Math.max(0, Number(value?.totalCompleted ?? value?.total_completed ?? 0) || 0),
    seenModules: Array.isArray(value?.seenModules ?? value?.seen_modules) ? (value.seenModules ?? value.seen_modules) : [],
    updatedAt: value?.updatedAt || value?.updated_at || ""
  };
}

function moduleCount(progress, module) {
  return Math.max(0, Number(progress.moduleCounts?.[module] || 0) || 0);
}

function moduleProgress(progress, module, target) {
  return `${Math.min(moduleCount(progress, module), target)}/${target} 次`;
}

function createBadgeEventKey() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function currentUser(accessToken) {
  return request("/auth/v1/user", { headers: { Authorization: "Bearer " + accessToken } });
}

function authRequest(path, body) {
  return request(path, { method: "POST", body: JSON.stringify(body) });
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch("/api/cloud?path=" + encodeURIComponent(path), {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      body: options.body
    });
  } catch {
    throw new Error("当前网络无法连接云端服务，请检查网络后重试。");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error_description || data.error || data.msg || "云端请求未完成。");
  }
  return data;
}

function announceAuthChange() {
  window.dispatchEvent(new CustomEvent("cbst:authchange", { detail: { user: cloudState.user } }));
}

function setAccountStatus(message, type = "") {
  const status = document.querySelector("#account-status");
  if (!status) return;
  status.className = "account-status " + type;
  status.textContent = message;
}

function showAccountNotice(message, type = "") {
  const notice = document.querySelector("#account-inline-status");
  if (!notice) return;
  notice.className = "account-inline-status " + type;
  notice.textContent = message;
  window.clearTimeout(showAccountNotice.timer);
  showAccountNotice.timer = window.setTimeout(() => {
    notice.textContent = "";
    notice.className = "account-inline-status";
  }, 3600);
}

function readSession() {
  try {
    return JSON.parse(window.localStorage.getItem(CLOUD_SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function writeSession(session) {
  window.localStorage.setItem(CLOUD_SESSION_KEY, JSON.stringify(session));
}
