"use strict";

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-terra";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY 未配置，当前无法调用 AI。" });
  }

  try {
    const body = req.body || {};

    if (body.action === "generate_case") {
      const payload = await generateCase(apiKey, body.config || {});
      return res.status(200).json({ case: payload, model: DEFAULT_MODEL });
    }

    if (body.action === "continue_dialogue") {
      const payload = await continueDialogue(apiKey, body.config || {}, body.caseData || {}, body.transcript || []);
      return res.status(200).json({ reply: payload, model: DEFAULT_MODEL });
    }

    if (body.action === "evaluate_dialogue") {
      const payload = await evaluateDialogue(apiKey, body.config || {}, body.caseData || {}, body.transcript || []);
      return res.status(200).json({ evaluation: payload, model: DEFAULT_MODEL });
    }

    if (body.action === "analyze_fallacies") {
      const payload = await analyzeFallacies(apiKey, body.text || "");
      return res.status(200).json({ analysis: payload, model: DEFAULT_MODEL });
    }

    return res.status(400).json({ error: "Unsupported action" });
  } catch (error) {
    return res.status(500).json({ error: error.message || "AI request failed" });
  }
};

async function generateCase(apiKey, config) {
  const schema = {
    summary: "基于用户参数补全出的生活化场景描述",
    openingLine: "AI 先说出的第一句话，不要带角色前缀",
    userRole: "用户在本轮固定扮演的角色",
    aiRole: "AI 在本轮固定扮演的角色",
    logicHints: ["一些/所有", "为什么/因为", "现在/以后"],
    hintReason: "为什么这 2 到 3 个逻辑字词适合当前第一轮",
    bannedTips: ["不要急着评价", "不要直接否定感受"]
  };

  const prompt = `
你是一个严格基于 CBST（认知行为社会训练）理论设计练习场景的中文教练。

任务：
根据用户输入的关系场景、AI 角色、用户角色和事件描述，生成一个真实生活里的双人模拟对话练习题。

必须遵守：
1. 这是双人对话，永远只有 2 个角色，不要生成第三人参与对话。
2. aiRole 必须是第一个开口说话的人，用户后续始终固定扮演 userRole。
3. summary 只写生活化情景描述，像真实人际场景，不要写成课程说明。
4. openingLine 必须是 aiRole 说出的第一句话，而且要自然、有情绪、有可对话性。
5. openingLine 只写台词内容，不要写“爸爸：”“领导：”这种前缀。
6. logicHints 只给 2 到 3 个最合适的 CBST 逻辑字词，必须真的和这个案例的第一轮对话有关。
7. hintReason 用一句简短中文说明这些字词为什么适合当前情境。
8. bannedTips 只输出 2 条最容易犯的错。
9. userRole 和 aiRole 必须严格沿用用户输入，不要擅自改角色。
10. 第一轮必须明确落在事件描述里的具体冲突点上，不能泛泛而谈。
11. 如果事件描述里提到具体行为、时间、人物期待或情绪线索，openingLine 必须体现至少一项。

用户输入参数：
- 关系场景：${sceneLabel(config.scene)}
- AI 角色：${config.aiRole}
- 用户角色：${config.userRole}
- 事件描述：${config.eventText}
`;

  return callJsonResponse(apiKey, prompt, schema, 1400);
}

