// whale-mind · queue.mjs (M2, 按 feiyu §17.6问题2 / §18 的三条真机教训)
// 1. 带外队列：push() 用 setImmediate 脱离当前调用栈（turn-stopping 事件栈内同步发起
//    模型请求会死等回合锁——feiyu 真机问题2）
// 2. 有活干时 hold 一个 ref 的 interval 拖住事件循环，否则 headless/一次性会话会在回合结束
//    后立刻退进程、"刚聊完就关掉，日记就没了"（feiyu 真机问题3；unref() 等于没等）
// 3. flush 超时必须大于单任务超时（feiyu 真机教训：20s 的 flush 砍掉 60s 的任务）

export class OutOfBandQueue {
  constructor({ jobTimeoutMs = 60000, flushTimeoutMs = 180000, onError } = {}) {
    if (flushTimeoutMs <= jobTimeoutMs) {
      throw new Error(`flushTimeoutMs(${flushTimeoutMs}) 必须大于 jobTimeoutMs(${jobTimeoutMs})——否则 flush 永远先砍掉任务`);
    }
    this.jobTimeoutMs = jobTimeoutMs;
    this.flushTimeoutMs = flushTimeoutMs;
    this.onError = onError || (() => {});
    this.jobs = [];
    this.running = false;
    this._timer = null;
    this.errors = [];
    this._drainPromise = Promise.resolve();
    this._resolveDrain = () => {};
  }

  get pending() { return this.jobs.length; }
  get busy() { return this.running; }

  /** 排队一个任务：fn() 返回 Promise。setImmediate 脱离当前调用栈。 */
  push(fn) {
    this.jobs.push(fn);
    this._holdRef();
    this._drainPromise = new Promise(resolve => {
      setImmediate(() => { this._drain().then(resolve); });
    });
    return this._drainPromise;
  }

  async _drain() {
    if (this.running) return;
    this.running = true;
    while (this.jobs.length) {
      const fn = this.jobs.shift();
      try {
        await this._withTimeout(fn());
      } catch (err) {
        this.errors.push(String(err?.message || err));
        try { this.onError(err); } catch { /* 日志失败不打扰 */ }
      }
    }
    this.running = false;
    this._releaseRef();
  }

  _withTimeout(p) {
    return Promise.race([
      Promise.resolve(p),
      new Promise((_, rej) => setTimeout(() => rej(new Error('job timeout ' + this.jobTimeoutMs + 'ms')), this.jobTimeoutMs))
    ]);
  }

  _holdRef() {
    if (!this._timer) this._timer = setInterval(() => {}, 1 << 30); // ref：拖住事件循环
  }
  _releaseRef() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  /** 退出前清空队列；flushTimeout 必须 > jobTimeout（构造器已校验） */
  async flush() {
    const start = Date.now();
    while (this.jobs.length || this.running) {
      if (Date.now() - start > this.flushTimeoutMs) {
        this.onError(new Error('flush 超时，剩余 ' + this.jobs.length + ' 个任务被放弃'));
        break;
      }
      await new Promise(r => setTimeout(r, 50));
    }
    return this._drainPromise;
  }
}
