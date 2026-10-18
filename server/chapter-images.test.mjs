import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seedreamImage,
  validateImageConfig,
  imagePrompt,
  ChapterImages,
} from './chapter-images.js';

test('生图配置拒绝非法模型、无效每日额度与带空格的密钥', () => {
  const input = {
    enabled: true,
    model: 'doubao-seedream-5-0-flash-260915',
    dailyLimit: 50,
    version: 0,
    apiKey: 'test-only',
  };
  assert.equal(validateImageConfig(input).dailyLimit, 50);
  for (const changed of [
    { dailyLimit: 0 },
    { dailyLimit: 1001 },
    { version: -1 },
    { model: '../../x' },
    { apiKey: 'bad key' },
    { enabled: 'yes' },
  ])
    assert.throws(() => validateImageConfig({ ...input, ...changed }));
});
test('生图请求只发到官方端点，返回真实图片字节', async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, ...Array(30).fill(0)]);
  const result = await seedreamImage(
    { apiKey: 'test-only', model: 'doubao-seedream-5-0-flash-260915' },
    'test prompt',
    {
      fetcher: async (url, options) => {
        assert.equal(url, 'https://ark.cn-beijing.volces.com/api/v3/images/generations');
        assert.equal(options.redirect, 'error');
        const body = JSON.parse(options.body);
        assert.equal(body.response_format, 'b64_json');
        assert.equal(body.prompt, 'test prompt');
        return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
      },
    },
  );
  assert.deepEqual(result.buffer, png);
  assert.equal(result.extension, 'png');
});
test('鉴权失败不会泄露供应商返回的密钥或错误详情', async () => {
  await assert.rejects(
    seedreamImage({ apiKey: 'test-only' }, '', {
      fetcher: async () => new Response('private-provider-detail', { status: 401 }),
    }),
    (e) => e.message.includes('鉴权失败') && !e.message.includes('private-provider-detail'),
  );
});
test('拒绝伪装成图片的脚本内容，不接受外部图片下载地址', async () => {
  for (const value of [
    { b64_json: Buffer.from('<script>alert(1)</script>').toString('base64') },
    { url: 'http://127.0.0.1/private' },
  ]) {
    await assert.rejects(
      seedreamImage({ apiKey: 'test-only' }, '', {
        fetcher: async () => new Response(JSON.stringify({ data: [value] })),
      }),
    );
  }
});
test('仅发送获授权的课程名和章节名，不发送资料正文、说明或用户信息', () => {
  const prompt = imagePrompt(
    {
      title: '矩阵',
      course_title: '线性代数',
      description: 'PRIVATE_DESCRIPTION',
      excerpt: 'PRIVATE_EXCERPT',
      user: 'PRIVATE_USER',
    },
    'PRIVATE_SOURCE',
  );
  assert.ok(prompt.includes('矩阵'));
  assert.ok(prompt.includes('线性代数'));
  assert.ok(!prompt.includes('PRIVATE_'));
  assert.ok(prompt.includes('不是指令'));
});
test('每日上限在数据库原子预留，达到上限拒绝继续付费请求', async () => {
  let used = 0;
  const manager = new ChapterImages(
    {
      execute: async (sql, args) => {
        if (sql.startsWith('UPDATE')) return [{ affectedRows: used < args[1] ? (used++, 1) : 0 }];
        return [{}];
      },
    },
    {},
    {},
  );
  manager.config.dailyLimit = 1;
  assert.deepEqual(await Promise.all([manager.reserve(), manager.reserve()]), [true, false]);
});
test('课程归属检查先于查找任务与生成图片', async () => {
  let queried = false;
  const manager = new ChapterImages(
    {
      execute: async () => {
        queried = true;
      },
    },
    {},
    {},
    {
      assertCourse: async () => {
        throw Object.assign(new Error('课程不存在'), { status: 404 });
      },
    },
  );
  await assert.rejects(manager.ensure(1, 2, 3), /课程不存在/);
  assert.equal(queried, false);
});