async function continueDialogue(apiKey, config, caseData, transcript) {
  const schema = {
    counterpartReply: "AI 角色的下一句回应，不要带角色前缀",
    logicHints: ["为什么/因为", "一些/所有"],
    hintReason: "为什么当前这一轮推荐这几个逻辑字词",
    meta: "一句简短说明"
  };

  const prompt = `
你现在扮演案例中的 aiRole，继续这段多轮对话。

规则：
1. 你只能输出 aiRole 的下一句中文口语化回应，不要点评用户。
2. aiRole 和 userRole 在整段对话中绝对不能互换，不能串角色。
3. 如果用户上一句更符合 CBST，aiRole 可以更愿意表达、更具体。
4. 如果用户上一句在评价、压制、比较、否定感受、甩锅，aiRole 要自然地更防守、更退缩或更激动。
5. counterpartReply 控制在 1 到 3 句话。
6. logicHints 只推荐 2 到 3 个最适合用户下一轮继续练习的 CBST 逻辑字词。
7. hintReason 用一句中文说明推荐理由。
8. meta 简短说明当前这句的状态，例如“AI 延续对话”。
9. 你的回应必须直接承接用户上一句的意思，不能像没看见上一轮一样重新说一套模板话。
10. 你的回应必须继续围绕当前事件描述的核心冲突，不要突然跳到新的议题。
11. 如果用户在用 CBST 逻辑拆解，你要给出更具体的新信息，而不是重复“我很难受”“我很在意”这种空话。
12. 如果用户问了一个明确问题，你应优先回答这个问题，再表达自己的情绪或诉求。
13. 不要复读前面说过的话；每一轮都要推进一点点新的事实、感受、边界或期待。

案例背景：
- 关系场景：${sceneLabel(config.scene)}
- AI 角色：${caseData.aiRole}
- 用户角色：${caseData.userRole}
- 情景描述：${caseData.summary}
- 用户原始事件描述：${caseData.eventText || config.eventText || ""}

当前完整对话：
${formatTranscript(transcript)}
`;

  return callJsonResponse(apiKey, prompt, schema, 900);
}

async function evaluateDialogue(apiKey, config, caseData, transcript) {
  const schema = {
    score: "8.3",
    summary: "一句严格总评",
    strengths: ["优点1", "优点2"],
    weaknesses: ["不足1", "不足2"],
    logicUsed: ["一些/所有", "为什么/因为"],
    suggestedReply: "一段更符合 CBST 的改写示范",
    metrics: {
      empathy: "8",
      logic: "7",
      boundary: "6",
      action: "7"
    }
  };

  const prompt = `
你是一名严格按 CBST 理论打分的中文督导。

请只根据用户在这段对话中的真实表现做评估，要求直接、专业、克制，不要空泛鼓励。

输出要求：
1. score 为 10 分制，可保留 1 位小数。
2. metrics 固定为：共情、逻辑拆解、边界感、行动推进。
3. strengths 输出 2 到 4 条，必须具体。
4. weaknesses 输出 2 到 4 条，必须具体。
5. logicUsed 只写用户真实体现出的 CBST 逻辑，不要瞎补。
6. suggestedReply 要给一段明显更符合 CBST 的回复示范。
7. summary 要直接指出这段对话的总体质量，不要鸡汤式表达。

重点判断：
- 是否先共情，再拆解
- 是否避免评价、比较、读心、甩锅、否定感受、代替判断
- 是否用了有效的 CBST 逻辑字词
- 是否推动到具体、可执行的下一步

案例背景：
- 关系场景：${sceneLabel(config.scene)}
- AI 角色：${caseData.aiRole}
- 用户角色：${caseData.userRole}
- 情景描述：${caseData.summary}
- 用户原始事件描述：${caseData.eventText || config.eventText || ""}

完整对话：
${formatTranscript(transcript)}
`;

  return callJsonResponse(apiKey, prompt, schema, 1800);
}

