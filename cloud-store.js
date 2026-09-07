"use strict";

const CLOUD_SESSION_KEY = "cbst-cloud-session-v1";
const cloudState = { config: null, session: null, user: null, ready: false };

window.CBSTCloud = {
  isSignedIn: () => Boolean(cloudState.user),
  getUser: () => cloudState.user,
  loadProgress,
  saveProgress,
  removeProgress
};

void init();

async function init() {
  injectAccountInterface();
  try {
    const response = await fetch("./api/public-config", { cache: "no-store" });
    const config = await response.json();
    if (response.ok && config.cloudSyncEnabled) {
      cloudState.config = config;
      cloudState.session = readSession();
      if (cloudState.session) await restoreSession();
    }
  } catch {
    // The local version remains fully usable before cloud sync is configured.
  } finally {
    cloudState.ready = true;
    renderAccountInterface();
    announceAuthChange();
  }
}

function injectAccountInterface() {
  const host = document.querySelector(".module-hub-actions") || document.querySelector(".module-hub");
  if (!host || document.querySelector("#account-button")) return;

  const trigger = document.createElement("button");
  trigger.id = "account-button";
  trigger.className = "account-button";
  trigger.type = "button";
  trigger.textContent = "登录保存进度";
  trigger.addEventListener("click", () => document.querySelector("#account-dialog")?.showModal());
  host.append(trigger);

  const dialog = document.createElement("dialog");
  dialog.id = "account-dialog";
  dialog.className = "account-dialog";
  dialog.innerHTML = [
    '<form method="dialog" class="account-dialog-card">',
    '<button class="dialog-close-button" value="cancel" aria-label="关闭">×</button>',
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
  dialog.querySelector("#account-submit-button").addEventListener("click", submitAccountForm);
  dialog.querySelector("#account-mode-button").addEventListener("click", toggleAccountMode);
  dialog.querySelector("#account-signout-button").addEventListener("click", signOut);
}

function renderAccountInterface() {
  const trigger = document.querySelector("#account-button");
  const signedIn = Boolean(cloudState.user);
  if (trigger) {
    trigger.classList.toggle("signed-in", signedIn);
    trigger.textContent = signedIn ? "已登录 · 云端同步" : "登录保存进度";
    trigger.disabled = !cloudState.config && cloudState.ready;
  }
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
    if (data.session) await setSession(data.session);
    if (registering && !data.session) {
      setAccountStatus("注册成功，请前往邮箱完成验证后再登录。", "success");
    } else {
      setAccountStatus("登录成功，正在同步你的训练进度。", "success");
      document.querySelector("#account-dialog")?.close();
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
  cloudState.user = await currentUser(session.access_token);
  renderAccountInterface();
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
}

function clearSession(announce = true) {
  cloudState.session = null;
  cloudState.user = null;
  window.localStorage.removeItem(CLOUD_SESSION_KEY);
  renderAccountInterface();
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

function currentUser(accessToken) {
  return request("/auth/v1/user", { headers: { Authorization: "Bearer " + accessToken } });
}

function authRequest(path, body) {
  return request(path, { method: "POST", body: JSON.stringify(body) });
}

async function request(path, options = {}) {
  const response = await fetch(cloudState.config.supabaseUrl + path, {
    method: options.method || "GET",
    headers: {
      apikey: cloudState.config.supabasePublishableKey,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error_description || data.msg || "云端请求未完成。");
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
