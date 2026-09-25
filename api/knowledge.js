"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const mammoth = require("mammoth");
const JSZip = require("jszip");
const { PDFParse } = require("pdf-parse");

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 45000;
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-terra";
const ALLOWED_TYPES = new Map([
  ["application/pdf", "pdf"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
  ["text/plain", "text"],
  ["text/markdown", "markdown"]
]);
const MODULE_TAGS = new Set(["global", "dialogue", "logic-training", "cognitive", "empathy", "listening"]);
const LEGACY_SOURCE_ID = "9eab3213-4b55-4fa1-93ca-5c5c7f6f2ab9";
const LEGACY_KNOWLEDGE_PATH = path.join(__dirname, "..", "knowledge-base", "cbst-core.json");

module.exports = async function handler(req, res) {
  try {
    const body = req.method === "GET" ? req.query || {} : req.body || {};
    const admin = await requireAdmin(req);
    const action = body.action || "list";

    if (action === "list") return res.status(200).json(await listSources());
    if (action === "ingest") return res.status(201).json(await ingestSource(body, admin));
    if (action === "publish") return res.status(200).json(await publishSource(body.sourceId));
    if (action === "retract") return res.status(200).json(await retractSource(body.sourceId));
    if (action === "restore") return res.status(200).json(await restoreSource(body.sourceId));
    if (action === "delete") return res.status(200).json(await deleteSource(body.sourceId));
    if (action === "purge") return res.status(200).json(await purgeSource(body.sourceId));

    return res.status(400).json({ error: "不支持的知识库操作。" });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || "知识库请求未完成。" });
  }
};

async function requireAdmin(req) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const adminEmails = String(process.env.ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!supabaseUrl || !publishableKey || !process.env.SUPABASE_SERVICE_ROLE_KEY || !adminEmails.length) {
    const error = new Error("知识库后台尚未完成服务端配置。请联系管理员补充后台密钥。 ");
    error.statusCode = 503;
    throw error;
  }
  const authorization = getAuthorization(req);
  if (!authorization) return forbidden("请先登录后再进入知识库后台。");
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publishableKey, Authorization: authorization }
  });
  if (!response.ok) return forbidden("登录状态已失效，请重新登录后再进入知识库后台。");
  const user = await response.json();
  if (!adminEmails.includes(String(user.email || "").toLowerCase())) return forbidden("当前账号没有知识库后台访问权限。");
  return user;
}

function forbidden(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

function getAuthorization(req) {
  const raw = req.headers?.authorization || req.headers?.Authorization || "";
  return raw.startsWith("Bearer ") ? raw : "";
}

function serviceHeaders(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra
  };
}

async function supabase(path, options = {}) {
  const response = await fetch(`${process.env.SUPABASE_URL}${path}`, {
    ...options,
    headers: serviceHeaders(options.headers)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || data?.error || "云端知识库请求未完成。");
  }
  return data;
}

async function listSources() {
  await ensureLegacyKnowledge();
  const sources = await supabase("/rest/v1/knowledge_sources?select=*&order=updated_at.desc", {
    headers: { Accept: "application/json" }
  });
  return { sources: Array.isArray(sources) ? sources : [] };
}

