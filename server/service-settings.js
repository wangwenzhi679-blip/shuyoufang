import { readChatStream } from './ai-stream.js';
import crypto from 'node:crypto';
import { endpoint, safeAiFetch } from './ai-endpoint.js';
import nodemailer from 'nodemailer';
import { z } from 'zod';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const decode = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
const kinds = ['ai', 'mail'];
const aiSchema = z.object({
  enabled: z.boolean(),
  name: z.string().trim().min(1).max(60).default('DeepSeek'),
  baseUrl: z
    .string()
    .transform((v, ctx) => {
      try {
        return endpoint(v);
      } catch {
        ctx.addIssue({ code: 'custom', message: '请输入公网 HTTPS API 地址' });
        return z.NEVER;
      }
    })
    .default('https://api.deepseek.com/chat/completions'),
  model: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{1,80}$/),
  timeoutMs: z.number().int().min(5000).max(180000),
  apiKey: z
    .string()
    .trim()
    .max(512)
    .regex(/^[^\s]*$/)
    .optional()
    .default(''),
});
const mailSchema = z
  .object({
    enabled: z.boolean(),
    host: z
      .string()
      .trim()
      .max(253)
      .regex(/^(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+$/),
    port: z
      .number()
      .int()
      .refine((v) => [25, 465, 587, 2525].includes(v)),
    secure: z.boolean(),
    user: z
      .string()
      .trim()
      .min(1)
      .max(254)
      .regex(/^[^\r\n]+$/),
    from: z.string().trim().email().max(254),
    password: z.string().max(512).optional().default(''),
  })
  .refine((v) => v.port !== 465 || v.secure, '465 端口需要开启 SSL/TLS');
const mask = (email) => String(email).replace(/^(.).*(.@.*)$/, '$1***$2');
export const serviceSchemaSql = `CREATE TABLE IF NOT EXISTS platform_service_settings (
 kind VARCHAR(16) PRIMARY KEY, config_json JSON NOT NULL, encrypted_secret TEXT NOT NULL, version INT UNSIGNED NOT NULL DEFAULT 1, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`;
export const serviceChecksSql = `CREATE TABLE IF NOT EXISTS platform_service_checks (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, kind VARCHAR(16) NOT NULL, config_version INT UNSIGNED NOT NULL, status VARCHAR(16) NOT NULL, elapsed_ms INT UNSIGNED NULL, summary VARCHAR(300) NOT NULL DEFAULT '', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, finished_at DATETIME NULL, INDEX idx_service_check_kind(kind,id)
)`;
export class ServiceSettings {
  constructor(
    db,
    secret,
    {
      env = process.env,
      fetcher = safeAiFetch,
      transport = (options) => nodemailer.createTransport(options),
    } = {},
  ) {
    this.db = db;
    this.fetcher = fetcher;
    this.transport = transport;
    this.key = crypto.scryptSync(secret, '数有方服务配置', 32);
    this.states = new Map();
    this.checking = new Set();
    this.defaults = {
      ai: {
        enabled: true,
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/chat/completions',
        model: env.DEEPSEEK_MODEL || 'deepseek-chat',
        timeoutMs: 180000,
        apiKey: env.DEEPSEEK_API_KEY || '',
      },
      mail: {
        enabled: true,
        host: env.SMTP_HOST || '',
        port: Number(env.SMTP_PORT || 465),
        secure: env.SMTP_SECURE === 'true',
        user: env.SMTP_USER || '',
        from: (env.MAIL_FROM || '').match(/<([^>]+)>/)?.[1] || env.MAIL_FROM || '',
        password: env.SMTP_PASS || '',
      },
    };
  }
  encrypt(value) {
    // 每次加密使用独立 IV；持久化格式依次为 12 字节 IV、16 字节认证标签和密文。
    const iv = crypto.randomBytes(12),
      cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64');
  }
  decrypt(value) {
    const raw = Buffer.from(value, 'base64'),
      decipher = crypto.createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }
  async init() {
    await this.db.query(serviceSchemaSql);
    await this.db.query(serviceChecksSql);
    await this.db.execute(
      "UPDATE platform_service_checks SET status='failed',summary='服务重启，检查中断',finished_at=NOW() WHERE status='running'",
    );
    const [rows] = await this.db.query('SELECT * FROM platform_service_settings');
    for (const row of rows) {
      this.states.set(row.kind, {
        ...decode(row.config_json),
        [row.kind === 'ai' || row.kind.startsWith('ai_') ? 'apiKey' : 'password']: this.decrypt(
          row.encrypted_secret,
        ),
        version: row.version,
        updatedAt: row.updated_at,
      });
    }
  }
  snapshot(kind) {
    return Object.freeze({
      ...this.defaults[kind.startsWith('ai_') ? 'ai' : kind],
      version: 0,
      updatedAt: null,
      ...(kind.startsWith('ai_') ? { apiKey: '' } : {}),
      ...this.states.get(kind),
    });
  }
  configured(kind) {
    const c = this.snapshot(kind);
    return (
      c.enabled &&
      (kind === 'ai' || kind.startsWith('ai_')
        ? Boolean(c.apiKey)
        : Boolean(c.host && c.port && c.user && c.password && c.from))
    );
  }
  public(kind) {
    const { [kind === 'ai' || kind.startsWith('ai_') ? 'apiKey' : 'password']: secret, ...config } =
      this.snapshot(kind);
    return { ...config, configured: this.configured(kind), secretConfigured: Boolean(secret) };
  }
  mailTransport(config = this.snapshot('mail')) {
    return this.transport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: !config.secure,
      auth: { user: config.user, pass: config.password },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
      tls: { rejectUnauthorized: true },
    });
  }
  async ask(messages, model, signal, options = {}) {
    const config = this.snapshot('ai');
    if (!this.configured('ai'))
      throw fail(config.enabled ? '尚未配置 AI 服务' : 'AI 服务已暂停', 503);
    const response = await this.fetcher(config.baseUrl, {
      method: 'POST',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)])
        : AbortSignal.timeout(config.timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model:
          !model ||
          model === 'configured' ||
          model === 'deepseek-chat' ||
          !config.baseUrl.includes('api.deepseek.com/')
            ? config.model
            : model,
        temperature: 0.35,
        ...(Number.isInteger(options.maxOutputTokens) &&
        options.maxOutputTokens >= 128 &&
        options.maxOutputTokens <= 8192
          ? { max_tokens: options.maxOutputTokens }
          : {}),
        messages,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw fail(
        response.status === 401
          ? 'AI 服务鉴权失败'
          : response.status === 429
            ? 'AI 服务请求受限'
            : 'AI 服务暂时无法回答',
        502,
      );
    if (options.maxOutputTokens && result?.choices?.[0]?.finish_reason === 'length') {
      const error = fail('AI 资料整理输出达到长度上限，请重试', 502);
      error.code = 'AI_OUTPUT_LIMIT';
      throw error;
    }
    const content = result?.choices?.[0]?.message?.content?.trim();
    if (!content) throw fail('AI 服务未返回有效内容', 502);
    return content;
  }
  async askStream(messages, model, signal, onChunk) {
    const config = this.snapshot('ai');
    if (!this.configured('ai'))
      throw fail(config.enabled ? '尚未配置 AI 服务' : 'AI 服务已暂停', 503);
    const combined = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)])
      : AbortSignal.timeout(config.timeoutMs);
    const response = await this.fetcher(config.baseUrl, {
      method: 'POST',
      signal: combined,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey },
      body: JSON.stringify({
        model:
          !model ||
          model === 'configured' ||
          model === 'deepseek-chat' ||
          !config.baseUrl.includes('api.deepseek.com/')
            ? config.model
            : model,
        temperature: 0.35,
        stream: true,
        messages,
      }),
    });
    return readChatStream(response, onChunk, combined);
  }
  async save(kind, input, actor, audit) {
    const parsed = (kind === 'ai' || kind.startsWith('ai_') ? aiSchema : mailSchema).safeParse(
      input,
    );
    if (!parsed.success || !Number.isInteger(input.version) || input.version < 0)
      throw fail('请检查配置字段、端口和超时时间');
    const secretField = kind === 'ai' || kind.startsWith('ai_') ? 'apiKey' : 'password';
    const config = parsed.data;
    const previous = this.snapshot(kind);
    if (kind.startsWith('ai') && config.baseUrl !== previous.baseUrl && !config.apiKey)
      throw fail('更换 API 地址时请重新填写对应密钥');
    const secret = config[secretField] || previous[secretField];
    delete config[secretField];
    if (config.enabled && !secret)
      throw fail(kind === 'ai' || kind.startsWith('ai_') ? '请输入 API 密钥' : '请输入邮件授权码');
    const con = await this.db.getConnection();
    let version;
    try {
      await con.beginTransaction();
      const [[row]] = await con.execute(
        'SELECT version FROM platform_service_settings WHERE kind=? FOR UPDATE',
        [kind],
      );
      if ((row?.version || 0) !== input.version)
        throw fail('配置已在其他窗口更新，请刷新后重试', 409);
      version = (row?.version || 0) + 1;
      await con.execute(
        'INSERT INTO platform_service_settings(kind,config_json,encrypted_secret,version) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE config_json=VALUES(config_json),encrypted_secret=VALUES(encrypted_secret),version=VALUES(version)',
        [kind, JSON.stringify(config), this.encrypt(secret), version],
      );
      await audit(
        con,
        actor,
        'service_config',
        kind,
        'success',
        kind === 'ai' || kind.startsWith('ai_') ? '更新 AI 服务配置' : '更新邮件服务配置',
      );
      await con.commit();
    } catch (error) {
      await con.rollback();
      await audit(con, actor, 'service_config', kind, 'failed', '配置未保存');
      throw error;
    } finally {
      con.release();
    }
    this.states.set(kind, {
      ...config,
      [secretField]: secret,
      version,
      updatedAt: new Date().toISOString(),
    });
    return this.public(kind);
  }
  startCheck(kind, input, actor, audit) {
    return new Promise((resolve, reject) => {
      this.check(kind, input, actor, audit, (id) =>
        resolve({ id, status: 'running', summary: '检查已开始，可继续浏览其他页面' }),
      )
        .then((result) => {
          if (!result.id) reject(fail(result.summary, 502));
        })
        .catch(reject);
    });
  }
  async check(kind, input, actor, audit, onStarted) {
    const baseKind = kind === 'mail_send' ? 'mail' : kind;
    if (!kinds.includes(baseKind) && !/^ai_[a-f0-9]{8}$/.test(baseKind)) throw fail('检查类型无效');
    if (this.checking.has(baseKind)) throw fail('该服务正在检查，请稍后查看', 409);
    if (!this.configured(baseKind)) throw fail('请先启用并配置该服务');
    const config = this.snapshot(baseKind);
    if (input.version !== config.version) throw fail('配置已变化，请刷新后再检查', 409);
    const recipient = kind === 'mail_send' ? z.string().email().max(254).safeParse(input.to) : null;
    if (recipient && !recipient.success) throw fail('请输入正确的测试收件邮箱');
    this.checking.add(baseKind);
    let id,
      transport,
      start = Date.now();
    try {
      const [created] = await this.db.execute(
        "INSERT INTO platform_service_checks(kind,config_version,status) VALUES(?,?,'running')",
        [kind, config.version],
      );
      id = created.insertId;
      onStarted?.(id);
      let summary;
      if (kind === 'ai' || kind.startsWith('ai_')) {
        const response = await this.fetcher(config.baseUrl, {
          method: 'POST',
          signal: AbortSignal.timeout(Math.min(config.timeoutMs, 30000)),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({
            model: config.model,
            max_tokens: 8,
            messages: [{ role: 'user', content: '仅回复 OK' }],
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok)
          throw Object.assign(new Error('AI 请求失败'), { httpStatus: response.status });
        if (!result?.choices?.[0]?.message?.content?.trim()) throw new Error('EMPTY_RESPONSE');
        summary = '模型响应正常';
      } else {
        transport = this.mailTransport(config);
        if (kind === 'mail_send') {
          const sent = await transport.sendMail({
            from: config.from,
            to: recipient.data,
            subject: '数有方 · 邮件服务测试',
            text: '这是一封管理员发起的服务测试邮件，用于确认邮件发送配置。',
          });
          if (!sent.accepted?.length || sent.rejected?.length) throw new Error('MAIL_REJECTED');
          summary = `邮件服务器已接受发送至 ${mask(recipient.data)}，请到收件箱确认`;
        } else {
          await transport.verify();
          summary = 'SMTP 连接与身份验证通过';
        }
      }
      const elapsed = Date.now() - start;
      await this.db.execute(
        "UPDATE platform_service_checks SET status='done',elapsed_ms=?,summary=?,finished_at=NOW() WHERE id=?",
        [elapsed, summary, id],
      );
      await audit(this.db, actor, 'service_check', kind, 'success', summary);
      return { id, status: 'done', summary, elapsed_ms: elapsed, config_version: config.version };
    } catch (error) {
      const summary =
        error.httpStatus === 401 || error.code === 'EAUTH'
          ? '身份验证失败，请检查密钥或授权码'
          : error.httpStatus === 429
            ? '服务请求受限，请稍后重试'
            : error.name === 'TimeoutError' || error.code === 'ETIMEDOUT'
              ? '连接超时，请检查网络与服务地址'
              : error.code === 'ESOCKET' || error.code === 'ECONNECTION'
                ? '无法建立安全连接，请检查服务器与端口'
                : '检查未通过，请检查配置及服务可用性';
      if (id)
        await this.db.execute(
          "UPDATE platform_service_checks SET status='failed',elapsed_ms=?,summary=?,finished_at=NOW() WHERE id=?",
          [Date.now() - start, summary, id],
        );
      await audit(this.db, actor, 'service_check', kind, 'failed', summary);
      return {
        id,
        status: 'failed',
        summary,
        elapsed_ms: Date.now() - start,
        config_version: config.version,
      };
    } finally {
      transport?.close?.();
      this.checking.delete(baseKind);
    }
  }

  matchesCurrent(id) {
    const a = this.snapshot('ai'),
      b = this.snapshot(id);
    return ['name', 'baseUrl', 'model', 'timeoutMs', 'enabled', 'apiKey'].every(
      (key) => a[key] === b[key],
    );
  }
  async activate(id, input, actor, audit) {
    if (!/^ai_[a-f0-9]{8}$/.test(id) || !this.states.has(id)) throw fail('API 配置不存在', 404);
    const con = await this.db.getConnection();
    let current, next, backup, backupId, version;
    try {
      await con.beginTransaction();
      const [rows] = await con.execute(
        'SELECT * FROM platform_service_settings ORDER BY kind FOR UPDATE',
      );
      const row = rows.find((r) => r.kind === id),
        active = rows.find((r) => r.kind === 'ai');
      if (!row) throw fail('API 配置不存在', 404);
      if (row.version !== input.profileVersion || (active?.version || 0) !== input.version)
        throw fail('配置已变化，请刷新后重试', 409);
      next = {
        ...this.defaults.ai,
        ...decode(row.config_json),
        apiKey: this.decrypt(row.encrypted_secret),
      };
      if (!next.enabled || !next.apiKey) throw fail('请先启用并配置该 API');
      current = active
        ? {
            ...this.defaults.ai,
            ...decode(active.config_json),
            apiKey: this.decrypt(active.encrypted_secret),
          }
        : this.snapshot('ai');
      const profiles = rows.filter((r) => r.kind.startsWith('ai_'));
      const retained = profiles.some((r) => {
        const p = {
          ...this.defaults.ai,
          ...decode(r.config_json),
          apiKey: this.decrypt(r.encrypted_secret),
        };
        return ['name', 'baseUrl', 'model', 'timeoutMs', 'enabled', 'apiKey'].every(
          (key) => p[key] === current[key],
        );
      });
      if (current.apiKey && !retained) {
        if (profiles.length >= 12) throw fail('请先删除一组未使用的 API，为原配置留出保存位置');
        backupId = 'ai_' + crypto.randomBytes(4).toString('hex');
        const { apiKey, ...config } = current;
        delete config.version;
        delete config.updatedAt;
        await con.execute(
          'INSERT INTO platform_service_settings(kind,config_json,encrypted_secret,version) VALUES(?,?,?,1)',
          [backupId, JSON.stringify(config), this.encrypt(apiKey)],
        );
        backup = { ...config, apiKey, version: 1, updatedAt: new Date().toISOString() };
      }
      version = (active?.version || 0) + 1;
      const { apiKey, ...config } = next;
      await con.execute(
        'INSERT INTO platform_service_settings(kind,config_json,encrypted_secret,version) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE config_json=VALUES(config_json),encrypted_secret=VALUES(encrypted_secret),version=VALUES(version)',
        ['ai', JSON.stringify(config), this.encrypt(apiKey), version],
      );
      await audit(con, actor, 'service_config', id, 'success', '切换 AI 服务，原配置已保留');
      await con.commit();
    } catch (error) {
      await con.rollback();
      throw error;
    } finally {
      con.release();
    }
    if (backupId) this.states.set(backupId, backup);
    this.states.set('ai', { ...next, version, updatedAt: new Date().toISOString() });
    return this.public('ai');
  }
  async removeProfile(id, version, actor, audit) {
    if (!/^ai_[a-f0-9]{8}$/.test(id) || !Number.isInteger(version)) throw fail('配置参数无效');
    if (this.checking.has(id)) throw fail('该 API 正在检查，请稍后删除', 409);
    const con = await this.db.getConnection();
    try {
      await con.beginTransaction();
      const [rows] = await con.execute(
        'SELECT * FROM platform_service_settings ORDER BY kind FOR UPDATE',
      );
      const row = rows.find((r) => r.kind === id);
      if (!row) throw fail('API 配置不存在', 404);
      if (row.version !== version) throw fail('配置已变化，请刷新后重试', 409);
      const active = rows.find((r) => r.kind === 'ai'),
        a = active
          ? {
              ...this.defaults.ai,
              ...decode(active.config_json),
              apiKey: this.decrypt(active.encrypted_secret),
            }
          : this.snapshot('ai'),
        b = {
          ...this.defaults.ai,
          ...decode(row.config_json),
          apiKey: this.decrypt(row.encrypted_secret),
        };
      if (
        ['name', 'baseUrl', 'model', 'timeoutMs', 'enabled', 'apiKey'].every(
          (key) => a[key] === b[key],
        )
      )
        throw fail('当前使用的 API 不能删除，请先切换服务', 409);
      await con.execute('DELETE FROM platform_service_settings WHERE kind=?', [id]);
      await audit(con, actor, 'service_delete', id, 'success', '删除已保存的 AI API');
      await con.commit();
    } catch (error) {
      await con.rollback();
      throw error;
    } finally {
      con.release();
    }
    this.states.delete(id);
    return { message: 'API 配置已删除' };
  }

  async view() {
    const kinds = [
      'ai',
      'mail',
      'mail_send',
      ...[...this.states.keys()].filter((k) => k.startsWith('ai_')),
      ...(this.chapterImages ? ['chapter_images'] : []),
    ];
    const latest = Object.fromEntries(kinds.map((kind) => [kind, null]));
    const [checks] = await this.db.execute(
      'SELECT c.id,c.kind,c.config_version,c.status,c.elapsed_ms,c.summary,c.created_at,c.finished_at FROM platform_service_checks c JOIN (SELECT kind,MAX(id) AS id FROM platform_service_checks WHERE kind IN (' +
        kinds.map(() => '?').join(',') +
        ') GROUP BY kind) newest ON newest.id=c.id',
      kinds,
    );
    for (const row of checks) latest[row.kind] = row;
    const chapterImages = this.chapterImages
      ? {
          ...this.chapterImages.public(),
          ...(await this.chapterImages.usage()),
          latestCheck: latest.chapter_images
            ? {
                ...latest.chapter_images,
                checkedAt: latest.chapter_images.finished_at || latest.chapter_images.created_at,
              }
            : null,
        }
      : null;
    return {
      ...(chapterImages ? { chapterImages } : {}),
      profiles: [...this.states.keys()]
        .filter((k) => /^ai_[a-f0-9]{8}$/.test(k))
        .map((id) => ({ id, current: this.matchesCurrent(id), ...this.public(id) })),
      ai: this.public('ai'),
      mail: this.public('mail'),
      latest,
      checking: [...this.checking],
      checkedAt: new Date().toISOString(),
      database: 'connected',
      backend: 'running',
      aiConfigured: this.configured('ai'),
      mailConfigured: this.configured('mail'),
      models: [{ id: this.snapshot('ai').model, label: this.snapshot('ai').model }],
      externalConnectionsVerified: false,
    };
  }
}
export function registerServices(route, manager, audit) {
  route('get', '/services', async (req, res) => res.json(await manager.view()));
  route('post', '/services/profiles', async (req, res) => {
    if ([...manager.states.keys()].filter((k) => k.startsWith('ai_')).length >= 12)
      throw fail('最多保存 12 组 API');
    const id = 'ai_' + crypto.randomBytes(4).toString('hex');
    res.json({ id, config: await manager.save(id, { ...req.body, version: 0 }, req.user, audit) });
  });
  route('post', '/services/profiles/:id/activate', async (req, res) =>
    res.json({ config: await manager.activate(req.params.id, req.body, req.user, audit) }),
  );
  route('delete', '/services/profiles/:id', async (req, res) =>
    res.json(await manager.removeProfile(req.params.id, req.body.version, req.user, audit)),
  );
  route('put', '/services/:kind', async (req, res) => {
    if (
      !kinds.includes(req.params.kind) &&
      (!/^ai_[a-f0-9]{8}$/.test(req.params.kind) || !manager.states.has(req.params.kind))
    )
      throw fail('服务类型无效');
    res.json({ config: await manager.save(req.params.kind, req.body, req.user, audit) });
  });
  route('post', '/services/:kind/check', async (req, res) => {
    if (
      !['ai', 'mail', 'mail_send'].includes(req.params.kind) &&
      (!/^ai_[a-f0-9]{8}$/.test(req.params.kind) || !manager.states.has(req.params.kind))
    )
      throw fail('服务类型无效');
    res.status(202).json(await manager.startCheck(req.params.kind, req.body, req.user, audit));
  });
}
