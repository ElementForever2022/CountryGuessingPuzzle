'use strict';

/**
 * 提前从网络下载国家相关数据到本地，并写回 data/countries.json：
 *   - 国旗图片：flagcdn.com（https://flagcdn.com/w320/<ISO2>.png，确定性强、不限流）
 *   - 首都图片：维基百科 pageimages 批量接口 + REST summary 兜底
 *   - 地标图片：按 data/landmarks.json 的清单逐条下载（zh 词条缩略图，en 兜底）
 *   - 国家介绍（intro）：维基百科 REST summary 的 extract 导言段（中文优先，en 兜底）
 *
 * 用法：
 *   node scripts/downloadImages.js                    # 全部：国旗 + 首都 + 地标
 *   node scripts/downloadImages.js --only flag        # 只下载国旗
 *   node scripts/downloadImages.js --only capital     # 只下载首都
 *   node scripts/downloadImages.js --only landmark    # 只下载地标
 *   node scripts/downloadImages.js --only intro       # 只下载国家介绍
 *   node scripts/downloadImages.js --start 0 --limit 30   # 分批续传
 *   node scripts/downloadImages.js --sync             # 只扫描 assets 已有文件，回写 countries.json
 *   node scripts/downloadImages.js --no-write         # 只下载，不写回 countries.json
 *   node scripts/downloadImages.js --force            # 已存在也重新下载
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(PROJECT_ROOT, 'data', 'countries.json');
const LANDMARKS_FILE = path.join(PROJECT_ROOT, 'data', 'landmarks.json');
const IMG_ROOT = path.join(PROJECT_ROOT, 'assets', 'images');
const FLAG_DIR = path.join(IMG_ROOT, 'flags');
const CAPITAL_DIR = path.join(IMG_ROOT, 'capitals');
const LANDMARK_DIR = path.join(IMG_ROOT, 'landmarks');

const CONCURRENCY = 2;
const UA = 'CountryLTP/1.0 (image downloader)';
const WIKI_QUERY_BATCH = 50;
const MIN_REQUEST_GAP_MS = 350;

/** 首都中文名歧义/错误标题 -> 正确的 zh.wikipedia 词条标题（按 ISO2） */
const CAPITAL_TITLE_ZH = {
  US: '华盛顿哥伦比亚特区',
  CL: '圣地亚哥 (智利)',
  CR: '圣何塞 (哥斯达黎加)',
  JM: '金斯敦 (牙买加)',
  BS: '拿骚 (巴哈马)',
  VC: '金斯敦 (圣文森特和格林纳丁斯)',
  GY: '乔治敦 (圭亚那)',
  SC: '维多利亚 (塞舌尔)',
};

/** zh.wikipedia 无缩略图 -> 改用 en.wikipedia 词条标题（按 ISO2） */
const CAPITAL_TITLE_EN = {
  BG: 'Sofia',
  NI: 'Managua',
  CI: 'Yamoussoukro',
  KN: 'Basseterre',
  MR: 'Nouakchott',
  DM: 'Roseau',
};

/** 国家介绍词条覆盖：c.name 在 zh.wikipedia 是消歧义页/歧义标题时，指定正确的词条标题（按 ISO2） */
const INTRO_TITLE_ZH = {
  KP: '朝鲜民主主义人民共和国',
  PS: '巴勒斯坦国',
};

/** 定制介绍（覆盖维基导言）：CN 保持与其他国家一致的简介格式，仅确保符合中国大陆视角 */
const INTRO_OVERRIDE = {
  CN: '中华人民共和国（英语：People\'s Republic of China，缩写：PRC），通称中国，是位于东亚的社会主义国家，首都为北京。中国东临太平洋，西接中亚各国，北邻蒙古国和俄罗斯，南与越南、老挝、缅甸等国接壤，国土面积约960万平方公里，人口约14.1亿，是世界上人口最多的国家。1949年10月1日，中华人民共和国成立。中国是联合国安全理事会常任理事国，实行人民代表大会制度。',
};

