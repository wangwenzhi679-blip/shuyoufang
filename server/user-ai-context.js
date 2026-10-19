import { AsyncLocalStorage } from 'node:async_hooks';

// 让后台任务也按任务所属用户的设置选模型，避免串用管理员或其他请求的偏好。
export class UserAiContext {
  constructor({ services, readPreferences }) {
    this.services = services;
    this.readPreferences = readPreferences;
    this.storage = new AsyncLocalStorage();
  }

  run(userId, action) {
    if (!userId) return action();
    const current = this.storage.getStore();
    if (userId && Number(current?.userId) === Number(userId)) return action();
    return this.storage.run({ userId, preferences: null }, action);
  }

  async model(requested) {
    const config = this.services.snapshot('ai');
    if (new URL(config.baseUrl).hostname !== 'api.deepseek.com') return config.model;
    let selected = requested;
    if (!selected || selected === 'deepseek-chat') {
      const context = this.storage.getStore();
      if (context?.userId) {
        context.preferences ||= this.readPreferences(context.userId);
        selected = (await context.preferences).defaultModel;
      }
    }
    if (!selected || selected === 'configured' || selected === 'deepseek-chat') return config.model;
    if (!['deepseek-flash', 'deepseek-v4-pro'].includes(selected))
      throw Object.assign(new Error('请选择设置中可用的 AI 模型'), { status: 400 });
    return selected;
  }

  async fingerprint(requested) {
    return this.services.snapshot('ai').baseUrl + '|' + (await this.model(requested));
  }

  async ask(messages, requested, signal, options) {
    const model = await this.model(requested);
    this.assertImages(messages, model);
    return this.services.ask(messages, model, signal, options);
  }

  async askStream(messages, requested, signal, onChunk) {
    const model = await this.model(requested);
    this.assertImages(messages, model);
    return this.services.askStream(messages, model, signal, onChunk);
  }

  assertImages(messages, model) {
    const official = new URL(this.services.snapshot('ai').baseUrl).hostname === 'api.deepseek.com';
    if (
      official &&
      model === 'deepseek-v4-pro' &&
      messages.some(
        (message) =>
          Array.isArray(message.content) &&
          message.content.some((part) => part.type === 'image_url'),
      )
    )
      throw Object.assign(
        new Error('当前设置的 DeepSeek V4 Pro 不支持图片输入，请在设置中选择支持图片识别的模型'),
        { status: 400 },
      );
  }
}
