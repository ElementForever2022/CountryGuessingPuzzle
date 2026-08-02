'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 配置文件：仅使用 config.json（位于项目根目录，可用 --config 指定路径）。
 * 优先级（从高到低）：命令行参数 > config.json > 默认值。
 * 其中每个键取第一个非空值，因此值为空时会继续向低优先级回退。
 */

const PROJECT_ROOT = path.resolve(__dirname, '..');

/** 打包后的应用无法写入安装目录（app.asar 只读），配置文件改存到系统用户数据目录 */
function resolveConfigPath() {
  const packaged = process.versions.electron && !process.defaultApp;
  if (packaged) {
    try {
      const { app } = require('electron');
      return path.join(app.getPath('userData'), 'config.json');
    } catch (e) {
      // 继续走项目根目录
    }
  }
  return path.join(PROJECT_ROOT, 'config.json');
}

const DEFAULT_CONFIG_PATH = resolveConfigPath();

const DEFAULTS = {
  game: 'country',        // 当前玩法：country | (未来可扩展)
  provider: 'ollama',     // ollama | zhipu | siliconflow | deepseek | openai | moonshot | custom
  apiKey: '',
  apiBase: '',
  model: '',
  judgeMode: 'auto',      // auto | llm | heuristic
  theme: 'default',       // 配色主题：default | forest | sakura | aurora | dawn
  temperature: 0,
  maxTokens: 512,
  timeoutMs: 60000,
};

/** 'api-base' -> 'apiBase' */
function toCamel(s) {
  return s.replace(/-+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
}

/** 解析命令行参数：--key value 或 --key=value（键名做 kebab-case -> camelCase 归一化） */
function parseCliArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const body = a.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      out[toCamel(body.slice(0, eq))] = body.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[toCamel(body)] = next;
        i++;
      } else {
        out[toCamel(body)] = 'true';
      }
    }
  }
  return out;
}

function loadConfigFile(p) {
  if (!p || !fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.warn(`[警告] 无法解析配置文件 ${p}：${e.message}`);
    return {};
  }
}

/**
 * 解析并合并配置。
 * @param {{config?: string}} raw 可指定配置文件路径
 */
function resolveConfig(raw = {}) {
  const cli = parseCliArgs(process.argv.slice(2));
  // 常用别名
  if (cli.judge !== undefined && cli.judgeMode === undefined) cli.judgeMode = cli.judge;
  if (cli.key !== undefined && cli.apiKey === undefined) cli.apiKey = cli.key;

  const cfgPath = cli.config || raw.config || DEFAULT_CONFIG_PATH;
  const fileCfg = loadConfigFile(cfgPath);

  const merged = {};
  for (const key of Object.keys(DEFAULTS)) {
    const candidates = [cli[key], fileCfg[key], DEFAULTS[key]];
    const found = candidates.find((v) => v !== undefined && v !== null && v !== '');
    merged[key] = found === undefined ? DEFAULTS[key] : found;
  }

  for (const k of ['temperature', 'maxTokens', 'timeoutMs']) {
    const n = Number(merged[k]);
    if (Number.isFinite(n)) merged[k] = n;
  }

  return merged;
}

/** 将配置写入 config.json（只写已知配置键，便于查看与手动编辑） */
function saveConfigFile(cfg, p = DEFAULT_CONFIG_PATH) {
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (cfg[key] !== undefined) out[key] = cfg[key];
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(out, null, 2) + '\n', 'utf8');
  return p;
}

/** 将表单值合并到默认值，得到可用的配置对象（用于连接测试等场景） */
function normalizeConfig(values = {}) {
  const merged = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (values[key] !== undefined && values[key] !== null && values[key] !== '') {
      merged[key] = values[key];
    }
  }
  for (const k of ['temperature', 'maxTokens', 'timeoutMs']) {
    const n = Number(merged[k]);
    if (Number.isFinite(n)) merged[k] = n;
  }
  return merged;
}

module.exports = { DEFAULTS, PROJECT_ROOT, DEFAULT_CONFIG_PATH, resolveConfig, saveConfigFile, normalizeConfig };