/** 英文国家名 -> ISO 3166-1 alpha-2（已覆盖全部 197 国） */
const ISO2 = {
  China: 'CN', Japan: 'JP', 'South Korea': 'KR', 'North Korea': 'KP', Mongolia: 'MN',
  Vietnam: 'VN', Laos: 'LA', Cambodia: 'KH', Myanmar: 'MM', Thailand: 'TH', Malaysia: 'MY',
  Singapore: 'SG', Brunei: 'BN', Indonesia: 'ID', 'Timor-Leste': 'TL', Philippines: 'PH',
  India: 'IN', Pakistan: 'PK', Bangladesh: 'BD', Nepal: 'NP', Bhutan: 'BT', 'Sri Lanka': 'LK',
  Maldives: 'MV', Kazakhstan: 'KZ', Kyrgyzstan: 'KG', Tajikistan: 'TJ', Uzbekistan: 'UZ',
  Turkmenistan: 'TM', Azerbaijan: 'AZ', Armenia: 'AM', Georgia: 'GE', Afghanistan: 'AF',
  Iran: 'IR', Iraq: 'IQ', Syria: 'SY', Lebanon: 'LB', Jordan: 'JO', Israel: 'IL',
  Palestine: 'PS', 'Saudi Arabia': 'SA', Yemen: 'YE', Oman: 'OM', 'United Arab Emirates': 'AE',
  Qatar: 'QA', Bahrain: 'BH', Kuwait: 'KW', Turkey: 'TR', Cyprus: 'CY', Norway: 'NO',
  Sweden: 'SE', Finland: 'FI', Denmark: 'DK', Iceland: 'IS', 'United Kingdom': 'GB',
  Ireland: 'IE', France: 'FR', Germany: 'DE', Netherlands: 'NL', Belgium: 'BE', Luxembourg: 'LU',
  Switzerland: 'CH', Austria: 'AT', Italy: 'IT', Spain: 'ES', Portugal: 'PT', Greece: 'GR',
  Poland: 'PL', Czechia: 'CZ', Slovakia: 'SK', Hungary: 'HU', Romania: 'RO', Bulgaria: 'BG',
  Serbia: 'RS', Croatia: 'HR', Slovenia: 'SI', 'Bosnia and Herzegovina': 'BA', Montenegro: 'ME',
  'North Macedonia': 'MK', Albania: 'AL', Lithuania: 'LT', Latvia: 'LV', Estonia: 'EE',
  Belarus: 'BY', Ukraine: 'UA', Moldova: 'MD', Russia: 'RU', Malta: 'MT', 'San Marino': 'SM',
  Andorra: 'AD', Monaco: 'MC', Liechtenstein: 'LI', 'Vatican City': 'VA', Egypt: 'EG',
  Libya: 'LY', Tunisia: 'TN', Algeria: 'DZ', Morocco: 'MA', Sudan: 'SD', 'South Sudan': 'SS',
  Ethiopia: 'ET', Eritrea: 'ER', Djibouti: 'DJ', Somalia: 'SO', Kenya: 'KE', Uganda: 'UG',
  Tanzania: 'TZ', Rwanda: 'RW', Burundi: 'BI', 'DR Congo': 'CD', 'Republic of the Congo': 'CG',
  Gabon: 'GA', 'Equatorial Guinea': 'GQ', Cameroon: 'CM', 'Central African Republic': 'CF',
  Chad: 'TD', Niger: 'NE', Nigeria: 'NG', Benin: 'BJ', Togo: 'TG', Ghana: 'GH',
  'Ivory Coast': 'CI', Liberia: 'LR', 'Sierra Leone': 'SL', Guinea: 'GN', 'Guinea-Bissau': 'GW',
  Senegal: 'SN', Gambia: 'GM', Mauritania: 'MR', Mali: 'ML', 'Burkina Faso': 'BF',
  'Cabo Verde': 'CV', 'Sao Tome and Principe': 'ST', Angola: 'AO', Zambia: 'ZM', Zimbabwe: 'ZW',
  Malawi: 'MW', Mozambique: 'MZ', Madagascar: 'MG', Comoros: 'KM', Mauritius: 'MU',
  Seychelles: 'SC', 'South Africa': 'ZA', Namibia: 'NA', Botswana: 'BW', Lesotho: 'LS',
  Eswatini: 'SZ', Canada: 'CA', 'United States': 'US', Mexico: 'MX', Guatemala: 'GT',
  Belize: 'BZ', Honduras: 'HN', 'El Salvador': 'SV', Nicaragua: 'NI', 'Costa Rica': 'CR',
  Panama: 'PA', Cuba: 'CU', Haiti: 'HT', 'Dominican Republic': 'DO', Jamaica: 'JM',
  'Trinidad and Tobago': 'TT', Barbados: 'BB', Bahamas: 'BS', 'Saint Kitts and Nevis': 'KN',
  'Saint Lucia': 'LC', 'Saint Vincent and the Grenadines': 'VC', Grenada: 'GD',
  'Antigua and Barbuda': 'AG', Dominica: 'DM', Colombia: 'CO', Venezuela: 'VE', Guyana: 'GY',
  Suriname: 'SR', Brazil: 'BR', Ecuador: 'EC', Peru: 'PE', Bolivia: 'BO', Chile: 'CL',
  Argentina: 'AR', Paraguay: 'PY', Uruguay: 'UY', Australia: 'AU', 'New Zealand': 'NZ',
  'Papua New Guinea': 'PG', Fiji: 'FJ', 'Solomon Islands': 'SB', Vanuatu: 'VU', Samoa: 'WS',
  Tonga: 'TO', Kiribati: 'KI', 'Marshall Islands': 'MH', Palau: 'PW', Micronesia: 'FM',
  Nauru: 'NR', Tuvalu: 'TV', 'Cook Islands': 'CK', Niue: 'NU',
};

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = { only: null, start: 0, limit: Infinity, write: true, force: false, sync: false, names: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') out.only = (argv[++i] || '').toLowerCase();
    else if (a === '--start') out.start = Number(argv[++i]) || 0;
    else if (a === '--limit') out.limit = Number(argv[++i]) || Infinity;
    else if (a === '--no-write') out.write = false;
    else if (a === '--force') out.force = true;
    else if (a === '--sync') out.sync = true;
    else if (a === '--names') out.names = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (res.status === 429) { const e = new Error('RATE'); e.status = 429; throw e; }
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

async function download(url, filePath) {
  const buf = await fetchBuffer(url);
  if (buf === null || buf.length === 0) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buf);
  return true;
}

