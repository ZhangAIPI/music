import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = __dirname;
const dataPath = path.join(__dirname, "data", "songs.json");
const port = Number(process.env.PORT || 5177);

function parseDotenvLike(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colonMatch = line.match(/^([^:=]+?)\s*[：:]\s*(.+)$/);
    const equalMatch = line.match(/^([^=]+?)=(.+)$/);
    const match = equalMatch || colonMatch;
    if (!match) continue;
    values[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return values;
}

async function loadLocalSecrets() {
  const envPath = path.join(__dirname, ".env");
  const parentSecretsPath = path.join(__dirname, "..", "secrets_list.txt");
  const source = existsSync(envPath) ? envPath : parentSecretsPath;
  if (!existsSync(source)) return {};
  try {
    return parseDotenvLike(await readFile(source, "utf8"));
  } catch {
    return {};
  }
}

const localSecrets = await loadLocalSecrets();
const config = {
  apiKey: process.env.OPENAI_API_KEY || localSecrets.OPENAI_API_KEY,
  xApiKey: process.env.X_API_KEY || localSecrets.X_API_KEY,
  baseUrl: (process.env.OPENAI_BASE_URL || localSecrets.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
  model: process.env.OPENAI_MODEL || localSecrets.OPENAI_MODEL || "gpt-4o-mini"
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg"
};

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function decodePayloadParam(value) {
  if (!value) return {};
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders() });
  res.end(JSON.stringify(payload));
}

function fallbackPlan({ audience, duration, goals, selectedSongs }) {
  const titles = selectedSongs.map((song) => song.title).join("、") || "所选曲目";
  return {
    title: `${audience || "学生"}中国音乐一课时方案`,
    overview: `围绕${titles}进行聆听、模唱、节奏/音色辨识和文化连接，形成一节可直接试教的 ${duration || 40} 分钟课程。`,
    objectives: [
      "学生能说出至少两种中国传统音色或民歌旋律特征。",
      "学生能用拍手、哼唱或图形谱表现关键节奏/旋律动机。",
      "学生能联系曲目来源，说出一个音乐与生活场景的关系。"
    ],
    materials: ["音频播放器", "投影/白板", "节奏卡", "学生记录单"],
    flow: [
      { time: "0-5 分钟", step: "导入", teacher: "播放第一首曲目 20 秒，邀请学生用一个词描述声音。", student: "聆听并快速分享感受。" },
      { time: "5-12 分钟", step: "聚焦听辨", teacher: "二次播放，提示学生关注音色、速度、强弱和乐句。", student: "用手势标记听到的重复或变化。" },
      { time: "12-22 分钟", step: "模唱/模奏", teacher: "提取一个短动机，用柯达伊手势或节奏读法带练。", student: "分组模唱、拍击或用课堂乐器回应。" },
      { time: "22-32 分钟", step: "创编迁移", teacher: "给出限制：保留节奏或五声音阶，改编 4 小节回应句。", student: "小组创编并展示。" },
      { time: "32-40 分钟", step: "总结评估", teacher: "回到原曲，询问学生能听到哪些新线索。", student: "完成出口条：一个音乐发现、一个文化连接。" }
    ],
    differentiation: ["低龄学生减少术语，增加动作回应。", "进阶学生加入调式、曲式或历史录音讨论。"],
    assessment: ["观察学生能否稳定保持脉搏。", "检查出口条是否包含具体音乐证据。"],
    homework: "请学生采访家人熟悉的一首地方歌曲或器乐声音，下节课带来一句描述。",
    note: goals ? `已纳入教师目标：${goals}` : "这是离线备用方案；配置 AI 后可生成更细的定制版本。"
  };
}

function normalizePlanText(text) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return { title: "AI 生成教案", overview: cleaned, objectives: [], materials: [], flow: [], differentiation: [], assessment: [], homework: "" };
  }
}

async function generateLessonPlan(payload) {
  const songs = JSON.parse(await readFile(dataPath, "utf8"));
  const selectedSongs = songs.filter((song) => payload.songIds?.includes(song.id));
  if (!config.apiKey && !config.xApiKey) return { plan: fallbackPlan({ ...payload, selectedSongs }), usedFallback: true };

  const systemPrompt = [
    "你是一名懂柯达伊教学法、中国民歌/传统器乐和中小学音乐课堂的教案设计助手。",
    "请输出严格 JSON，不要 Markdown。",
    "教案必须是一课时，面向老师可直接使用，避免空泛口号。",
    "字段：title, overview, objectives, materials, flow, differentiation, assessment, homework, culturalNotes。",
    "flow 是数组，每项包含 time, step, teacher, student。"
  ].join("\n");

  const userPrompt = JSON.stringify({
    audience: payload.audience,
    duration: payload.duration,
    classSize: payload.classSize,
    learnerProfile: payload.learnerProfile,
    goals: payload.goals,
    constraints: payload.constraints,
    selectedSongs: selectedSongs.map(({ title, origin, region, grade, songType, tonalCenter, scale, meter, rhythm, form, teachingFocus, description }) => ({
      title,
      origin,
      region,
      grade,
      songType,
      tonalCenter,
      scale,
      meter,
      rhythm,
      form,
      teachingFocus,
      description
    }))
  });

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.xApiKey ? { "X-API-Key": config.xApiKey } : { "Authorization": `Bearer ${config.apiKey}` })
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.55,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    return {
      plan: fallbackPlan({ ...payload, selectedSongs }),
      usedFallback: true,
      aiError: `AI request failed: ${response.status} ${errorText.slice(0, 180)}`
    };
  }

  const data = await response.json();
  return { plan: normalizePlanText(data.choices?.[0]?.message?.content || ""), usedFallback: false, model: config.model };
}

async function handleStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath === "/" ? "index.html" : safePath);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api/songs") {
      sendJson(res, 200, JSON.parse(await readFile(dataPath, "utf8")));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/config") {
      sendJson(res, 200, { aiReady: Boolean(config.apiKey || config.xApiKey), model: config.model });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/lesson-plan-get") {
      const payload = decodePayloadParam(url.searchParams.get("payload"));
      console.log(`[lesson-plan-get] songs=${payload.songIds?.length || 0} audience=${payload.audience || ""}`);
      if (!Array.isArray(payload.songIds) || payload.songIds.length === 0) {
        sendJson(res, 400, { error: "请至少选择一首曲目。" });
        return;
      }
      sendJson(res, 200, await generateLessonPlan(payload));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/lesson-plan") {
      const payload = await readJsonBody(req);
      console.log(`[lesson-plan-post] songs=${payload.songIds?.length || 0} audience=${payload.audience || ""}`);
      if (!Array.isArray(payload.songIds) || payload.songIds.length === 0) {
        sendJson(res, 400, { error: "请至少选择一首曲目。" });
        return;
      }
      sendJson(res, 200, await generateLessonPlan(payload));
      return;
    }
    await handleStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(port, () => {
  console.log(`IYGE Kodaly demo running at http://localhost:${port}`);
  console.log(`AI backend: ${config.apiKey || config.xApiKey ? `enabled (${config.model})` : "fallback mode"}`);
});
