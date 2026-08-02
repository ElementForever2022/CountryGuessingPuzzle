'use strict';

/* global window, document */

const $ = (id) => document.getElementById(id);

const messagesEl = $('messages');
const inputEl = $('input');
const sendBtn = $('sendBtn');
const hintBtn = $('hintBtn');
const giveupBtn = $('giveupBtn');
const newBtn = $('newBtn');
const settingsBtn = $('settingsBtn');
const statusText = $('statusText');
const watermarkEl = $('watermark');

let busy = false;
let gameOver = false;

// ---------- 消息渲染 ----------
function addMsg(role, text, cls = '') {
  const div = document.createElement('div');
  div.className = `msg ${role} ${cls}`.trim();
  div.textContent = text;
  messagesEl.appendChild(div);
  scrollBottom();
  return div;
}

function addHtmlMsg(role, html, cls = '') {
  const div = document.createElement('div');
  div.className = `msg ${role} ${cls}`.trim();
  div.innerHTML = html;
  messagesEl.appendChild(div);
  scrollBottom();
  return div;
}

function addTyping() {
  const div = document.createElement('div');
  div.className = 'msg assistant typing';
  div.textContent = '正在思考…';
  messagesEl.appendChild(div);
  scrollBottom();
  return div;
}

function scrollBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
  messagesEl.parentElement.scrollTop = messagesEl.parentElement.scrollHeight;
}

/** 让版本水印固定在底部控制区上方（左下角），窗口尺寸变化时重算 */
function placeWatermark() {
  const controls = document.querySelector('.controls');
  if (!controls || !watermarkEl) return;
  watermarkEl.style.bottom = `${window.innerHeight - controls.offsetTop + 6}px`;
}

// ---------- 状态 ----------
async function refreshStatus() {
  try {
    const st = await window.api.getStatus();
    const dot = st.useLlm ? '●' : '○';
    statusText.textContent = `裁判：${st.judgeLabel} ｜ 数据 ${st.datasetCount} 个 ｜ 已问 ${st.questionCount} 题`;
    statusText.title = st.judgeLabel;
    if (watermarkEl) watermarkEl.textContent = `v${st.version}`;
  } catch (e) {
    statusText.textContent = '状态获取失败';
  }
}

function setControlsEnabled(enabled) {
  gameOver = !enabled;
  inputEl.disabled = !enabled;
  sendBtn.disabled = !enabled;
  hintBtn.disabled = !enabled;
  giveupBtn.disabled = !enabled;
}

// ---------- 开局 ----------
async function startGame() {
  setControlsEnabled(true);
  messagesEl.innerHTML = '';
  const st = await window.api.startGame();
  const judgeDesc = st.useLlm
    ? `大模型裁判（${st.provider} / ${st.model}）`
    : '离线启发式裁判（仅支持“国名猜测 / 大洲 / 首都”类问题，配置大模型体验更佳）';
  addHtmlMsg('system', `欢迎来到<b>国家海龟汤</b>！<br>程序已从 ${st.datasetCount} 个中国官方承认的主权国家中随机抽取了一个神秘国家。<br>你只能通过“是 / 不是”的问题逐步逼近答案。<br>当前裁判：${judgeDesc}`);
  addMsg('system', '试着提问吧，例如「这个国家在亚洲吗？」；也可以直接猜「答案是法国吗？」。');
  refreshStatus();
}

// ---------- 提问 ----------
async function send() {
  const q = inputEl.value.trim();
  if (!q || busy) return;
  busy = true;
  sendBtn.disabled = true;
  inputEl.value = '';

  addMsg('user', q);
  const typing = addTyping();

  let res;
  try {
    res = await window.api.ask(q);
  } catch (e) {
    typing.remove();
    addMsg('assistant', `[异常] ${e.message}`, 'error');
    busy = false;
    if (!gameOver) { inputEl.disabled = false; sendBtn.disabled = false; }
    return;
  }

  typing.remove();

  if (res.type === 'win') {
    addMsg('assistant', '是！你猜对了！', 'win');
    const reveal = await window.api.finish('win');
    renderReveal(reveal, '猜中');
  } else if (res.type === 'yes') {
    addMsg('assistant', '是', 'yes');
  } else if (res.type === 'no') {
    addMsg('assistant', '不是', 'no');
  } else if (res.type === 'invalid') {
    addMsg('assistant', `无效问题：${res.reason || '请重新提问'}`, 'invalid');
  } else {
    addMsg('assistant', `[裁判异常] ${res.message}`, 'error');
  }

  refreshStatus();
  busy = false;
  if (!gameOver) { inputEl.disabled = false; sendBtn.disabled = false; }
}

// ---------- 提示 / 放弃 / 新一局 ----------
async function doHint() {
  if (busy || gameOver) return;
  const h = await window.api.hint();
  if (h.type === 'hint') addMsg('assistant', `[提示 ${h.index}/${h.total}] ${h.text}`, '');
  else addMsg('assistant', h.message, 'invalid');
}