let _lastReqAt = 0;
async function throttled(fn) {
  const wait = _lastReqAt + MIN_REQUEST_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  _lastReqAt = Date.now();
  return fn();
}

async function withRetry(url, filePath) {
  for (let t = 0; t < 6; t++) {
    try {
      const buf = await throttled(async () => {
        const res = await fetch(url, { headers: { 'User-Agent': UA } });
        if (res.status === 429) { const e = new Error('RATE'); e.status = 429; throw e; }
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
      });
      if (buf === null || buf.length === 0) return false;
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, buf);
      return true;
    } catch (e) {
      if (e && (e.status === 429 || /fetch failed|ENOTFOUND|EAI_AGAIN|timeout|abort|ECONNRESET/i.test(String(e.message)))) {
        await sleep(2500 * (t + 1));
        continue;
      }
      return false;
    }
  }
  return false;
}

/** 查询单个词条缩略图源地址（REST summary，带节流与 429 退避） */
async function queryThumb(host, title) {
  for (let i = 0; i < 6; i++) {
    try {
      const res = await throttled(async () => {
        const r = await fetch(`https://${host}/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: { 'User-Agent': UA } });
        return r;
      });
      if (res.status === 429) { const e = new Error('RATE'); e.status = 429; throw e; }
      if (!res.ok) return null;
      const j = await res.json();
      if (j && j.thumbnail && j.thumbnail.source) return j.thumbnail.source;
      return null;
    } catch (e) {
      if (e && (e.status === 429 || /fetch failed|ENOTFOUND|timeout|abort|Unexpected token/i.test(String(e.message)))) {
        await sleep(2500 * (i + 1));
        continue;
      }
      return null;
    }
  }
  return null;
}

/** 查询词条缩略图源地址：输入 [zhTitle, enFallback?]，输出 Map<zhTitle, source> */
async function getThumbSources(titles) {
  const out = new Map();
  for (const [t, en] of titles) {
    let src = await queryThumb('zh.wikipedia.org', t);
    if (!src && en) src = await queryThumb('en.wikipedia.org', en);
    if (src) out.set(t, src);
  }
  return out;
}

/** 批量 pageimages 查询（最多 50 词条/请求），返回 Map<title, source> */
async function getBatchThumbs(titles) {
  const out = new Map();
  const chunks = [];
  for (let i = 0; i < titles.length; i += WIKI_QUERY_BATCH) chunks.push(titles.slice(i, i + WIKI_QUERY_BATCH));
  for (const chunk of chunks) {
    for (let t = 0; t < 5; t++) {
      try {
        const res = await throttled(async () => {
          const params = new URLSearchParams({
            action: 'query', prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '320',
            format: 'json', formatversion: '2', titles: chunk.join('|'),
          });
          return await fetch(`https://zh.wikipedia.org/w/api.php?${params}`, { headers: { 'User-Agent': UA } });
        });
        if (res.status === 429) { const e = new Error('RATE'); e.status = 429; throw e; }
        if (!res.ok) break;
        const j = await res.json();
        if (j && j.query && j.query.pages) {
          for (const p of j.query.pages) {
            if (p && p.thumbnail && p.thumbnail.source) out.set(p.title, p.thumbnail.source);
          }
        }
        break;
      } catch (e) {
        if (e && (e.status === 429 || /fetch failed|ENOTFOUND|timeout|abort|Unexpected token/i.test(String(e.message)))) {
          await sleep(3000 * (t + 1));
          continue;
        }
        break;
      }
    }
    await sleep(300);
  }
  return out;
}