async function ensureLegacyKnowledge() {
  const existing = await supabase(`/rest/v1/knowledge_sources?id=eq.${LEGACY_SOURCE_ID}&select=id&limit=1`, { headers: { Accept: "application/json" } });
  if (Array.isArray(existing) && existing.length) return;
  let legacy;
  try { legacy = JSON.parse(fs.readFileSync(LEGACY_KNOWLEDGE_PATH, "utf8")); } catch { return; }
  const rows = Array.isArray(legacy.entries) ? legacy.entries : [];
  if (!rows.length) return;
  const source = {
    id: LEGACY_SOURCE_ID,
    title: "历史 CBST 核心资料",
    source_type: "legacy",
    extracted_text: "本项目既有结构化 CBST 规则与案例，已迁移为云端知识库的初始已发布资料。",
    summary: "项目原有的 CBST 结构化知识已保留，并作为第一份已发布资料迁入云端。",
    module_tags: ["dialogue", "logic-training", "cognitive", "empathy", "listening", "global"],
    status: "published",
    entry_count: rows.length,
    published_at: new Date().toISOString()
  };
  await supabase("/rest/v1/knowledge_sources", { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(source) });
  const entries = rows.map((entry) => ({
    id: crypto.randomUUID(), source_id: LEGACY_SOURCE_ID, title: cleanText(entry.section || "CBST 核心规则", 160), entry_type: "rule",
    module_tags: normalizeModules(entry.modules), section_label: cleanText(entry.section, 160), content: cleanText(entry.rule, 1800), example: cleanText(entry.example, 700), citation_label: cleanText(entry.citationLabel || entry.source || "历史 CBST 核心资料", 200), status: "published"
  })).filter((entry) => entry.content);
  if (entries.length) await supabase("/rest/v1/knowledge_entries", { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(entries) });
}

async function ingestSource(body, admin) {
  const title = cleanText(body.title, 120) || "未命名资料";
  const moduleTags = normalizeModules(body.moduleTags);
  const sourceId = crypto.randomUUID();
  const file = normalizeFile(body.file);
  const pastedText = cleanText(body.pastedText, MAX_EXTRACTED_CHARS);
  if (!file && !pastedText) throw new Error("请上传一份资料，或粘贴需要入库的文本。");

  const sourceType = file ? file.type : "text";
  const source = {
    id: sourceId,
    title,
    source_type: sourceType,
    storage_path: null,
    extracted_text: "",
    summary: "",
    module_tags: moduleTags,
    status: "processing",
    entry_count: 0,
    source_note: cleanText(body.sourceNote, 400),
    created_by: admin.id
  };

  await supabase("/rest/v1/knowledge_sources", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(source)
  });

  try {
    let rawText = pastedText;
    if (file) {
      await uploadOriginal(sourceId, file);
      rawText = await extractFileText(file);
      source.storage_path = `${sourceId}/${file.name}`;
    }
    if (!rawText) throw new Error("未能从该资料中提取可用文字。请尝试粘贴文本或换用可复制文字的文件。");

    const extraction = await extractKnowledge(rawText, title, moduleTags);
    const entries = normalizeEntries(extraction.entries, sourceId, moduleTags);
    await supabase("/rest/v1/knowledge_entries", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(entries)
    });
    const updated = await supabase(`/rest/v1/knowledge_sources?id=eq.${sourceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({
        storage_path: source.storage_path,
        extracted_text: rawText.slice(0, MAX_EXTRACTED_CHARS),
        summary: cleanText(extraction.summary, 800),
        status: "draft",
        entry_count: entries.length,
        updated_at: new Date().toISOString()
      })
    });
    return { source: updated?.[0] || { ...source, status: "draft", entry_count: entries.length }, entries };
  } catch (error) {
    await supabase(`/rest/v1/knowledge_sources?id=eq.${sourceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ status: "failed", summary: cleanText(error.message, 800), updated_at: new Date().toISOString() })
    });
    throw error;
  }
}

async function uploadOriginal(sourceId, file) {
  const response = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/course-sources/${encodeURIComponent(sourceId)}/${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: serviceHeaders({ "Content-Type": file.mimeType, "x-upsert": "false" }),
    body: file.buffer
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "原始资料保存失败。");
  }
}

async function extractFileText(file) {
  if (file.type === "text" || file.type === "markdown") return cleanText(file.buffer.toString("utf8"), MAX_EXTRACTED_CHARS);
  if (file.type === "docx") {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return cleanText(result.value, MAX_EXTRACTED_CHARS);
  }
  if (file.type === "pptx") return extractOfficeZipText(file.buffer, "ppt/slides/slide");
  if (file.type === "pdf") {
    const parser = new PDFParse({ data: file.buffer });
    try {
      const result = await parser.getText();
      return cleanText(result.text, MAX_EXTRACTED_CHARS);
    } finally {
      await parser.destroy();
    }
  }
  throw new Error("暂不支持该文件格式。");
}