async function doGiveUp() {
  if (busy || gameOver) return;
  busy = true;
  setControlsEnabled(false);
  const reveal = await window.api.finish('giveup');
  renderReveal(reveal, '放弃');
  refreshStatus();
  busy = false;
}

// ---------- 揭晓 ----------
function renderReveal(reveal, reason) {
  const t = reveal.target;
  const head = reason === '猜中'
    ? `恭喜你！用 ${reveal.questionCount} 个问题猜出了神秘国家：${t.name}`
    : `你选择了放弃。神秘国家是：${t.name}（共提问 ${reveal.questionCount} 个，用时约 ${Math.round(reveal.elapsedSec)} 秒）`;

  const facts = [
    `【国家档案】`,
    `  国家：${t.name}（${t.en}）`,
    `  所在大洲：${t.continent}`,
    `  首都：${t.capital}`,
    `  人口（约）：${fmtPop(t.population)}`,
    `  国土面积（约）：${fmtArea(t.area)}`,
  ].join('\n');

  const historyList = reveal.history
    .map((h, i) => `<li>${esc(h.question)} → ${esc(describeResult(h))}</li>`)
    .join('');

  const introHtml = reveal.llmIntro
    ? `<div class="intro"><h4>维基百科介绍</h4><pre>${esc(reveal.llmIntro)}</pre></div>`
    : '';

  const gallery = [];
  if (reveal.images && reveal.images.flag) gallery.push({ src: reveal.images.flag, label: '国旗' });
  if (reveal.images && reveal.images.capital) gallery.push({ src: reveal.images.capital, label: `首都：${t.capital}` });
  for (const lm of (reveal.landmarks || [])) {
    if (lm.image && lm.name) gallery.push({ src: lm.image, label: lm.name });
  }
  const imgHtml = gallery.length
    ? `<div class="img-gallery">${gallery
        .map((i) => `<figure><img src="${i.src}" alt="${esc(i.label)}"><figcaption>${esc(i.label)}</figcaption></figure>`)
        .join('')}</div>`
    : '';

  const el = document.createElement('div');
  el.className = 'msg reveal';
  el.innerHTML = `
    <h3>${esc(head)}</h3>
    ${imgHtml}
    <div class="facts">${esc(facts)}</div>
    ${reveal.history.length ? `<div class="history"><strong>历史提问记录：</strong><ol>${historyList}</ol></div>` : ''}
    ${introHtml}
    <button id="playAgainBtn" class="btn primary play-again">再来一局</button>`;
  messagesEl.appendChild(el);
  scrollBottom();

  el.querySelector('#playAgainBtn').addEventListener('click', startGame);
}

function describeResult(h) {
  if (h.type === 'yes') return '是';
  if (h.type === 'no') return '不是';
  if (h.type === 'win') return '是（猜中！）';
  if (h.type === 'invalid') return `无效（${h.reason || '请重新提问'}）`;
  return '异常';
}