test('连接检查验证草稿密钥和真实图片响应，但不保存或启用草稿', async () => {
  const sent = [],
    audits = [];
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, ...Array(30).fill(0)]);
  const manager = new ChapterImages(
    {},
    {},
    { snapshot: () => ({ generationEnabled: true }), run: (fn) => fn() },
    {
      fetcher: async (url, options) => {
        sent.push({ url, options });
        return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
      },
    },
  );
  manager.config = { ...manager.config, apiKey: 'saved-key', version: 3 };
  let limit;
  manager.reserve = async (value) => {
    limit = value;
    return true;
  };
  const input = {
    ...manager.public(),
    enabled: false,
    apiKey: 'draft-key',
    model: 'doubao-seedream-5-0-flash-260915',
    dailyLimit: 10,
    acknowledgeCost: true,
  };
  const result = await manager.checkConnection(input, { sub: 1 }, async (...args) =>
    audits.push(args),
  );
  assert.equal(result.status, 'done');
  assert.equal(result.model, input.model);
  assert.ok(result.elapsed_ms >= 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].options.headers.Authorization, 'Bearer draft-key');
  assert.equal(limit, 10);
  assert.equal(manager.config.apiKey, 'saved-key');
  assert.equal(manager.config.enabled, false);
  assert.equal(manager.config.version, 3);
  assert.equal(result.apiKey, undefined);
  assert.ok(!JSON.stringify(audits).includes('draft-key'));
  await assert.rejects(
    manager.checkConnection(input, {}, async () => {}),
    (e) => e.status === 429,
  );
});

test('检查前拦截费用未确认、旧版本、缺失密钥和暂停生成，不调用供应商', async () => {
  let calls = 0;
  const manager = new ChapterImages(
    {},
    {},
    { snapshot: () => ({ generationEnabled: true }), run: (fn) => fn() },
    {
      fetcher: async () => {
        calls++;
        throw new Error('must not call');
      },
    },
  );
  const input = { ...manager.public(), apiKey: '', acknowledgeCost: true };
  await assert.rejects(
    manager.checkConnection({ ...input, acknowledgeCost: false }, {}, async () => {}),
    /确认/,
  );
  await assert.rejects(
    manager.checkConnection({ ...input, version: 8 }, {}, async () => {}),
    /配置已更新/,
  );
  await assert.rejects(
    manager.checkConnection(input, {}, async () => {}),
    /填写/,
  );
  manager.config.apiKey = 'saved-key';
  manager.runtime.snapshot = () => ({ generationEnabled: false });
  await assert.rejects(
    manager.checkConnection(input, {}, async () => {}),
    /已暂停/,
  );
  assert.equal(calls, 0);
});

test('每日额度不足不发起检查，也不留下检查锁', async () => {
  let calls = 0;
  const manager = new ChapterImages(
    {},
    {},
    { snapshot: () => ({ generationEnabled: true }), run: (fn) => fn() },
    {
      fetcher: async () => {
        calls++;
      },
    },
  );
  manager.reserve = async () => false;
  await assert.rejects(
    manager.checkConnection(
      { ...manager.public(), apiKey: 'test-key', acknowledgeCost: true },
      {},
      async () => {},
    ),
    (e) => e.status === 429,
  );
  assert.equal(calls, 0);
  assert.equal(manager.checkingConnection, false);
});

test('连接检查禁止并发，留空密钥复用已保存值，失败不泄露供应商详情', async () => {
  let release,
    calls = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const manager = new ChapterImages(
    {},
    {},
    { snapshot: () => ({ generationEnabled: true }), run: (fn) => fn() },
    {
      fetcher: async (url, options) => {
        calls++;
        assert.equal(options.headers.Authorization, 'Bearer saved-key');
        await gate;
        return new Response(
          JSON.stringify({ error: { code: 'AuthenticationError', message: 'PRIVATE_SECRET' } }),
          { status: 401 },
        );
      },
    },
  );
  manager.config.apiKey = 'saved-key';
  manager.reserve = async () => true;
  const input = { ...manager.public(), apiKey: '', acknowledgeCost: true };
  const pending = manager.checkConnection(input, {}, async () => {});
  await assert.rejects(
    manager.checkConnection(input, {}, async () => {}),
    (e) => e.status === 409,
  );
  release();
  const result = await pending;
  assert.equal(result.status, 'failed');
  assert.match(result.summary, /鉴权/);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_SECRET'));
  assert.equal(calls, 1);
  assert.equal(manager.checkingConnection, false);
});