function runPool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let i = 0;
  const worker = async () => {
    while (i < tasks.length) {
      const idx = i++;
      try { results[idx] = await tasks[idx](); } catch (e) { results[idx] = { error: e }; }
    }
  };
  return Promise.all(Array.from({ length: Math.min(concurrency, Math.max(tasks.length, 1)) }, worker))
    .then(() => results);
}

/** 截断到句子边界（不用 API 的 … 截断符），最长 INTRO_MAX_LEN 字符 */
const INTRO_MAX_LEN = 1000;
function clipIntro(text) {
  const s = String(text || '').trim();
  if (s.length <= INTRO_MAX_LEN) return s;
  const cut = s.slice(0, INTRO_MAX_LEN);
  let last = -1;
  for (const ch of ['。', '！', '？', '.', '!', '?']) last = Math.max(last, cut.lastIndexOf(ch));
  return last > INTRO_MAX_LEN * 0.4 ? cut.slice(0, last + 1) : cut;
}

/** 查询 zh.wikipedia 词条导言（prop=extracts + variant=zh-cn 强制简体，exintro 仅导言段）
 *  注：该接口计算较重，长期批量调用易被限流，故重试次数与退避都加大 */
async function getZhExtract(title) {
  for (let i = 0; i < 10; i++) {
    try {
      const params = new URLSearchParams({
        action: 'query', prop: 'extracts', exintro: '1', explaintext: '1',
        redirects: '1', format: 'json', formatversion: '2', variant: 'zh-cn', titles: title,
      });
      const res = await throttled(async () => {
        const r = await fetch(`https://zh.wikipedia.org/w/api.php?${params}`, { headers: { 'User-Agent': UA } });
        return r;
      });
      if (res.status === 429) { const e = new Error('RATE'); e.status = 429; throw e; }
      if (!res.ok) return '';
      const j = await res.json();
      const p = j.query && j.query.pages && j.query.pages[0];
      if (p && p.extract && p.extract.trim()) return clipIntro(String(p.extract).trim());
      return '';
    } catch (e) {
      if (e && (e.status === 429 || /fetch failed|ENOTFOUND|timeout|abort|Unexpected token/i.test(String(e.message)))) {
        await sleep(Math.min(2500 * (i + 1), 30000));
        continue;
      }
      return '';
    }
  }
  return '';
}

