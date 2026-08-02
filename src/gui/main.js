'use strict';

/**
 * 国家海龟汤 - Electron 主进程。
 * 负责创建窗口，并通过 IPC 与渲染进程通信：
 *   - 游戏：开始/提问/提示/结束揭晓
 *   - 配置：读取/保存 config.json、测试大模型连接
 */

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain } = require('electron');

const { resolveConfig, saveConfigFile, DEFAULT_CONFIG_PATH, normalizeConfig } = require('../config');
const { resolveLlmConfig, getProviderCatalog, chat } = require('../llm');
const games = require('../games');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** 读取国家图片（相对项目根的路径）为 data URL，供渲染进程直接展示 */
function toDataUrl(rel) {
  if (!rel || typeof rel !== 'string') return null;
  try {
    const buf = fs.readFileSync(path.join(PROJECT_ROOT, rel));
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch (e) {
    return null;
  }
}

const isSmoke = process.argv.includes('--smoke-test');
const isE2E = process.argv.includes('--e2e-test');

process.on('uncaughtException', (e) => {
  console.error(`[MAIN-UNCAUGHT] ${e && e.stack ? e.stack : e}`);
});
process.on('unhandledRejection', (reason) => {
  console.error(`[MAIN-UNHANDLED] ${reason && reason.stack ? reason.stack : reason}`);
});

let win = null;
let runner = null;

function createRunner(config) {
  runner = games.create(config.game, config);
  return runner;
}

function statusPayload() {
  const config = resolveConfig();
  const model = resolveLlmConfig(config).model || '未设置';
  return {
    version: app.getVersion(),
    title: runner ? runner.game.title : '国家海龟汤',
    datasetCount: runner ? runner.datasetCount : 0,
    useLlm: runner ? runner.useLlm : false,
    provider: config.provider,
    model,
    judgeLabel: runner && runner.useLlm ? `${config.provider} / ${model}` : '离线启发式裁判',
    questionCount: runner ? runner.game.questionCount : 0,
  };
}

function revealPayload(res) {
  const d = res.description || {};
  const img = res.target.image || {};
  const landmarks = (res.target.landmarks || []).slice(0, 6);
  return {
    reason: res.reason,
    target: {
      name: res.target.name,
      en: res.target.en,
      capital: res.target.capital,
      continent: res.target.continent,
      population: res.target.population,
      area: res.target.area,
    },
    images: {
      flag: toDataUrl(img.flag),
      capital: toDataUrl(img.capital),
    },
    landmarks: landmarks.map((l) => ({
      name: l.name || '',
      image: toDataUrl(l.file || l.image),
    })),
    facts: d.facts || '',
    llmIntro: d.llmIntro || '',
    history: res.history.map((h) => ({
      question: h.question,
      type: h.result.type,
      reason: h.result.reason || '',
    })),
    questionCount: res.questionCount,
    elapsedSec: res.elapsedSec,
  };
}

function registerIpc() {
  ipcMain.handle('game:state', () => statusPayload());

  ipcMain.handle('game:start', () => {
    const config = resolveConfig();
    if (!runner) createRunner(config);
    runner.game.start();
    return statusPayload();
  });

  ipcMain.handle('game:ask', async (_e, question) => {
    const config = resolveConfig();
    if (!runner) createRunner(config);
    const result = await runner.game.ask(String(question || ''));
    return {
      type: result.type,
      reason: result.reason || '',
      message: result.message || '',
      questionCount: runner.game.questionCount,
    };
  });

  ipcMain.handle('game:hint', () => {
    if (!runner) createRunner(resolveConfig());
    return runner.game.hint();
  });

  ipcMain.handle('game:finish', async (_e, reason) => {
    if (!runner) createRunner(resolveConfig());
    const res = await runner.game.finish(reason || 'giveup');
    return revealPayload(res);
  });

  ipcMain.handle('config:get', () => ({
    config: resolveConfig(),
    configPath: DEFAULT_CONFIG_PATH,
  }));

  ipcMain.handle('config:providers', () => getProviderCatalog());

  ipcMain.handle('config:save', (_e, values) => {
    try {
      saveConfigFile(values || {});
      const config = resolveConfig();
      createRunner(config); // 用新配置重建玩法，立即生效
      return { ok: true, config, configPath: DEFAULT_CONFIG_PATH };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });

  ipcMain.handle('config:test', async (_e, values) => {
    const cfg = normalizeConfig(values || {});
    const started = Date.now();
    try {
      // maxTokens 放大，避免思考模型的 token 被推理块耗尽导致正文为空
      const reply = await chat(cfg, [{ role: 'user', content: '请只回复两个字：正常' }], {
        temperature: 0,
        maxTokens: 512,
      });
      return {
        ok: true,
        reply,
        elapsed: ((Date.now() - started) / 1000).toFixed(2),
      };
    } catch (err) {
      return {
        ok: false,
        message: err.message,
        elapsed: ((Date.now() - started) / 1000).toFixed(2),
      };
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    title: '国家海龟汤',
    backgroundColor: '#0f1420',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 冒烟/端到端测试：验证窗口、preload 桥接与完整 IPC 流程后自动退出
  win.webContents.once('did-finish-load', async () => {
    if (isSmoke || isE2E) {
      let done = false;
      const watchdog = setTimeout(() => {
        if (!done) {
          console.error('E2E-TIMEOUT 测试流程超过 25s 未完成，强制退出');
          app.exit(2);
        }
      }, 25000);

      try {
        const apiType = await win.webContents.executeJavaScript('typeof window.api');
        console.log(`GUI-READY window.api=${apiType}`);
        if (isE2E) {
          console.log('E2E-START');
          const report = await win.webContents.executeJavaScript(`(async () => {
            const out = { api: typeof window.api };
            try {
              const st = await window.api.startGame();
              out.datasetCount = st.datasetCount;
              out.useLlm = st.useLlm;
              const a = await window.api.ask('这个国家在亚洲吗？');
              out.askType = a.type;
              const h = await window.api.hint();
              out.hint = h.type + ':' + (h.text || h.message || '');
              const cfg = await window.api.getConfig();
              out.provider = cfg.config.provider;
              const reveal = await window.api.finish('giveup');
              out.reveal = reveal.target.name + ' / ' + reveal.facts.split('\\n')[0];
              out.history = reveal.history.length;
              out.images = [reveal.images.flag, reveal.images.capital, ...reveal.landmarks.map((l) => l.image)].filter(Boolean).length;
            } catch (e) { out.error = String(e); }
            out.step = 'done';
            return JSON.stringify(out);
          })()`);
          console.log('E2E-REPORT ' + report);
          done = true;
        }
      } catch (e) {
        console.error(`GUI-SMOKE-ERR ${e.message}`);
        done = true;
      }
      clearTimeout(watchdog);
      setTimeout(() => app.quit(), 400);
      return;
    }
  });

  win.on('closed', () => {
    win = null;
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[RENDER-GONE] reason=${details.reason} exitCode=${details.exitCode}`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`[DID-FAIL-LOAD] ${code} ${desc}`);
  });
}

app.whenReady().then(() => {
  registerIpc();
  createRunner(resolveConfig());
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
