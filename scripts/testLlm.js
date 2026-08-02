'use strict';

/**
 * 大模型连通性测试脚本：node scripts/testLlm.js
 * 读取解析后的配置，向已配置的 Provider 发送一条简单消息，
 * 验证 接口地址 / API Key / 模型名 是否可用。
 *
 * 用法：
 *   npm run test:llm
 *   node scripts/testLlm.js --provider deepseek --api-key sk-xxx
 *   node scripts/testLlm.js --config ./config.json
 */
const { resolveConfig } = require('../src/config');
const { resolveLlmConfig, isLlmConfigured, chat } = require('../src/llm');

async function main() {
  const config = resolveConfig();

  if (!isLlmConfigured(config)) {
    console.warn('[未配置] 当前配置不满足大模型调用条件，请检查：');
    console.warn('  1) provider 是否正确（ollama/zhipu/siliconflow/deepseek/openai/moonshot/custom）');
    console.warn('  2) 是否已提供 apiKey（本地 Ollama 无需 Key）');
    console.warn('  3) 是否设置了 apiBase / model');
    console.warn('  可在项目根目录的 config.json 中配置（模板见 config.example.json），或用命令行参数覆盖。');
    process.exitCode = 2;
    return;
  }

  const c = resolveLlmConfig(config);
  console.log('=== 大模型连接信息 ===');
  console.log(`  provider : ${c.provider}`);
  console.log(`  apiBase  : ${c.base}/chat/completions`);
  console.log(`  model    : ${c.model}`);
  console.log(`  apiKey   : ${c.apiKey ? c.apiKey.slice(0, 6) + '****' : '(空)'}`);
  console.log(`  timeout  : ${c.timeoutMs}ms`);
  console.log('');

  console.log('正在发送测试消息…');
  const started = Date.now();
  try {
    // maxTokens 放大，避免思考模型的 token 被推理块耗尽导致正文为空
    const reply = await chat(config, [
      { role: 'user', content: '请只回复两个字：正常' },
    ], { temperature: 0, maxTokens: 512 });

    const elapsed = ((Date.now() - started) / 1000).toFixed(2);
    console.log('');
    console.log(`[成功] 大模型响应正常，耗时 ${elapsed} 秒`);
    console.log(`[回复] ${reply}`);
    console.log('');
    console.log('提示：现在可以正常游玩了，运行 npm start 开始游戏。');
    process.exitCode = 0;
  } catch (e) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(2);
    console.error('');
    console.error(`[失败] 调用出错，耗时 ${elapsed} 秒`);
    console.error(`[错误] ${e.message}`);
    console.error('');
    console.error('排查建议：');
    console.error('  1) 检查网络与接口地址是否可达（本地 Ollama 需先启动服务）');
    console.error('  2) 检查 API Key 是否正确、额度是否充足');
    console.error('  3) 检查模型名是否存在于该平台（免费模型列表以官网为准）');
    console.error('  4) 若为代理/内网网关，确认其支持 OpenAI 兼容的 /chat/completions 接口');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`[错误] ${e.message}`);
  process.exitCode = 1;
});
