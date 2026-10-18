export const defaults = Object.freeze({
  uploadMB: 200,
  uploadCount: 5,
  aiConcurrency: 4,
  chatEnabled: true,
  generationEnabled: true,
});
const MAX_QUEUED_REQUESTS = 64;
const numericLimits = [
  { key: 'uploadMB', label: '单个资料大小', max: 500 },
  { key: 'uploadCount', label: '单次资料数量', max: 20 },
  { key: 'aiConcurrency', label: 'AI 请求并发数', max: 16 },
];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function validate(value) {
  const config = {};
  for (const { key, label, max } of numericLimits) {
    const limit = value?.[key];
    if (!Number.isInteger(limit) || limit < 1 || limit > max) {
      throw fail(`${label}必须为 1 至 ${max} 的整数`);
    }
    config[key] = limit;
  }
  for (const key of ['chatEnabled', 'generationEnabled']) {
    if (typeof value?.[key] !== 'boolean') throw fail('暂停开关不正确');
    config[key] = value[key];
  }
  return config;
}

export class RuntimeLimits {
  constructor(db) {
    this.db = db;
    this.config = { ...defaults };
    this.version = 0;
    this.active = 0;
    this.queue = [];
  }
  async init() {
    await this.db.query(
      'CREATE TABLE IF NOT EXISTS platform_runtime_limits (id INT PRIMARY KEY,config_json JSON NOT NULL,version INT NOT NULL DEFAULT 0,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)',
    );
    await this.db.execute(
      'INSERT IGNORE INTO platform_runtime_limits(id,config_json) VALUES(1,?)',
      [JSON.stringify(defaults)],
    );
    const [[row]] = await this.db.query(
      'SELECT config_json,version FROM platform_runtime_limits WHERE id=1',
    );
    this.config = validate(
      typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json,
    );
    this.version = row.version;
  }
  snapshot() {
    return { ...this.config };
  }
  public() {
    return {
      config: this.snapshot(),
      version: this.version,
      active: this.active,
      waiting: this.queue.length,
    };
  }
  assert(kind) {
    if (!this.config[kind === 'chat' ? 'chatEnabled' : 'generationEnabled'])
      throw fail(kind === 'chat' ? 'AI 问答已暂停，请稍后再试' : 'AI 生成已暂停，请稍后再试', 503);
  }
  pump() {
    while (this.active < this.config.aiConcurrency && this.queue.length) {
      const waiting = this.queue.shift();
      waiting.signal?.removeEventListener('abort', waiting.abort);
      this.active++;
      waiting.resolve();
    }
  }

  waitForSlot(signal) {
    signal?.throwIfAborted();
    if (this.queue.length >= MAX_QUEUED_REQUESTS) throw fail('AI 请求较多，请稍后再试', 429);

    return new Promise((resolve, reject) => {
      const waiting = { resolve, signal };
      waiting.abort = () => {
        const index = this.queue.indexOf(waiting);
        if (index < 0) return;
        this.queue.splice(index, 1);
        reject(signal.reason);
      };
      signal?.addEventListener('abort', waiting.abort, { once: true });
      this.queue.push(waiting);
      this.pump();
    });
  }

  async run(task, signal) {
    await this.waitForSlot(signal);
    try {
      signal?.throwIfAborted();
      return await task();
    } finally {
      this.active--;
      this.pump();
    }
  }

  register(route, audit) {
    route('get', '/limits', async (req, res) => res.json(this.public()));
    route('put', '/limits', async (req, res) => {
      const config = validate(req.body?.config);
      if (!Number.isInteger(req.body?.version)) throw fail('配置版本不正确');
      const reason = String(req.body.reason || '').trim();
      if (!reason || reason.length > 200) throw fail('请填写修改原因，最多 200 字');
      const connection = await this.db.getConnection();
      try {
        await connection.beginTransaction();
        const [result] = await connection.execute(
          'UPDATE platform_runtime_limits SET config_json=?,version=version+1 WHERE id=1 AND version=?',
          [JSON.stringify(config), req.body.version],
        );
        if (!result.affectedRows) throw fail('配置已被修改，请刷新后重试', 409);
        await audit(connection, req.user, 'runtime_config', '1', 'success', reason);
        await connection.commit();
        if (req.body.version + 1 > this.version) {
          this.config = config;
          this.version = req.body.version + 1;
          this.pump();
        }
        res.json(this.public());
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    });
  }
}
