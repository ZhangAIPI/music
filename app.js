const state = {
  songs: [],
  filtered: [],
  selected: new Set()
};

const defaultApiBase = window.location.hostname === "zhangaipi.github.io"
  ? "https://judy-saturn-warner-anywhere.trycloudflare.com"
  : "";
const params = new URLSearchParams(window.location.search);
const apiBase = (params.get("api") || window.IYGE_API_BASE || defaultApiBase).replace(/\/$/, "");

function apiUrl(path) {
  return apiBase ? `${apiBase}${path}` : path;
}

function assetUrl(value = "") {
  if (!value || /^https?:\/\//.test(value)) return value;
  return value.replace(/^\//, "");
}

const els = {
  searchInput: document.querySelector("#searchInput"),
  gradeFilter: document.querySelector("#gradeFilter"),
  regionFilter: document.querySelector("#regionFilter"),
  typeFilter: document.querySelector("#typeFilter"),
  scaleFilter: document.querySelector("#scaleFilter"),
  meterFilter: document.querySelector("#meterFilter"),
  resetFilters: document.querySelector("#resetFilters"),
  selectVisible: document.querySelector("#selectVisible"),
  resultCount: document.querySelector("#resultCount"),
  songGrid: document.querySelector("#songGrid"),
  selectedSongs: document.querySelector("#selectedSongs"),
  lessonForm: document.querySelector("#lessonForm"),
  lessonPlan: document.querySelector("#lessonPlan"),
  copyPlan: document.querySelector("#copyPlan"),
  aiStatus: document.querySelector("#aiStatus"),
  sourceList: document.querySelector("#sourceList"),
  generateBtn: document.querySelector("#generateBtn")
};

function uniqueOptions(key) {
  return [...new Set(state.songs.map((song) => song[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function fillSelect(select, label, values) {
  select.innerHTML = `<option value="">全部${label}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function songMatches(song) {
  const query = els.searchInput.value.trim().toLowerCase();
  const haystack = [
    song.title,
    song.pinyin,
    song.origin,
    song.region,
    song.subject,
    song.songType,
    song.description,
    ...(song.teachingFocus || [])
  ].join(" ").toLowerCase();

  return (!query || haystack.includes(query)) &&
    (!els.gradeFilter.value || song.grade === els.gradeFilter.value) &&
    (!els.regionFilter.value || song.region === els.regionFilter.value) &&
    (!els.typeFilter.value || song.songType === els.typeFilter.value) &&
    (!els.scaleFilter.value || song.scale === els.scaleFilter.value) &&
    (!els.meterFilter.value || song.meter === els.meterFilter.value);
}

function applyFilters() {
  state.filtered = state.songs.filter(songMatches);
  renderSongs();
}

function renderSongs() {
  els.resultCount.textContent = `${state.filtered.length} 首 / 片段，可按教学维度筛选`;
  els.songGrid.innerHTML = state.filtered.map((song) => {
    const selected = state.selected.has(song.id);
    return `
      <article class="song-card ${selected ? "selected" : ""}">
        <header>
          <div>
            <h3>${escapeHtml(song.title)}</h3>
            <small>${escapeHtml(song.pinyin)} · ${escapeHtml(song.origin)}</small>
          </div>
          <button class="pick" type="button" data-pick="${escapeHtml(song.id)}" aria-label="${selected ? "取消选择" : "选择"}${escapeHtml(song.title)}">${selected ? "✓" : "+"}</button>
        </header>
        <div class="meta">
          <span>${escapeHtml(song.region)}</span>
          <span>${escapeHtml(song.grade)}</span>
          <span>${escapeHtml(song.songType)}</span>
          <span>${escapeHtml(song.scale)}</span>
          <span>${escapeHtml(song.meter)}</span>
          <span>${escapeHtml(song.rhythm)}</span>
        </div>
        <p>${escapeHtml(song.description)}</p>
        <div class="focus">${song.teachingFocus.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
        ${song.audio ? `<audio controls preload="metadata" src="${escapeHtml(assetUrl(song.audio))}"></audio>` : ""}
        ${song.scoreImage ? `<img class="score-preview" src="${escapeHtml(assetUrl(song.scoreImage))}" alt="${escapeHtml(song.title)}曲谱预览" />` : ""}
        <a class="source-link" href="${escapeHtml(song.sourceUrl)}" target="_blank" rel="noreferrer">来源说明</a>
      </article>
    `;
  }).join("");
  renderSelected();
}

function renderSelected() {
  const selectedSongs = state.songs.filter((song) => state.selected.has(song.id));
  els.selectedSongs.innerHTML = selectedSongs.length
    ? selectedSongs.map((song) => `<span>${escapeHtml(song.title)}</span>`).join("")
    : "尚未选择";
}

function renderSources() {
  const seen = new Map();
  for (const song of state.songs) seen.set(song.sourceUrl, song.sourceName);
  els.sourceList.innerHTML = [...seen.entries()]
    .map(([url, name]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(name)}</a>`)
    .join("");
}

function list(items = []) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function buildStaticPlan(payload) {
  const selectedSongs = state.songs.filter((song) => payload.songIds.includes(song.id));
  const titles = selectedSongs.map((song) => song.title).join("、") || "所选曲目";
  const focuses = [...new Set(selectedSongs.flatMap((song) => song.teachingFocus || []))].slice(0, 5);
  return {
    title: `${titles}一课时教学方案`,
    overview: `面向${payload.audience || "学生"}，用 ${payload.duration || 40} 分钟完成聆听、模唱、节奏/音色辨识和小组创编。`,
    objectives: [
      `学生能说出${titles}中的至少两个音乐特征。`,
      "学生能用拍手、哼唱或动作表现关键节奏/旋律动机。",
      "学生能把听到的音色或民歌旋律与一个中国音乐文化场景相连接。"
    ],
    materials: ["音频播放器", "投影/白板", "节奏卡", "手鼓或木鱼", "学生记录单"],
    flow: [
      { time: "0-5 分钟", step: "听觉导入", teacher: `播放${selectedSongs[0]?.title || "第一首曲目"}片段，收集学生的第一听感。`, student: "用一个词描述音色、情绪或画面。" },
      { time: "5-12 分钟", step: "二次聆听", teacher: "提示学生关注速度、强弱、重复乐句和音色变化。", student: "用手势标出听到的重复或变化。" },
      { time: "12-20 分钟", step: "模唱模奏", teacher: "抽取短动机，用节奏读法、柯达伊手势或身体律动带练。", student: "分组模唱、拍击或用课堂乐器回应。" },
      { time: "20-30 分钟", step: "曲目比较", teacher: `比较${titles}的地区、类型、音色或音阶特点。`, student: "在记录单上写下一个相同点和一个不同点。" },
      { time: "30-37 分钟", step: "小组创编", teacher: "要求保留一个节奏或五声音阶特征，创作 4 小节回应句。", student: "小组排练并展示。" },
      { time: "37-40 分钟", step: "出口评估", teacher: "回放开头片段，询问学生现在能听到哪些新线索。", student: "提交一句音乐证据和一句文化连接。" }
    ],
    differentiation: [
      "低龄或基础较弱学生可只做动作回应和节奏模仿。",
      "进阶学生可增加调式、曲式或历史录音语境讨论。",
      payload.constraints ? `根据条件调整：${payload.constraints}` : "根据教室设备调整创编呈现方式。"
    ],
    assessment: ["观察学生能否稳定保持脉搏。", "检查学生是否能用具体音乐词汇说明听辨结果。", "用出口条判断文化连接是否具体。"],
    culturalNotes: focuses.length ? focuses : ["把音乐材料放回地域、语言、乐器和生活场景中理解。"],
    homework: "采访家人熟悉的一首地方歌曲或一种传统乐器声音，下节课带来一句描述。"
  };
}

function renderPlan(plan, meta = {}) {
  const flow = Array.isArray(plan.flow) ? plan.flow : [];
  const sections = [
    ["教学目标", list(plan.objectives || [])],
    ["材料准备", list(plan.materials || [])],
    ["分层支持", list(plan.differentiation || [])],
    ["评估方式", list(plan.assessment || [])],
    ["文化提示", Array.isArray(plan.culturalNotes) ? list(plan.culturalNotes) : `<p>${escapeHtml(plan.culturalNotes || "")}</p>`],
    ["课后延伸", `<p>${escapeHtml(plan.homework || "")}</p>`]
  ].filter(([, content]) => !content.includes("<ul></ul>") && content !== "<p></p>");

  els.lessonPlan.className = "lesson-plan";
  els.lessonPlan.innerHTML = `
    <div>
      <h3>${escapeHtml(plan.title || "一课时教案")}</h3>
      <p>${escapeHtml(plan.overview || "")}</p>
      ${meta.usedFallback ? `<p><strong>当前使用离线备用方案；请检查 AI 配置或接口返回。</strong>${meta.aiError ? ` ${escapeHtml(meta.aiError)}` : ""}</p>` : ""}
    </div>
    <div class="lesson-section">
      <h4>课堂流程</h4>
      <div class="flow">
        ${flow.map((item) => `
          <div class="flow-item">
            <strong>${escapeHtml(item.time || "")}</strong>
            <b>${escapeHtml(item.step || "")}</b>
            <span>${escapeHtml(item.teacher || "")}</span>
            <span>${escapeHtml(item.student || "")}</span>
          </div>
        `).join("")}
      </div>
    </div>
    ${sections.map(([title, content]) => `<div class="lesson-section"><h4>${title}</h4>${content}</div>`).join("")}
  `;
}

async function generateLesson(event) {
  event.preventDefault();
  const selected = [...state.selected];
  if (!selected.length) {
    els.lessonPlan.className = "empty-state";
    els.lessonPlan.textContent = "请先至少选择一首曲目。";
    return;
  }

  const form = new FormData(els.lessonForm);
  const payload = Object.fromEntries(form.entries());
  payload.songIds = selected;

  els.generateBtn.disabled = true;
  els.generateBtn.textContent = "生成中...";
  els.lessonPlan.className = "empty-state";
  els.lessonPlan.textContent = "AI 正在组织课堂流程、目标和评估方式。";

  try {
    const response = await fetch(apiUrl("/api/lesson-plan"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "生成失败");
    renderPlan(data.plan, data);
  } catch (error) {
    renderPlan(buildStaticPlan(payload), {
      usedFallback: true,
      aiError: "当前页面未连接可用后端；本结果为前端演示教案。"
    });
  } finally {
    els.generateBtn.disabled = false;
    els.generateBtn.textContent = "生成一课时教案";
  }
}

async function init() {
  let songsResponse = await fetch(apiUrl("/api/songs")).catch(() => null);
  if (!songsResponse?.ok) songsResponse = await fetch("data/songs.json");
  const configResponse = await fetch(apiUrl("/api/config")).catch(() => null);
  state.songs = await songsResponse.json();
  const config = configResponse?.ok ? await configResponse.json() : { aiReady: false, model: "Pages demo" };
  els.aiStatus.textContent = config.aiReady ? config.model : "Pages demo";

  fillSelect(els.gradeFilter, "年级", uniqueOptions("grade"));
  fillSelect(els.regionFilter, "地区", uniqueOptions("region"));
  fillSelect(els.typeFilter, "类型", uniqueOptions("songType"));
  fillSelect(els.scaleFilter, "音阶", uniqueOptions("scale"));
  fillSelect(els.meterFilter, "节拍", uniqueOptions("meter"));
  applyFilters();
  renderSources();
}

els.songGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-pick]");
  if (!button) return;
  const id = button.dataset.pick;
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  renderSongs();
});

for (const element of [els.searchInput, els.gradeFilter, els.regionFilter, els.typeFilter, els.scaleFilter, els.meterFilter]) {
  element.addEventListener("input", applyFilters);
}

els.resetFilters.addEventListener("click", () => {
  els.searchInput.value = "";
  for (const select of [els.gradeFilter, els.regionFilter, els.typeFilter, els.scaleFilter, els.meterFilter]) select.value = "";
  applyFilters();
});

els.selectVisible.addEventListener("click", () => {
  for (const song of state.filtered) state.selected.add(song.id);
  renderSongs();
});

els.lessonForm.addEventListener("submit", generateLesson);

els.copyPlan.addEventListener("click", async () => {
  await navigator.clipboard.writeText(els.lessonPlan.innerText);
  els.copyPlan.textContent = "已复制";
  setTimeout(() => {
    els.copyPlan.textContent = "复制教案";
  }, 1200);
});

init().catch((error) => {
  els.resultCount.textContent = error.message;
});