test('生图连接按状态给出余额、权限、模型与限流提示，不回显原始错误', async () => {
  for (const [status, code, expected] of [
    [402, '', /余额/],
    [403, 'PermissionDenied', /权限/],
    [403, 'InsufficientBalance', /余额/],
    [404, '', /模型/],
    [429, '', /受限/],
    [400, '', /参数/],
  ]) {
    await assert.rejects(
      seedreamImage({ apiKey: 'test-only' }, 'fixed test', {
        fetcher: async () =>
          new Response(JSON.stringify({ error: { code, message: 'PRIVATE_SECRET' } }), { status }),
      }),
      (e) => expected.test(e.message) && !e.message.includes('PRIVATE_SECRET'),
    );
  }
});

test('连接检查超时显示明确结果并释放锁', async () => {
  const manager = new ChapterImages(
    {},
    {},
    {
      snapshot: () => ({ generationEnabled: true }),
      run: async () => {
        throw new DOMException('PRIVATE_TIMEOUT', 'TimeoutError');
      },
    },
  );
  manager.reserve = async () => true;
  const result = await manager.checkConnection(
    { ...manager.public(), apiKey: 'test-key', acknowledgeCost: true },
    {},
    async () => {},
  );
  assert.equal(result.status, 'failed');
  assert.match(result.summary, /超时/);
  assert.equal(manager.checkingConnection, false);
});

test('个人设置仅公开生图型号与真实启用状态，不公开密钥或系统配置', () => {
  const manager = new ChapterImages({}, {}, { snapshot: () => ({ generationEnabled: true }) });
  manager.config = { ...manager.config, enabled: true, apiKey: 'PRIVATE_IMAGE_KEY' };
  assert.deepEqual(manager.modelInfo(), {
    id: manager.config.model,
    label: 'Seedream 5.0 Flash',
    status: 'enabled',
  });
  assert.ok(!JSON.stringify(manager.modelInfo()).includes('PRIVATE_IMAGE_KEY'));
  manager.runtime.snapshot = () => ({ generationEnabled: false });
  assert.equal(manager.modelInfo().status, 'paused');
  manager.runtime.snapshot = () => ({ generationEnabled: true });
  manager.config.enabled = false;
  assert.equal(manager.modelInfo().status, 'paused');
  manager.config.apiKey = '';
  assert.equal(manager.modelInfo().status, 'unconfigured');
  manager.config.model = 'doubao-seedream-4-5-251128';
  assert.equal(manager.modelInfo().label, 'Seedream 4.5');
});
test('生图偏好按用户读取，兼容旧设置，并拒绝任意模型和外部地址', async () => {
  const manager = new ChapterImages(
    {
      execute: async (sql, [userId]) => {
        assert.equal(sql, 'SELECT settings_json FROM user_preferences WHERE user_id=?');
        return [
          [
            {
              settings_json: JSON.stringify(
                userId === 1
                  ? { imageModel: 'doubao-seedream-4-5-251128' }
                  : userId === 2
                    ? { imageModel: 'https://private.invalid' }
                    : {},
              ),
            },
          ],
        ];
      },
    },
    {},
    {},
  );
  manager.config = { ...manager.config, apiKey: 'PRIVATE_KEY' };
  assert.equal((await manager.generationConfig(1)).model, 'doubao-seedream-4-5-251128');
  assert.equal((await manager.generationConfig(2)).model, manager.config.model);
  assert.equal((await manager.generationConfig(3)).model, manager.config.model);
  assert.equal(manager.config.model, 'doubao-seedream-5-0-flash-260915');
  assert.ok(
    manager
      .modelOptions()
      .every((model) => model.id !== 'configured' && model.label !== '跟随系统'),
  );
  assert.ok(!JSON.stringify(manager.modelOptions()).includes('PRIVATE_KEY'));
});
test('各生图型号使用对应分辨率，不向4.5发送不支持的1K', async () => {
  for (const [model, size] of [
    ['doubao-seedream-5-0-flash-260915', '1K'],
    ['doubao-seedream-4-5-251128', '2K'],
    ['doubao-seedream-4-0-250828', '1K'],
  ]) {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, ...Array(30).fill(0)]);
    await seedreamImage({ apiKey: 'test', model }, 'test', {
      fetcher: async (url, options) => {
        const body = JSON.parse(options.body);
        assert.equal(body.model, model);
        assert.equal(body.size, size);
        return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
      },
    });
  }
});