async function extractOfficeZipText(buffer, prefix) {
  const zip = await JSZip.loadAsync(buffer);
  const files = Object.keys(zip.files).filter((name) => name.startsWith(prefix) && name.endsWith(".xml")).sort(naturalSort);
  const chunks = [];
  for (const name of files) {
    const xml = await zip.file(name).async("text");
    const text = xml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) || xml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
    const plain = text.map((part) => part.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
    if (plain.length) chunks.push(plain.join(" "));
  }
  return cleanText(chunks.join("\n"), MAX_EXTRACTED_CHARS);
}

function naturalSort(left, right) {
  return left.localeCompare(right, undefined, { numeric: true });
}

function normalizeFile(input) {
  if (!input?.base64 || !input?.name) return null;
  const buffer = Buffer.from(String(input.base64), "base64");
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw new Error("资料请控制在 4MB 以内后再上传。");
  const name = String(input.name).replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, "_").slice(0, 120);
  const extension = name.split(".").pop().toLowerCase();
  const type = ALLOWED_TYPES.get(String(input.mimeType || "").toLowerCase()) || ({ pdf: "pdf", docx: "docx", pptx: "pptx", txt: "text", md: "markdown", markdown: "markdown" }[extension]);
  if (!type) throw new Error("仅支持 PPTX、PDF、DOCX、Markdown、TXT 或直接粘贴文本。");
  return { name, type, mimeType: String(input.mimeType || "application/octet-stream"), buffer };
}

async function extractKnowledge(rawText, title, moduleTags) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY 未配置，暂时无法解析资料。");
  const schema = {
    summary: "用两到三句说明资料的专业主题和可用范围",
    entries: [{ title: "知识点标题", entryType: "rule | case | term | safety | guidance", moduleTags: ["global"], sectionLabel: "章节或页码；无法确认时写资料概述", content: "可执行的专业规则或定义", example: "简短例子；没有则空字符串", citationLabel: "面向用户的简短课程依据" }]
  };
  const prompt = `你是中文心理教育产品的课程资料编辑。请从以下资料中提取可用于训练生成与点评的专业知识草稿。\n\n严格要求：\n1. 只提取原资料清晰支持的规则、定义、案例、边界或安全提示；不补充未经资料支持的结论。\n2. 使用教学性、非诊断式中文。\n3. 最多生成 18 条高价值、彼此不重复的条目。\n4. 每条 content 必须能被模型直接用于出题或点评；不要复制长段原文。\n5. moduleTags 只能从：global、dialogue、logic-training、cognitive、empathy、listening 中选择；优先使用资料建议范围 ${moduleTags.join("、")}。\n6. entryType 只能为 rule、case、term、safety、guidance。\n7. citationLabel 保留资料名和简短章节线索，不得杜撰具体页码。\n\n资料名称：${title}\n\n资料正文：\n${rawText.slice(0, MAX_EXTRACTED_CHARS)}`;
  return callJsonResponse(apiKey, prompt, schema, 5000);
}

function normalizeEntries(entries, sourceId, defaultModules) {
  const validTypes = new Set(["rule", "case", "term", "safety", "guidance"]);
  const normalized = (Array.isArray(entries) ? entries : []).map((entry) => ({
    id: crypto.randomUUID(),
    source_id: sourceId,
    title: cleanText(entry?.title, 160) || "未命名知识点",
    entry_type: validTypes.has(entry?.entryType) ? entry.entryType : "guidance",
    module_tags: normalizeModules(entry?.moduleTags?.length ? entry.moduleTags : defaultModules),
    section_label: cleanText(entry?.sectionLabel, 160),
    content: cleanText(entry?.content, 1800),
    example: cleanText(entry?.example, 700),
    citation_label: cleanText(entry?.citationLabel, 200),
    status: "draft"
  })).filter((entry) => entry.content);
  if (!normalized.length) throw new Error("AI 未能从这份资料中提取可审核的知识条目。");
  return normalized.slice(0, 18);
}

