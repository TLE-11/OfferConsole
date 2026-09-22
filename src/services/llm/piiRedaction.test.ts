import assert from 'node:assert/strict';
import test from 'node:test';
import { createPiiRedactor, collectProfilePiiEntries } from './piiRedaction.ts';
import { LLMService } from './llmService.ts';
import { LLMProvider, type LLMConfig } from './types.ts';
import type { UserProfile } from '../../shared/types.ts';

// ---------- createPiiRedactor ----------

test('手机号/邮箱/身份证按模式识别为语义占位符，且可还原', () => {
  const redactor = createPiiRedactor();
  const source = '联系我：13812345678，邮箱 zhang.san+offer@example.com，身份证 11010120020507851X 备用。';
  const redacted = redactor.redactText(source);

  assert.ok(!redacted.includes('13812345678'), '手机号应被脱敏');
  assert.ok(!redacted.includes('zhang.san+offer@example.com'), '邮箱应被脱敏');
  assert.ok(!redacted.includes('11010120020507851X'), '身份证应被脱敏');
  assert.match(redacted, /【手机号】/);
  assert.match(redacted, /【邮箱】/);
  assert.match(redacted, /【身份证】/);

  assert.equal(redactor.restoreText(redacted), source, '还原后应与原文一致');
});

test('多个同类值分配递增序号占位符', () => {
  const redactor = createPiiRedactor();
  const redacted = redactor.redactText('主号 13812345678，备用 13987654321。');

  assert.match(redacted, /【手机号】/);
  assert.match(redacted, /【手机号·2】/);
  assert.equal(
    redactor.restoreText(redacted),
    '主号 13812345678，备用 13987654321。',
  );
});

test('更长的数字串不会被手机号/身份证规则误伤', () => {
  const redactor = createPiiRedactor();
  const source = '订单号 20231381234567890123 与编号 11010120020507851X9 保持不变';
  assert.equal(redactor.redactText(source), source);
});

test('已知值精确替换：姓名等模式外的 PII', () => {
  const redactor = createPiiRedactor([
    { label: '姓名', values: ['张思远'] },
    { label: '微信号', values: ['offer-runner-2026'] },
  ]);
  const redacted = redactor.redactText('我是张思远，微信 offer-runner-2026，欢迎联系。');

  assert.match(redacted, /【姓名】/);
  assert.match(redacted, /【微信号】/);
  assert.ok(!redacted.includes('张思远'));
  assert.equal(redactor.restoreText(redacted), '我是张思远，微信 offer-runner-2026，欢迎联系。');
});

test('长值优先替换，避免短值截断长值', () => {
  const redactor = createPiiRedactor([
    { label: '姓名', values: ['张三', '张三丰'] },
  ]);
  const redacted = redactor.redactText('联合创始人是张三丰，对接人是张三。');

  // 张三丰 应先被完整替换，不会被 张三 截成 【姓名】丰
  assert.ok(!redacted.includes('【姓名】丰'), redacted);
  assert.equal(redactor.restoreText(redacted), '联合创始人是张三丰，对接人是张三。');
});

test('单字符已知值不替换（误伤率过高）', () => {
  const redactor = createPiiRedactor([{ label: '姓', values: ['王'] }]);
  const source = '王者荣耀是一款游戏';
  assert.equal(redactor.redactText(source), source);
});

test('空文本与无占位符文本安全通过', () => {
  const redactor = createPiiRedactor([{ label: '姓名', values: ['李四'] }]);
  assert.equal(redactor.redactText(''), '');
  assert.equal(redactor.restoreText(''), '');
  assert.equal(redactor.restoreText('没有任何占位符的文本'), '没有任何占位符的文本');
});

// ---------- collectProfilePiiEntries ----------

test('collectProfilePiiEntries 从资料收集身份与联系方式字段', () => {
  const profile = {
    personal: {
      name: '张思远',
      phone: '13812345678',
      email: 'siyuan@example.com',
      wechat: 'zzy-2026',
      idCard: '110101200205078519',
      hometown: '河北省石家庄市',
      currentAddress: '北京市海淀区',
      birthDate: '2002-05',
      // 学校等公司/教育信息不应进入
    },
    education: [{ school: '清华大学' }],
  } as unknown as UserProfile;

  const entries = collectProfilePiiEntries(profile);
  const byLabel = new Map(entries.map(e => [e.label, e.values]));

  assert.deepEqual(byLabel.get('姓名'), ['张思远']);
  assert.deepEqual(byLabel.get('微信号'), ['zzy-2026']);
  assert.deepEqual(byLabel.get('籍贯'), ['河北省石家庄市']);
  assert.ok(!byLabel.has('学校'), '学校属于公开履历信息，不应脱敏');
});

