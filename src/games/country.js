'use strict';

/**
 * “国家海龟汤”玩法：在随机抽取的国家上，通过“是/不是”提问猜出它。
 * 这是对通用引擎 GuessingGame 的一个具体实现。
 */
const { GuessingGame } = require('../engine');
const countries = require('../../data/countries.json');
const { judgeWithLlm, introduceCountry, isLlmConfigured } = require('../llm');
const { buildHeuristicJudge } = require('../judge');

function fmtPop(n) {
  if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
  if (n >= 1e4) return (n / 1e4).toFixed(0) + ' 万';
  return String(n);
}

function fmtArea(n) {
  if (n >= 1e4) return (n / 1e4).toFixed(1) + ' 万平方公里';
  return n + ' 平方公里';
}

function factsCard(c) {
  return [
    '【国家档案】',
    `  国家：${c.name}（${c.en}）`,
    `  所在大洲：${c.continent}`,
    `  首都：${c.capital}`,
    `  人口（约）：${fmtPop(c.population)}`,
    `  国土面积（约）：${fmtArea(c.area)}`,
  ].join('\n');
}

/** 创建一个国家玩法实例 */
function createCountryGame(config) {
  const heuristic = buildHeuristicJudge(countries);

  const judgeMode = config.judgeMode || 'auto';
  const useLlm = judgeMode === 'llm' || (judgeMode === 'auto' && isLlmConfigured(config));

  const game = new GuessingGame({
    name: 'country',
    title: '国家海龟汤',
    dataset: countries,
    pickTarget: () => countries[Math.floor(Math.random() * countries.length)],
    judge: async (target, question) => {
      if (useLlm) {
        const r = await judgeWithLlm(config, target, question);
        if (r.type !== 'error') return r;
        // 大模型不可用时自动降级为离线裁判，保证游戏可继续
        return heuristic(target, question);
      }
      return heuristic(target, question);
    },
    makeHints: (target) => [
      `这个国家位于${target.continent}`,
      `这个国家的首都是${target.capital}`,
      `这个国家的人口约为 ${fmtPop(target.population)}`,
      `这个国家的面积约为 ${fmtArea(target.area)}`,
    ],
    describe: async (target) => {
      let llmIntro = '';
      // 优先使用内置的维基百科介绍（随数据包下载，离线可用、事实可靠）；
      // 没有内置介绍时才回退到实时调用大模型生成
      if (target.intro && target.intro.trim()) {
        llmIntro = target.intro.trim();
      } else if (useLlm) {
        try {
          llmIntro = await introduceCountry(config, target);
        } catch (e) {
          llmIntro = `（大模型介绍生成失败：${e.message}）`;
        }
      }
      return { facts: factsCard(target), llmIntro };
    },
  });

  return {
    game,
    useLlm,
    datasetCount: countries.length,
  };
}

module.exports = { createCountryGame, fmtPop, fmtArea, factsCard };
