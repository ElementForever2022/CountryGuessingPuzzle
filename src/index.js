'use strict';

const readline = require('readline');
const { resolveConfig } = require('./config');
const { resolveLlmConfig } = require('./llm');
const games = require('./games');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// 使用行队列接收输入，同时兼容交互式终端与管道（echo ... | node）输入。
const lineQueue = [];
let waiting = null;
let eof = false;

rl.on('line', (line) => {
  if (waiting) {
    const w = waiting;
    waiting = null;
    w(line);
  } else {
    lineQueue.push(line);
  }
});
rl.on('close', () => {
  eof = true;
  if (waiting) {
    const w = waiting;
    waiting = null;
    w(null);
  }
});

const prompt = (q) => {
  process.stdout.write(q + (process.stdout.isTTY ? '' : ''));
  if (eof && lineQueue.length === 0) return Promise.resolve(null);
  if (lineQueue.length) return Promise.resolve(lineQueue.shift());
  return new Promise((resolve) => {
    waiting = resolve;
  });
};

function banner(title, datasetCount, judgeLabel) {
  const line = '='.repeat(52);
  return [
    '',
    line,
    `  ${title}`,
    `  数据规模：${datasetCount} 个中国官方承认的主权国家`,
    `  裁判：${judgeLabel}`,
    line,
  ].join('\n');
}

function printHelp() {
  console.log([
    '  命令说明：',
    '    直接输入  ：提出一个“是/不是”判断题，例如“这个国家在亚洲吗？”',
    '    也可以猜  ：例如“答案是法国吗？”',
    '    hint/提示  ：获得一条关于神秘国家的提示',
    '    giveup/放弃：放弃本局并揭晓答案',
    '    new/新一局  ：立即开始新的一局',
    '    help/帮助  ：显示本帮助',
    '    exit/退出  ：退出游戏',
  ].join('\n'));
}

function describeResult(rec) {
  const t = rec.type;
  if (t === 'yes') return '是';
  if (t === 'no') return '不是';
  if (t === 'win') return '是（猜中！）';
  if (t === 'invalid') return `无效（${rec.reason || '请重新提问'}）`;
  return '异常';
}

async function reveal(game, res) {
  const target = res.target;
  const line = '-'.repeat(52);
  console.log('');
  console.log(line);
  if (res.reason === 'win') {
    console.log(`  恭喜你！用 ${res.questionCount} 个问题猜出了神秘国家：${target.name}`);
  } else if (res.reason === 'giveup') {
    console.log(`  你选择了放弃。神秘国家是：${target.name}（共提问 ${res.questionCount} 个）`);
  } else {
    console.log(`  神秘国家是：${target.name}（共提问 ${res.questionCount} 个）`);
  }
  console.log(`  用时约 ${Math.round(res.elapsedSec)} 秒`);
  console.log(line);

  if (res.description && res.description.facts) {
    console.log('');
    console.log(res.description.facts);
  }

  if (res.history.length) {
    console.log('');
    console.log('  历史提问记录：');
    res.history.forEach((h, i) => {
      console.log(`    ${i + 1}. ${h.question}  ->  ${describeResult(h.result)}`);
    });
  }

  if (res.description && res.description.llmIntro) {
    console.log('');
    console.log('  大模型趣味介绍：');
    console.log(res.description.llmIntro.split('\n').map((l) => `    ${l}`).join('\n'));
  }
}

/** 玩一局，返回 'exit' 表示整个程序退出 */
async function playRound(game, config) {
  game.start();
  console.log('');
  console.log(`目标已从 ${game.dataset.length} 个主权国家中随机选出。`);
  console.log('开始提问吧（“是/不是”判断题），或输入 help 查看命令。');

  while (true) {
    const line = await prompt(`\n[Q${game.questionCount + 1}] > `);
    if (line === null) return 'exit';
    const input = line.trim();
    if (!input) continue;

    const cmd = input.toLowerCase();
    if (['exit', '退出', 'quit', 'q'].includes(cmd)) {
      await game.finish('quit');
      return 'exit';
    }
    if (['giveup', '放弃'].includes(cmd)) {
      const res = await game.finish('giveup');
      await reveal(game, res);
      return 'giveup';
    }
    if (['new', '新一局', '重来'].includes(cmd)) {
      return playRound(game, config);
    }
    if (['hint', '提示'].includes(cmd)) {
      const h = game.hint();
      if (h.type === 'hint') {
        console.log(`  [提示 ${h.index}/${h.total}] ${h.text}`);
      } else {
        console.log(`  ${h.message}`);
      }
      continue;
    }
    if (['help', '帮助'].includes(cmd)) {
      printHelp();
      continue;
    }
    if (['list', '列表'].includes(cmd)) {
      console.log(`  当前玩法：${game.title}`);
      continue;
    }

    const rec = await game.ask(input);
    if (rec.type === 'error') {
      console.log(`  [裁判异常] ${rec.message}`);
      continue;
    }
    if (rec.type === 'win') {
      console.log('  [回答] 是！你猜对了！');
      const res = await game.finish('win');
      await reveal(game, res);
      return 'win';
    }
    if (rec.type === 'yes') console.log('  [回答] 是');
    else if (rec.type === 'no') console.log('  [回答] 不是');
    else if (rec.type === 'invalid') console.log(`  [无效问题] ${rec.reason || '请重新提问'}`);
  }
}

async function main() {
  const config = resolveConfig();

  let runner;
  try {
    runner = games.create(config.game, config);
  } catch (e) {
    console.error(`[错误] ${e.message}`);
    process.exitCode = 1;
    return;
  }

  const { game, useLlm, datasetCount } = runner;
  const { title } = game;
  const judgeLabel = useLlm
    ? `大模型（${config.provider} / ${resolveLlmConfig(config).model}）`
    : '离线启发式裁判（未配置或未启用大模型）';

  console.log(banner(title, datasetCount, judgeLabel));
  if (!useLlm) {
    console.log('  提示：离线裁判只能判断“国名猜测/大洲/首都”类问题。');
    console.log('  配置大模型可获得完整体验（配置写入 config.json），见 README.md 或 config.example.json。');
  } else if (config.provider === 'ollama') {
    console.log('  提示：正在使用本地 Ollama，请确保已启动；未启动时将自动降级为离线裁判。');
  }

  let again = true;
  while (again) {
    const outcome = await playRound(game, config);
    if (outcome === 'exit') break;
    const ans = await prompt('\n再来一局？(y/n) > ');
    if (ans === null) break;
    const a = ans.trim().toLowerCase();
    if (!['y', 'yes', '是', '再来', '再来一局'].includes(a)) again = false;
  }

  console.log('\n谢谢游玩！下次再会。');
  rl.close();
}

rl.on('SIGINT', () => {
  console.log('\n\n再见，欢迎再来玩国家海龟汤！');
  process.exitCode = 0;
  rl.close();
});

main().catch((e) => {
  console.error(`[错误] ${e.message}`);
  process.exitCode = 1;
});
