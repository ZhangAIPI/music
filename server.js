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

function toArray(value) {
  if (value == null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function enrichPlan(plan, payload, selectedSongs) {
  const selectedSongTitles = selectedSongs.map((song) => song.title);
  const learnerProfile = payload.learnerProfile || "";
  const goals = payload.goals || "";
  const usesDiningHook = /吃饭|餐|饭|筷/.test(learnerProfile);
  const usesFencingHook = /击剑|剑|步伐/.test(learnerProfile);
  const wantsStage = /春晚|舞台|表演|演出|展示/.test(goals);
  const audienceDetails = [
    payload.audience && `授课对象：${payload.audience}`,
    payload.classSize && `班级人数：${payload.classSize}`,
    payload.learnerProfile && `学生特点：${payload.learnerProfile}`,
    payload.constraints && `课堂条件：${payload.constraints}`
  ].filter(Boolean);
  const learnerHooks = [
    usesDiningHook && "餐桌节奏 hook：用敲碗筷/传菜口令的等分脉搏类比《茉莉花》的均分节奏。",
    usesFencingHook && "击剑步伐 hook：用进退步和定格姿态体验乐句推进、呼吸点和结尾造型。",
    wantsStage && `目标转译：把“${goals}”落成 60 秒班级舞台化展示，而不是承诺真正登上大型晚会。`
  ].filter(Boolean);
  const basePerformance = plan.performanceProduct || `完成一段 60 秒课堂展示：包含${selectedSongTitles.join("、")}的一个音乐特征说明、一个节奏/动作回应和一个小组结尾造型。`;

  return {
    ...plan,
    selectedSongTitles,
    lessonBigIdea: plan.lessonBigIdea || `用${selectedSongTitles.join("、")}的具体音乐特征，帮助${payload.audience || "学生"}完成一个可展示的课堂音乐产出。`,
    learnerProfileAnalysis: plan.learnerProfileAnalysis || [
      payload.learnerProfile && `把“${payload.learnerProfile}”转化为课堂入口：从学生熟悉的动作、兴趣或日常经验进入音乐任务。`,
      payload.goals && `把“${payload.goals}”转化为可观察产出：一段包含听辨说明、节奏动作和小组展示的课堂片段。`,
      ...learnerHooks
    ].filter(Boolean),
    songRationale: plan.songRationale || selectedSongs.map((song) => ({
      song: song.title,
      features: [song.songType, song.scale, song.meter, song.rhythm, ...(song.teachingFocus || [])].filter(Boolean),
      useInLesson: `围绕${song.description}，设计听辨、模仿或创编任务。`
    })),
    audienceAdaptation: plan.audienceAdaptation || [
      ...audienceDetails,
      payload.goals && `目标对齐：${payload.goals}`
    ].filter(Boolean),
    performanceProduct: `${basePerformance}${wantsStage && !String(basePerformance).includes("春晚") ? ` 以“春晚一分钟班级节目”为情境：有开场定格、音乐特征展示、全组同步结尾。` : ""}`,
    activityDetails: [
      ...(plan.activityDetails || selectedSongs.map((song) => ({
      activity: `${song.title}音乐特征任务`,
      purpose: `让学生抓住${[song.scale, song.meter, song.rhythm].filter(Boolean).join("、")}等可听见的线索。`,
      steps: ["先听 20 秒并记录一个声音证据", "用身体或打击乐模仿一个短动机", "小组把动机改编成 4 小节回应"]
      }))),
      usesDiningHook && { activity: "餐桌节奏转音乐脉搏", purpose: "把学生熟悉的吃饭场景转化为稳定拍和均分节奏。", steps: ["用桌面轻点模拟 4 拍脉搏", "把《茉莉花》的短句放进 4 拍框架", "小组设计一个不喧闹的餐桌节奏 ostinato"] },
      usesFencingHook && { activity: "击剑步伐转乐句呼吸", purpose: "用进退步、弓步和定格理解乐句方向和终止。", steps: ["每 4 拍一步进退", "乐句末尾定格并呼吸", "把动作压缩成舞台结尾造型"] }
    ].filter(Boolean),
    teacherPrompts: plan.teacherPrompts || [
      `你刚才听到的不是“好听/不好听”，而是哪一个具体声音证据？请说出节拍、节奏、音色或旋律走向。`,
      `如果要把这段音乐搬上一个 60 秒小舞台，你们会保留哪一个最有辨识度的音乐特征？`
    ],
    assessmentRubric: plan.assessmentRubric || [
      { criteria: "音乐证据", target: "能说出一个来自所选曲目的具体特征，而不是只说情绪词。" },
      { criteria: "动作/节奏回应", target: "能稳定表现 4 拍或一个短动机，并与小组同步。" },
      { criteria: "展示完成度", target: "60 秒展示有开头、音乐任务和结尾造型。" }
    ],
    assessment: [
      ...toArray(plan.assessment),
      wantsStage && "春晚情境展示检查：60 秒内必须包含开场定格、一个《茉莉花》音乐证据、一次全组同步动作和明确收尾。"
    ].filter(Boolean),
    aiEvaluation: plan.aiEvaluation || `AI评价：这份教案的优点是把${selectedSongTitles.join("、")}的音乐特征、${payload.audience || "授课对象"}的学习特点和“${goals || "课堂目标"}”转成了可观察的课堂产出；实施时教师要特别确认学生说得出音乐证据，而不只是完成动作或表演。`
  };
}

async function generateLessonPlan(payload) {
  const songs = JSON.parse(await readFile(dataPath, "utf8"));
  const selectedSongs = songs.filter((song) => payload.songIds?.includes(song.id));
  if (!config.apiKey && !config.xApiKey) return { plan: fallbackPlan({ ...payload, selectedSongs }), usedFallback: true };

  const systemPrompt = [
    "你是一名懂柯达伊教学法、中国民歌/传统器乐和中小学音乐课堂的教案设计助手。",
    "请输出严格 JSON，不要 Markdown。",
    "教案必须是一课时，面向老师可直接使用，信息密度要高，避免空泛口号。",
    "字段：title, overview, selectedSongTitles, lessonBigIdea, learnerProfileAnalysis, songRationale, audienceAdaptation, objectives, materials, flow, activityDetails, teacherPrompts, performanceProduct, assessmentRubric, differentiation, assessment, homework, culturalNotes, aiEvaluation。",
    "flow 是数组，至少 6 项，每项包含 time, step, songFeature, teacher, student, evidence。",
    "flow 中 teacher 和 student 每项都要写成可直接执行的课堂指令，不能只写“介绍背景/练习演唱/总结反馈”。",
    "songRationale 是数组，每项包含 song, features, useInLesson。",
    "activityDetails 是数组，每项包含 activity, purpose, steps。",
    "assessmentRubric 是数组，每项包含 criteria, target, evidence。",
    "audienceAdaptation 是数组，说明授课对象年龄、已有经验、班级人数、学生画像和限制条件如何改变教法。",
    "必须使用所有 selectedSongs；如果有多首曲目，每首都必须在 songRationale 中出现，并至少在一个 flow 环节或 overview 中出现。",
    "不要只围绕第一首歌生成。课堂流程必须体现所选曲目的音乐特征，例如调式/音阶、节拍、节奏、音色、曲式、文化主题。",
    "如果 learnerProfile 或 goals 很奇怪，也要专业地转译成教学设计。例如“只会吃饭和击剑”可以转化为餐桌节奏、击剑步伐、身体律动；“能上春晚”可以转化为 60 秒课堂舞台展示，不要嘲笑或忽略。",
    "输出要有可观察产出：学生最后具体交付什么、教师如何判断好坏、不同水平学生如何调整。",
    "aiEvaluation 必须是一段完整中文评价，80-160 字，评价这份教案是否贴合曲目、授课对象和目标，并指出教师实施时最需要留意的一点。"
  ].join("\n");

  const userPrompt = JSON.stringify({
    audience: payload.audience,
    duration: payload.duration,
    classSize: payload.classSize,
    learnerProfile: payload.learnerProfile,
    goals: payload.goals,
    constraints: payload.constraints,
    mandatoryRequirements: [
      `所选曲目共 ${selectedSongs.length} 首：${selectedSongs.map((song) => song.title).join("、")}`,
      "标题或概述要能看出选了哪些曲目。",
      "每个课堂环节都要说明教师在引导学生听/唱/动/创什么具体音乐特征。",
      "受众适配必须回应 audience、classSize、learnerProfile、constraints。",
      "必须把 learnerProfile 中的具体词语转化成课堂 hook 或活动机制。",
      "必须把 goals 转化成可观察、可评价的课堂产出。"
    ],
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
      temperature: 0.65,
      max_tokens: 2400,
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
  const plan = enrichPlan(normalizePlanText(data.choices?.[0]?.message?.content || ""), payload, selectedSongs);
  return { plan, usedFallback: false, model: config.model };
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