const FALLACY_CATALOG = [
  ["非黑即白思维", "认知扭曲", "Beck，《Cognitive Therapy and the Emotional Disorders》"],
  ["过度概括", "认知扭曲", "Beck，《Cognitive Therapy and the Emotional Disorders》"],
  ["心理过滤", "认知扭曲", "Beck，《Cognitive Therapy and the Emotional Disorders》"],
  ["否定积极面", "认知扭曲", "Beck，《Cognitive Therapy and the Emotional Disorders》"],
  ["读心术", "认知扭曲", "Clark 与 Beck，《Cognitive Therapy of Anxiety Disorders》"],
  ["预言式思维", "认知扭曲", "Clark 与 Beck，《Cognitive Therapy of Anxiety Disorders》"],
  ["灾难化思维", "认知扭曲", "Beck，《Cognitive Therapy and the Emotional Disorders》"],
  ["情绪化推理", "认知扭曲", "Beck，《Cognitive Therapy and the Emotional Disorders》"],
  ["应该陈述", "认知扭曲", "Beck，《Cognitive Therapy and the Emotional Disorders》"],
  ["贴标签", "认知扭曲", "Beck，《Cognitive Therapy and the Emotional Disorders》"],
  ["个人化归因", "认知扭曲", "Beck，《Cognitive Therapy and the Emotional Disorders》"],
  ["放大或缩小", "认知扭曲", "Beck，《Cognitive Therapy and the Emotional Disorders》"],
  ["错误二分", "逻辑谬误", "Walton，《Informal Logic》"],
  ["诉诸人身", "逻辑谬误", "Walton，《Informal Logic》"],
  ["错误因果", "逻辑谬误", "Walton，《Informal Logic》"],
  ["滑坡谬误", "逻辑谬误", "Walton，《Informal Logic》"],
  ["稻草人谬误", "逻辑谬误", "Walton，《Informal Logic》"],
  ["以偏概全", "逻辑谬误", "Walton，《Informal Logic》"]
];

const FALLACY_BY_NAME = new Map(FALLACY_CATALOG.map(([name, category, sourceLabel]) => [name, { category, sourceLabel }]));
const FALLACY_ALIASES = new Map([
  ["二元思维", "非黑即白思维"],
  ["全或无思维", "非黑即白思维"],
  ["全有或全无思维", "非黑即白思维"],
  ["选择性注意", "心理过滤"],
  ["算命式思维", "预言式思维"],
  ["预言未来", "预言式思维"],
  ["灾难化", "灾难化思维"],
  ["贴标签思维", "贴标签"],
  ["个人化", "个人化归因"],
  ["以偏概全谬误", "以偏概全"]
]);

async function analyzeFallacies(apiKey, text) {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) throw new Error("请先输入需要分析的文本。");
  if (normalizedText.length > 6000) throw new Error("文本过长，请控制在 6000 字以内后再分析。");

  const schema = {
    status: "findings | none | insufficient_context",
    summary: "对判断范围的一句柔化说明",
    items: [
      {
        canonicalName: "仅能使用受控术语中的一个标准名称",
        role: "说话角色；无法判断时为空字符串",
        location: "原文第几句；单句可写原文",
        evidence: "从原文直接引用的短句",
        explanation: "解释这一表述可能呈现的思维或推理结构，不评价说话者"
      }
    ]
  };

  const catalogText = FALLACY_CATALOG.map(([name, category]) => `- ${name}（${category}）`).join("\n");
  const prompt = `
你是一个中文心理学教育与非形式逻辑辅助工具。你的任务是分析用户给出的文本中，是否存在有直接证据支持的认知扭曲或逻辑谬误。

严格边界：
1. 分析文本中的表达结构，不分析或诊断说话者的人格、心理健康或疾病。
2. 强烈情绪、合理担忧、价值分歧、反讽、转述、文学表达本身都不等于谬误；没有足够证据时不要贴标签。
3. 只能从下列受控术语清单中选择 canonicalName。不得发明术语、不得输出同义词或近义词。每个名称最多出现一次。
${catalogText}
4. “非黑即白思维”和“错误二分”只选最贴合的一项，不重复。类似地，概念重叠时选择最直接、最有证据的一项。
5. 最多返回 5 项。按原文证据强弱排序；不做严重程度排名。
6. 若文本没有充分证据支持任何一个术语，status 必须为 none，items 必须为空，summary 必须精确表达“该内容不存在任何谬误”。
7. 只有文本本身缺少完整主张、核心指代不可辨认或完全依赖前文时，才使用 insufficient_context。完整的单句也可以判断：只要句中有直接、明确的绝对化推断或推理结构，就应据此分析，不能因为没有更长背景而回避判断。
8. 例：对于“如果你不记得我的生日就是不爱我”，应返回 findings，并选择“非黑即白思维”；证据是“就是不爱我”，解释为把复杂的关爱关系压缩为二选一结论。
9. 只有确实有直接原文证据时，status 才可为 findings。所有 explanation 用“可能存在”“该表述可能呈现”等柔化语气。
10. 如文本是最多两名角色的对话，尽力识别“角色名：内容”中的角色和句子位置；格式不规范或无法确认时 role 留空，不得虚构。
11. evidence 必须是用户原文中的简短直接片段，不得改写或杜撰。explanation 只做通俗解释，限 80 字以内。

用户文本：
${normalizedText}
`;

  const payload = await callJsonResponse(apiKey, prompt, schema, 1800);
  return normalizeFallacyAnalysis(payload);
}

