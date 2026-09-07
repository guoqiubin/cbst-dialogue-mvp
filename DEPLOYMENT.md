# CBST 对话练习器 MVP 部署说明

这个版本已经改成一个可本地直接运行的小项目：

- 静态前端
- 本地 Node 服务器 `server.js`
- AI 路由 `api/chat.js`
- 通过 `OPENAI_API_KEY` 调用 OpenAI Responses API

## 文件结构

- `index.html`
- `styles.css`
- `app.js`
- `server.js`
- `api/chat.js`
- `package.json`
- `.env.example`

## 本地测试

### 本地完整运行

```bash
cd cbst-dialogue-mvp
cp .env.example .env
# 把 .env 里的 OPENAI_API_KEY 改成真实值
npm run dev
```

然后打开 `http://127.0.0.1:3000`。

说明：

- `npm run dev` 会同时提供页面和 `/api/chat`
- 如果 `.env` 里没有配置 `OPENAI_API_KEY`，页面会明确提示未连接 OpenAI，不能继续生成真实对话
- 配好 `OPENAI_API_KEY` 后，案例生成、继续对话、结束点评都会走真实 AI

### 仅做语法检查

```bash
cd cbst-dialogue-mvp
npm run check
```

## MVP 测试部署

适合先验证产品闭环，不处理中国大陆稳定访问问题。

### 方式 1：Vercel

推荐用于 MVP 测试，因为它同时支持静态文件和 `api/` 目录下的 Serverless Function。

需要配置：

- `OPENAI_API_KEY`
- 可选：`OPENAI_MODEL`

默认模型当前写死为 `gpt-5.6-terra`，也可以通过 `OPENAI_MODEL` 覆盖。

## 账号与云端进度

生产环境使用 Supabase Auth 提供邮箱和密码登录，应用不处理用户密码。登录后会同步 CBST 对话、认知谬误识别和逻辑字词训练的进度。

在 Vercel 的 Production 与 Preview 环境中配置：

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

不要提交 `.env`，不要在聊天中传递 `OPENAI_API_KEY`、数据库密码或 Supabase 服务端密钥。`SUPABASE_PUBLISHABLE_KEY` 仅用于浏览器访问，其安全性由数据库行级权限策略保证。

数据库迁移位于 `supabase/migrations/`。创建 Supabase 项目并关联 GitHub 后，推送迁移即可部署数据表与权限规则。

### 方式 2：其他支持 Node Serverless 的平台

前提是平台既能托管静态文件，也能运行 `api/chat.js`。

## 下一阶段建议

- 现在已经接入真实 AI，下一步建议补更细的案例参数和对话历史管理。
- 再下一步，可以做题库后台和双区域部署策略。