/** 查询 REST summary 导言段（extract）；zh 用 prop=extracts（支持简体变体），en 用 REST summary */
async function getExtract(host, title) {
  if (host === 'zh.wikipedia.org') return getZhExtract(title);
  for (let i = 0; i < 6; i++) {
    try {
      const res = await throttled(async () => {
        const r = await fetch(`https://${host}/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: { 'User-Agent': UA } });
        return r;
      });
      if (res.status === 429) { const e = new Error('RATE'); e.status = 429; throw e; }
      if (!res.ok) return '';
      const j = await res.json();
      return String(j.extract || '').trim();
    } catch (e) {
      if (e && (e.status === 429 || /fetch failed|ENOTFOUND|timeout|abort|Unexpected token/i.test(String(e.message)))) {
        await sleep(2500 * (i + 1));
        continue;
      }
      return '';
    }
  }
  return '';
}

/** 获取国家介绍：中文优先，en 兜底 */
async function fetchIntro(zhTitle, enTitle) {
  let text = await getExtract('zh.wikipedia.org', zhTitle);
  if (!text && enTitle) text = await getExtract('en.wikipedia.org', enTitle);
  return text;
}

/** 扫描 assets 已有文件，回写 iso2 / image / landmarks 字段 */
function syncFromDisk(countries, landmarks) {
  let n = 0;
  for (const c of countries) {
    const iso = c.iso2 || ISO2[c.en];
    if (!iso) continue;
    const has = (dir, name) => fs.existsSync(path.join(dir, name));
    const img = {};
    if (has(FLAG_DIR, `${iso}.png`)) img.flag = `assets/images/flags/${iso}.png`;
    if (has(CAPITAL_DIR, `${iso}.png`)) img.capital = `assets/images/capitals/${iso}.png`;
    if (Object.keys(img).length) { c.image = img; n++; }
    if (!c.iso2) c.iso2 = iso;
    // 地标：按 landmarks.json 清单回写已有文件
    const list = landmarks[iso] || [];
    const done = [];
    list.forEach((lm, idx) => {
      const f = `assets/images/landmarks/${iso}/${idx + 1}.png`;
      if (has(LANDMARK_DIR, `${iso}/${idx + 1}.png`)) done.push({ name: lm.name, file: f });
    });
    if (done.length) c.landmarks = done;
    else if (c.landmarks) delete c.landmarks;
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(countries, null, 2) + '\n', 'utf8');
  console.log(`已同步 ${n} 个国家图片字段 -> ${DATA_FILE}`);
}

async function main() {
  const args = parseArgs();
  const countries = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const landmarks = JSON.parse(fs.readFileSync(LANDMARKS_FILE, 'utf8'));

  if (args.sync) { syncFromDisk(countries, landmarks); return; }

  const end = args.limit === Infinity ? countries.length : Math.min(args.start + args.limit, countries.length);
  let slice = countries.slice(args.start, end);
  if (args.names) slice = slice.filter((c) => args.names.includes(c.name));
  const only = args.only;
  const rel = (dir, iso, name) => path.relative(PROJECT_ROOT, path.join(dir, iso, name)).replace(/\\/g, '/');

  // 1) 收集要下载的维基词条（首都/地标），批量查缩略图
  const wikiJobs = []; // {c, iso, kind, title, en, file}
  for (const c of slice) {
    const iso = ISO2[c.en];
    if (!iso) { console.log(`[跳过] ${c.name}(${c.en}): 无 ISO 代码`); continue; }
    if (!only || only === 'capital' || only === 'capitals') {
      const file = path.join(CAPITAL_DIR, `${iso}.png`);
      if (args.force || !fs.existsSync(file)) {
        wikiJobs.push({
          c, iso, kind: 'capital',
          title: CAPITAL_TITLE_ZH[iso] || c.capital,
          en: CAPITAL_TITLE_EN[iso] || null,
          file,
        });
      }
    }
    if (!only || only === 'landmark' || only === 'landmarks') {
      (landmarks[iso] || []).forEach((lm, idx) => {
        const file = path.join(LANDMARK_DIR, iso, `${idx + 1}.png`);
        if (args.force || !fs.existsSync(file)) {
          wikiJobs.push({ c, iso, kind: 'landmark', title: lm.title, en: lm.en || null, file, lmName: lm.name, lmIdx: idx });
        }
      });
    }
  }
  const thumb = new Map();
  if (wikiJobs.length) {
    const uniqTitles = [...new Set(wikiJobs.map((j) => j.title))];
    console.log(`查询 ${uniqTitles.length} 个词条的缩略图…`);
    const enByTitle = {};
    for (const j of wikiJobs) if (j.en) enByTitle[j.title] = j.en;
    const batch = await getBatchThumbs(uniqTitles);
    for (const [t, s] of batch) thumb.set(t, s);
    const missing = uniqTitles.filter((t) => !thumb.has(t));
    if (missing.length) {
      console.log(`其中 ${missing.length} 个无缩略图，逐条补充查询…`);
      const rest = await getThumbSources(missing.map((t) => [t, enByTitle[t] || null]));
      for (const [t, s] of rest) thumb.set(t, s);
    }
  }

  // 2) 下载缩略图（首都/地标）
  const tasks = [];
  for (const j of wikiJobs) {
    const src = thumb.get(j.title);
    const label = j.kind === 'capital' ? '首都' : `地标[${j.lmName}]`;
    tasks.push(async () => {
      if (!src) return `[无图] ${j.c.name} ${label}(${j.title})`;
      const ok = await withRetry(src, j.file);
      if (ok) {
        if (j.kind === 'capital') {
          j.c.image = j.c.image || {};
          j.c.image.capital = path.relative(PROJECT_ROOT, j.file).replace(/\\/g, '/');
        } else {
          j.c.landmarks = j.c.landmarks || [];
          const existing = j.c.landmarks.findIndex((x) => x.file.includes(`/${j.iso}/${j.lmIdx + 1}.png`));
          const item = { name: j.lmName, file: path.relative(PROJECT_ROOT, j.file).replace(/\\/g, '/') };
          if (existing >= 0) j.c.landmarks[existing] = item;
          else j.c.landmarks.push(item);
          j.c.landmarks.sort((a, b) => a.file.localeCompare(b.file));
        }
        return `[OK] ${j.c.name} ${label}`;
      }
      return `[失败] ${j.c.name} ${label}`;
    });
  }

  // 3) 国旗（独立、不限流）
  if (!only || only === 'flag' || only === 'flags') {
    for (const c of slice) {
      const iso = ISO2[c.en];
      if (!iso) continue;
      const file = path.join(FLAG_DIR, `${iso}.png`);
      tasks.push(async () => {
        if (!args.force && fs.existsSync(file)) { c.image = c.image || {}; return `[已有] ${c.name} 国旗`; }
        const ok = await withRetry(`https://flagcdn.com/w320/${iso.toLowerCase()}.png`, file);
        if (ok) { c.image = c.image || {}; c.image.flag = rel(FLAG_DIR, iso, `${iso}.png`); return `[OK] ${c.name} 国旗 (${iso})`; }
        return `[失败] ${c.name} 国旗`;
      });
    }
  }

  // 4) 国家介绍（intro：维基导言段，简体中文；CN 为定制介绍）
  if (only === 'intro') {
    for (const c of slice) {
      tasks.push(async () => {
        const iso = c.iso2 || ISO2[c.en];
        if (INTRO_OVERRIDE[iso]) {
          if (args.force || c.intro !== INTRO_OVERRIDE[iso]) { c.intro = INTRO_OVERRIDE[iso]; return `[OK] ${c.name} 介绍(定制)`; }
          return `[已有] ${c.name} 介绍`;
        }
        if (!args.force && c.intro) return `[已有] ${c.name} 介绍`;
        const text = await fetchIntro(INTRO_TITLE_ZH[iso] || c.name, c.en);
        if (text) { c.intro = text; return `[OK] ${c.name} 介绍 (${text.length}字)`; }
        return `[无文] ${c.name} 介绍`;
      });
    }
  }

  const t0 = Date.now();
  const results = await runPool(tasks, CONCURRENCY);
  const printed = new Set();
  for (const r of results) {
    if (r && typeof r === 'string') {
      if (!printed.has(r)) { console.log(r); printed.add(r); }
    } else if (r && r.error) console.log('[异常] ' + (r.error.message || r.error));
  }
  const ok = results.filter((r) => r && r.startsWith('[OK]')).length;
  const exist = results.filter((r) => r && r.startsWith('[已有]')).length;
  const failed = results.filter((r) => r && (r.startsWith('[失败]') || r.startsWith('[无图]') || r.startsWith('[无文]'))).length;
  const errs = results.filter((r) => r && r.error).length;
  console.log(`\n完成：成功 ${ok}，已存在 ${exist}，失败/无图 ${failed}，异常 ${errs}，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (args.write) {
    for (const c of countries) {
      if (!c.iso2 && ISO2[c.en]) c.iso2 = ISO2[c.en];
      if (c.image && Object.keys(c.image).length === 0) delete c.image;
      if (c.landmarks && c.landmarks.length === 0) delete c.landmarks;
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(countries, null, 2) + '\n', 'utf8');
    console.log(`已写回 ${DATA_FILE}`);
  } else {
    console.log('（--no-write：未写回 countries.json）');
  }
}

main().catch((e) => { console.error('[脚本异常]', e); process.exitCode = 1; });