function normalizeModules(value) {
  const values = (Array.isArray(value) ? value : [value]).filter((tag) => MODULE_TAGS.has(tag));
  return values.length ? [...new Set(values)] : ["global"];
}

async function publishSource(sourceId) {
  const source = await getSource(sourceId);
  if (!source) throw new Error("未找到该资料。");
  const now = new Date().toISOString();
  await supabase(`/rest/v1/knowledge_entries?source_id=eq.${sourceId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ status: "published", updated_at: now })
  });
  const rows = await supabase(`/rest/v1/knowledge_sources?id=eq.${sourceId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ status: "published", published_at: now, deleted_at: null, purge_after: null, updated_at: now })
  });
  return { source: rows?.[0] };
}

async function retractSource(sourceId) {
  const source = await getSource(sourceId);
  if (!source) throw new Error("未找到该资料。");
  const now = new Date().toISOString();
  await supabase(`/rest/v1/knowledge_entries?source_id=eq.${sourceId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ status: "retracted", updated_at: now })
  });
  const rows = await supabase(`/rest/v1/knowledge_sources?id=eq.${sourceId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ status: "retracted", updated_at: now })
  });
  return { source: rows?.[0], impactCount: source.entry_count };
}

async function restoreSource(sourceId) {
  const source = await getSource(sourceId);
  if (!source) throw new Error("未找到该资料。");
  const nextStatus = source.published_at ? "published" : "draft";
  const entryStatus = nextStatus === "published" ? "published" : "draft";
  const now = new Date().toISOString();
  await supabase(`/rest/v1/knowledge_entries?source_id=eq.${sourceId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ status: entryStatus, updated_at: now })
  });
  const rows = await supabase(`/rest/v1/knowledge_sources?id=eq.${sourceId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ status: nextStatus, deleted_at: null, purge_after: null, updated_at: now })
  });
  return { source: rows?.[0] };
}

async function deleteSource(sourceId) {
  const source = await getSource(sourceId);
  if (!source) throw new Error("未找到该资料。");
  const now = new Date();
  const purgeAfter = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await supabase(`/rest/v1/knowledge_entries?source_id=eq.${sourceId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ status: "retracted", updated_at: now.toISOString() })
  });
  const rows = await supabase(`/rest/v1/knowledge_sources?id=eq.${sourceId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ status: "deleted", deleted_at: now.toISOString(), purge_after: purgeAfter, updated_at: now.toISOString() })
  });
  return { source: rows?.[0], impactCount: source.entry_count };
}

async function purgeSource(sourceId) {
  const source = await getSource(sourceId);
  if (!source || source.status !== "deleted") throw new Error("仅可永久删除已撤回的资料。");
  if (!source.purge_after || new Date(source.purge_after).getTime() > Date.now()) throw new Error("该资料仍在 30 天可恢复期内，暂不可永久删除。");
  if (source.storage_path) {
    await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/course-sources/${source.storage_path.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE", headers: serviceHeaders() });
  }
  await supabase(`/rest/v1/knowledge_sources?id=eq.${sourceId}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  return { deleted: true };
}

async function getSource(sourceId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(sourceId || ""))) throw new Error("资料标识无效。");
  const rows = await supabase(`/rest/v1/knowledge_sources?id=eq.${sourceId}&select=*`, { headers: { Accept: "application/json" } });
  return rows?.[0] || null;
}

function cleanText(value, limit) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, limit);
}

async function callJsonResponse(apiKey, prompt, schema, maxOutputTokens) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: DEFAULT_MODEL, input: prompt, max_output_tokens: maxOutputTokens, text: { verbosity: "medium" } })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "AI 资料解析未完成。");
  const text = data.output_text || (data.output || []).flatMap((item) => item.content || []).map((item) => item.text || "").join("\n");
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI 返回的资料解析格式无效。");
  return JSON.parse(match[0]);
}
