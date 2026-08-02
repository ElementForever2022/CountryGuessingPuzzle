'use strict';

/**
 * 通用猜谜游戏引擎（UI 无关）。
 * 只需要注入：数据集、随机抽取器、裁判函数、揭晓介绍函数、提示生成器，
 * 即可复用于任意“20 问式”玩法（猜国家、猜城市、猜电影、猜球星……）。
 * 见 EXTENDING.md 了解如何新增玩法。
 */
class GuessingGame {
  constructor(options = {}) {
    this.name = options.name || 'game';
    this.title = options.title || '猜猜看';
    this.dataset = options.dataset || [];
    this.pickTarget = options.pickTarget || null;   // (dataset) => item
    this.judge = options.judge || null;             // async (item, question, ctx) => { type, reason? }
    this.describe = options.describe || null;       // async (item, history) => string | object
    this.makeHints = options.makeHints || (() => []); // (item) => string[]

    this.target = null;
    this.history = [];
    this.hintsUsed = 0;
    this.startedAt = null;
    this.endedAt = null;
  }

  get questionCount() {
    return this.history.length;
  }

  /** 开始/重开一局 */
  start() {
    if (!this.dataset.length) throw new Error('数据为空，无法开始游戏');
    this.target = this.pickTarget
      ? this.pickTarget(this.dataset)
      : this.dataset[Math.floor(Math.random() * this.dataset.length)];
    this.history = [];
    this.hintsUsed = 0;
    this.startedAt = Date.now();
    this.endedAt = null;
    return this.target;
  }

  /** 提出一个问题，交给裁判判定 */
  async ask(question) {
    const q = String(question || '').trim();
    if (!q) return { type: 'error', message: '问题不能为空' };
    if (!this.target) this.start();

    let result;
    try {
      result = await this.judge(this.target, q, { history: this.history.slice() });
    } catch (e) {
      result = { type: 'error', message: `裁判出错：${e.message}` };
    }

    if (!result || !result.type) result = { type: 'error', message: '裁判返回了无法识别的结果' };
    if (result.type !== 'error') this.history.push({ question: q, result });
    return result;
  }

  /** 逐条给出提示 */
  hint() {
    const hints = this.makeHints(this.target);
    if (this.hintsUsed >= hints.length) return { type: 'error', message: '没有更多提示了' };
    const text = hints[this.hintsUsed];
    this.hintsUsed += 1;
    return { type: 'hint', text, index: this.hintsUsed, total: hints.length };
  }

  /** 结束一局：揭晓目标并生成介绍 */
  async finish(reason) {
    this.endedAt = Date.now();
    let description = null;
    if (this.describe) {
      try {
        description = await this.describe(this.target, this.history.slice());
      } catch (e) {
        description = { facts: '', llmIntro: `（生成介绍时出错：${e.message}）` };
      }
    }
    const elapsedSec = ((this.endedAt || Date.now()) - (this.startedAt || Date.now())) / 1000;
    return {
      reason,
      target: this.target,
      history: this.history.slice(),
      questionCount: this.history.length,
      elapsedSec,
      description,
    };
  }
}

module.exports = { GuessingGame };