function normalizeFallacyAnalysis(payload) {
  const status = ["findings", "none", "insufficient_context"].includes(payload?.status) ? payload.status : "insufficient_context";
  if (status !== "findings") {
    return {
      status,
      summary: status === "none"
        ? "该内容不存在任何谬误。"
        : "仅凭当前文本，暂无法判断是否存在明确的认知或逻辑谬误；可补充前后语境后再分析。",
      items: []
    };
  }

  const seen = new Set();
  const items = Array.isArray(payload.items) ? payload.items : [];
  const normalizedItems = items
    .map((item) => {
      return { ...item, canonicalName: normalizeCanonicalName(item?.canonicalName) };
    })
    .filter((item) => item && FALLACY_BY_NAME.has(String(item.canonicalName || "")))
    .filter((item) => {
      const name = String(item.canonicalName);
      if (seen.has(name)) return false;
      seen.add(name);
      return String(item.evidence || "").trim().length > 0;
    })
    .slice(0, 5)
    .map((item) => {
      const name = String(item.canonicalName).trim();
      const reference = FALLACY_BY_NAME.get(name);
      return {
        canonicalName: name,
        category: reference.category,
        sourceLabel: reference.sourceLabel,
        role: cleanAnalysisText(item.role, 40),
        location: cleanAnalysisText(item.location, 60),
        evidence: cleanAnalysisText(item.evidence, 180),
        explanation: cleanAnalysisText(item.explanation, 180)
      };
    });

  if (!normalizedItems.length) {
    return {
      status: "insufficient_context",
      summary: "仅凭当前文本，暂无法判断是否存在明确的认知或逻辑谬误；可补充前后语境后再分析。",
      items: []
    };
  }

  return {
    status: "findings",
    summary: cleanAnalysisText(payload.summary, 220) || "以下为基于原文证据的可能思维模式，仅供学习与自我观察。",
    items: normalizedItems
  };
}

function normalizeCanonicalName(value) {
  const rawName = String(value || "").trim();
  const withoutCategory = rawName.replace(/[（(][^（）()]*[）)]/g, "").trim();
  return FALLACY_ALIASES.get(withoutCategory) || withoutCategory;
}

function cleanAnalysisText(value, limit) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, limit);
}

async function callJsonResponse(apiKey, prompt, schema, maxOutputTokens) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `${prompt}\n\n只输出严格 JSON，不要 Markdown，不要代码块。JSON 结构如下：${JSON.stringify(schema)}`
            }
          ]
        }
      ],
      max_output_tokens: maxOutputTokens,
      text: { verbosity: "medium" }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI 请求失败：${response.status}`);
  }

  return parseJson(getOutputText(data));
}

function getOutputText(response) {
  if (typeof response.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  const chunks = [];
  for (const item of response.output || []) {
    for (const part of item.content || []) {
      if (typeof part.text === "string") chunks.push(part.text);
    }
  }
  return chunks.join("\n").trim();
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const trimmed = String(text || "").trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return parseJson(fenced[1]);
    const match = trimmed.match(/\{[\s\S]*\}/) || trimmed.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    throw new Error("AI 返回内容不是有效 JSON");
  }
}

function formatTranscript(transcript) {
  return transcript.map((item, index) => `${index + 1}. ${item.speaker}：${item.text}`).join("\n");
}

function sceneLabel(scene) {
  if (scene === "parent-child") return "亲子关系";
  if (scene === "intimacy") return "亲密关系";
  if (scene === "workplace") return "职场沟通";
  return "父母关系";
}