test('collectProfilePiiEntries 对空资料返回空数组', () => {
  assert.deepEqual(collectProfilePiiEntries(null), []);
  assert.deepEqual(collectProfilePiiEntries(undefined), []);
  assert.deepEqual(collectProfilePiiEntries({} as UserProfile), []);
});

// ---------- LLMService.chat 集成（mock fetch） ----------

const baseConfig: LLMConfig = {
  provider: LLMProvider.OPENAI,
  apiKey: 'sk-test',
  baseUrl: 'https://llm.example.com/v1',
  model: 'test-model',
};

type FetchCall = { url: string; body: Record<string, unknown> };

async function withMockFetch<T>(
  responder: (call: FetchCall) => Record<string, unknown>,
  run: () => Promise<T>,
): Promise<{ result: T; calls: FetchCall[] }> {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url: String(url), body });
    return new Response(JSON.stringify(responder({ url: String(url), body })), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    return { result: await run(), calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const okResponse = (content: string) => ({
  choices: [{ message: { content }, finish_reason: 'stop' }],
});

test('chat 默认对出站文本脱敏，并把响应中的占位符还原', async () => {
  const llm = new LLMService(baseConfig);
  const { result, calls } = await withMockFetch(
    () => okResponse('你好【姓名】，你的手机号是【手机号】'),
    () => llm.chat(
      [{ role: 'user', content: '我是张思远，手机 13812345678，请向我打招呼' }],
      undefined,
      { pii: { entries: [{ label: '姓名', values: ['张思远'] }] } },
    ),
  );

  const outbound = JSON.stringify(calls[0].body);
  assert.ok(!outbound.includes('张思远'), '出站请求不应含真实姓名');
  assert.ok(!outbound.includes('13812345678'), '出站请求不应含真实手机号');
  assert.ok(outbound.includes('【姓名】'), '出站请求应含语义占位符');
  assert.equal(result.content, '你好张思远，你的手机号是13812345678', '响应应还原为真实值');
});

test('chat 无 entries 时仍按模式正则脱敏手机号', async () => {
  const llm = new LLMService(baseConfig);
  const { calls } = await withMockFetch(
    () => okResponse('ok'),
    () => llm.chat([{ role: 'user', content: '电话 13812345678' }]),
  );

  const outbound = JSON.stringify(calls[0].body);
  assert.ok(!outbound.includes('13812345678'));
  assert.ok(outbound.includes('【手机号】'));
});

test('pii.allowRaw 时按原文发送（简历解析豁免路径）', async () => {
  const llm = new LLMService(baseConfig);
  const { calls } = await withMockFetch(
    () => okResponse('{}'),
    () => llm.chat(
      [{ role: 'user', content: '张思远 13812345678 的简历原文' }],
      undefined,
      { pii: { allowRaw: true } },
    ),
  );

  const outbound = JSON.stringify(calls[0].body);
  assert.ok(outbound.includes('张思远'), '豁免路径应发送原文');
  assert.ok(outbound.includes('13812345678'));
});

test('config.piiProtection === false 时全局关闭脱敏', async () => {
  const llm = new LLMService({ ...baseConfig, piiProtection: false });
  const { calls } = await withMockFetch(
    () => okResponse('ok'),
    () => llm.chat(
      [{ role: 'user', content: '张思远 13812345678' }],
      undefined,
      { pii: { entries: [{ label: '姓名', values: ['张思远'] }] } },
    ),
  );

  const outbound = JSON.stringify(calls[0].body);
  assert.ok(outbound.includes('张思远'));
  assert.ok(outbound.includes('13812345678'));
});

test('restoreResponse: false 时保留占位符（调用方自行处理）', async () => {
  const llm = new LLMService(baseConfig);
  const { result } = await withMockFetch(
    () => okResponse('【姓名】你好'),
    () => llm.chat(
      [{ role: 'user', content: '张思远' }],
      undefined,
      { pii: { entries: [{ label: '姓名', values: ['张思远'] }], restoreResponse: false } },
    ),
  );

  assert.equal(result.content, '【姓名】你好');
});