// ---------- 工具 ----------
function fmtPop(n) {
  if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
  if (n >= 1e4) return (n / 1e4).toFixed(0) + ' 万';
  return String(n);
}
function fmtArea(n) {
  if (n >= 1e4) return (n / 1e4).toFixed(1) + ' 万平方公里';
  return n + ' 平方公里';
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

// ---------- 设置弹窗 ----------
const settingsOverlay = $('settingsOverlay');
const cfg = {
  provider: $('cfgProvider'),
  apiKey: $('cfgApiKey'),
  baseMode: $('cfgBaseMode'),
  apiBase: $('cfgApiBase'),
  apiBaseWrap: $('cfgApiBaseWrap'),
  modelSelect: $('cfgModelSelect'),
  modelCustom: $('cfgModelCustom'),
  judgeMode: $('cfgJudgeMode'),
  theme: $('cfgTheme'),
};

let providers = {}; // 来自主进程的 Provider 目录（默认地址、默认模型、模型列表等）

function applyTheme(name) {
  const theme = name && name !== 'default' ? name : 'default';
  if (theme === 'default') delete document.body.dataset.theme;
  else document.body.dataset.theme = theme;
}

/** 依据当前 Provider 刷新接口地址区：默认(只读) / 自定义(可填) */
function renderBaseField(forceCustom) {
  const meta = providers[cfg.provider.value] || { base: '', needKey: true };
  const baseMode = forceCustom ? 'custom' : cfg.baseMode.value;
  const def = meta.base || '';
  if (baseMode === 'custom') {
    cfg.apiBaseWrap.classList.remove('hidden-field');
    cfg.apiBase.disabled = false;
    if (!cfg.apiBase.value && def) cfg.apiBase.placeholder = `默认：${def}`;
  } else {
    cfg.apiBaseWrap.classList.add('hidden-field');
    cfg.apiBase.disabled = true;
    cfg.apiBase.value = '';
    cfg.apiBase.placeholder = def ? `默认：${def}` : '该服务需填写地址';
  }
}

/** 依据当前 Provider 刷新模型选择区：预设下拉 + 自定义输入 */
function renderModelField(savedModel) {
  const meta = providers[cfg.provider.value] || { models: [], model: '' };
  const models = meta.models || [];
  const sel = cfg.modelSelect;
  sel.innerHTML = '';
  let hasSaved = false;

  models.forEach((m) => {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = m;
    sel.appendChild(o);
    if (savedModel && savedModel === m) { o.selected = true; hasSaved = true; }
  });

  const customOpt = document.createElement('option');
  customOpt.value = '__custom__';
  customOpt.textContent = '自定义…';
  sel.appendChild(customOpt);

  if (savedModel && !hasSaved) {
    customOpt.selected = true;
    cfg.modelCustom.value = savedModel;
    cfg.modelCustom.disabled = false;
  } else {
    cfg.modelCustom.value = '';
    cfg.modelCustom.disabled = true;
  }
}

async function openSettings() {
  const { config } = await window.api.getConfig();
  cfg.provider.value = config.provider;
  cfg.apiKey.value = config.apiKey || '';
  cfg.apiKey.placeholder = (providers[config.provider] || {}).needKey === false
    ? '本地服务可留空'
    : '填写所选服务的 API Key';
  cfg.apiKey.disabled = false;

  const meta = providers[config.provider] || {};
  cfg.baseMode.value = config.apiBase ? 'custom' : 'default';
  cfg.apiBase.value = config.apiBase || '';
  renderBaseField();

  renderModelField(config.model || '');

  cfg.judgeMode.value = config.judgeMode || 'auto';
  cfg.theme.value = config.theme || 'default';
  $('testResult').textContent = '';
  $('testResult').className = 'test-result';
  settingsOverlay.classList.remove('hidden');
}

function closeSettings() {
  settingsOverlay.classList.add('hidden');
}

function collectForm() {
  const baseMode = cfg.baseMode.value === 'custom' ? cfg.apiBase.value.trim() : '';
  let model = cfg.modelSelect.value;
  if (model === '__custom__') model = cfg.modelCustom.value.trim();
  return {
    provider: cfg.provider.value,
    apiKey: cfg.apiKey.value.trim(),
    apiBase: baseMode,
    model,
    judgeMode: cfg.judgeMode.value,
    theme: cfg.theme.value,
  };
}

async function saveSettings() {
  const res = await window.api.saveConfig(collectForm());
  if (res.ok) {
    applyTheme(res.config.theme);
    closeSettings();
    toast('配置已保存，已应用新裁判');
    await startGame(); // 以新配置重开一局
  } else {
    toast(`保存失败：${res.message}`);
  }
}

async function testConnection() {
  const btn = $('testBtn');
  const result = $('testResult');
  btn.disabled = true;
  result.textContent = '正在连接…';
  result.className = 'test-result';
  const r = await window.api.testConnection(collectForm());
  if (r.ok) {
    result.textContent = `成功（${r.elapsed}s）：${r.reply}`;
    result.className = 'test-result ok';
  } else {
    result.textContent = `失败（${r.elapsed}s）：${r.message}`;
    result.className = 'test-result fail';
  }
  btn.disabled = false;
}

// ---------- 事件绑定 ----------
sendBtn.addEventListener('click', send);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send();
});
hintBtn.addEventListener('click', doHint);
giveupBtn.addEventListener('click', doGiveUp);
newBtn.addEventListener('click', startGame);
settingsBtn.addEventListener('click', openSettings);
$('closeSettingsBtn').addEventListener('click', closeSettings);
$('saveConfigBtn').addEventListener('click', saveSettings);
$('testBtn').addEventListener('click', testConnection);
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

// 配置表单联动：切换服务/地址模式/模型时动态刷新
cfg.provider.addEventListener('change', () => {
  cfg.apiKey.placeholder = (providers[cfg.provider.value] || {}).needKey === false
    ? '本地服务可留空'
    : '填写所选服务的 API Key';
  cfg.baseMode.value = 'default';
  cfg.apiBase.value = '';
  renderBaseField();
  renderModelField('');
});
cfg.baseMode.addEventListener('change', () => renderBaseField());
cfg.modelSelect.addEventListener('change', () => {
  const isCustom = cfg.modelSelect.value === '__custom__';
  cfg.modelCustom.disabled = !isCustom;
  if (!isCustom) cfg.modelCustom.value = '';
});

// ---------- 启动 ----------
(async function init() {
  providers = await window.api.getProviders();
  const { config } = await window.api.getConfig();
  applyTheme(config.theme);
  placeWatermark();
  window.addEventListener('resize', placeWatermark);
  await startGame();
})().catch((e) => {
  addMsg('assistant', `[初始化失败] ${e.message}`, 'error');
});
