
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// ============================================================================
// dsh-offpeak-guard —— 峰期自动停机、谷期自动续跑（省钱）
// ============================================================================
// 规则（DeepSeek 2026-09-19 起）：北京时间周一至周五 9:00-12:00、14:00-18:00 为峰期；
// 其余时段（含周末、法定节假日全天）都是谷期。谷期便宜一半。
// 本插件在峰期到来时把所有正在跑的会话停掉，谷期来了再自动续跑。
// ============================================================================

export const name = 'dsh-offpeak-guard';
export const inject = [];

const PEAK_HOURS = [[9, 12], [14, 18]];

// 法定节假日全天谷价（2026 年，来源见 whale-widget；每年 11 月要补下一年）
const HOLIDAYS = {
  '2026-01-01': 1, '2026-01-02': 1, '2026-01-03': 1,
  '2026-02-15': 1, '2026-02-16': 1, '2026-02-17': 1, '2026-02-18': 1, '2026-02-19': 1,
  '2026-02-20': 1, '2026-02-21': 1, '2026-02-22': 1, '2026-02-23': 1,
  '2026-04-04': 1, '2026-04-05': 1, '2026-04-06': 1,
  '2026-05-01': 1, '2026-05-02': 1, '2026-05-03': 1, '2026-05-04': 1, '2026-05-05': 1,
  '2026-06-19': 1, '2026-06-20': 1, '2026-06-21': 1,
  '2026-09-25': 1, '2026-09-26': 1, '2026-09-27': 1,
  '2026-10-01': 1, '2026-10-02': 1, '2026-10-03': 1, '2026-10-04': 1,
  '2026-10-05': 1, '2026-10-06': 1, '2026-10-07': 1,
};

const CONTINUE_TEXT = '（谷期到了，峰谷价已经切到便宜的谷期，接着刚才中断的地方继续跑。）';

function beijing(ms) {
  return new Date(ms + 8 * 3600 * 1000);
}

/** 某一时刻是不是峰期。 */
export function isPeakAt(ms) {
  const bj = beijing(ms);
  const day = bj.toISOString().slice(0, 10);
  const dow = bj.getUTCDay(); // 0=周日 6=周六
  if (dow === 0 || dow === 6) return false;      // 周末全天谷价
  if (HOLIDAYS[day] === 1) return false;          // 法定节假日全天谷价
  const hour = bj.getUTCHours();
  return PEAK_HOURS.some(([start, end]) => hour >= start && hour < end);
}

/** 下一个峰谷切换时刻（毫秒）；找不到就返回 null。 */
export function nextChangeAt(ms) {
  const start = Math.ceil(ms / 60000) * 60000;
  const before = isPeakAt(start);
  for (let step = 1; step <= 60 * 24 * 14; step += 1) {
    const at = start + step * 60000;
    if (isPeakAt(at) !== before) return at;
  }
  return null;
}

function readJson(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value !== null && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeJson(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

/** 峰谷闸门：状态、暂停清单、开关都在这里，可单独测试。 */
export class Guard {
  constructor({ dir, log }) {
    this.dir = dir;
    this.file = path.join(dir, 'state.json');
    this.logFile = path.join(dir, 'offpeak.log');
    this.log = log ?? (() => {});
    fs.mkdirSync(dir, { recursive: true });
    const saved = readJson(this.file);
    this.waitOffPeak = saved.waitOffPeak !== false;
    this.paused = saved.paused !== null && typeof saved.paused === 'object' ? saved.paused : {};
    this.forced = Array.isArray(saved.forced) ? saved.forced : [];
    this.lastResume = saved.lastResume ?? null;
    this.lastStop = saved.lastStop ?? null;
    this.live = new Set();
  }

  note(line) {
    try {
      if (fs.statSync(this.logFile).size > 256 * 1024) fs.writeFileSync(this.logFile, '');
    } catch { /* 还没有这个文件 */ }
    try {
      fs.appendFileSync(this.logFile, new Date().toISOString() + ' ' + line + '\n');
    } catch { /* ignore */ }
    this.log(line);
  }

  save() {
    try {
      writeJson(this.file, {
        waitOffPeak: this.waitOffPeak,
        paused: this.paused,
        forced: this.forced,
        lastResume: this.lastResume,
        lastStop: this.lastStop,
      });
    } catch { /* ignore */ }
  }

  setWait(value) {
    this.waitOffPeak = value === true;
    this.save();
    this.note('waitOffPeak=' + this.waitOffPeak);
  }

  /** 把一个会话记成「因峰期暂停」。 */
  pause(sessionId, turn) {
    this.paused[sessionId] = { at: Date.now(), turn: turn ?? null };
    this.save();
  }

  /** 用户点「立即继续」：这些会话不再被自动停。 */
  forceAll() {
    this.forced = Object.keys(this.paused);
    this.save();
    return this.forced.length;
  }

  /** 停掉所有正在跑的会话；返回停了几个。 */
  async stopLive(controller, now) {
    const ids = [];
    for (const id of this.live) {
      if (this.forced.includes(id)) continue;
      ids.push(id);
    }
    if (ids.length === 0) return 0;
    for (const id of ids) {
      try {
        await controller.cancel({ sessionId: id });
        this.pause(id, null);
        this.live.delete(id);
        this.note('stopped ' + id);
      } catch (error) {
        this.note('stop failed ' + id + ': ' + String(error?.message ?? error));
      }
    }
    if (ids.length > 0) {
      this.lastStop = { at: now, count: ids.length };
      this.save();
    }
    return ids.length;
  }

  /** 谷期到了：把暂停的会话都续上。 */
  async resumePaused(controller, now) {
    const ids = Object.keys(this.paused);
    if (ids.length === 0) return 0;
    let done = 0;
    for (const id of ids) {
      try {
        await controller.prompt({
          requestId: randomUUID(),
          sessionId: id,
          mode: 'queue',
          content: [{ type: 'text', text: CONTINUE_TEXT }],
        }, new AbortController().signal);
        delete this.paused[id];
        this.forced = this.forced.filter((item) => item !== id);
        done += 1;
        this.note('resumed ' + id);
      } catch (error) {
        this.note('resume failed ' + id + ': ' + String(error?.message ?? error));
      }
    }
    if (done > 0) {
      this.lastResume = { at: now, count: done };
      this.save();
    }
    return done;
  }

  /** 心跳：根据当前时刻决定停还是续。 */
  async tick(controller, now = Date.now()) {
    if (controller === undefined || controller === null) return { phase: null };
    const phase = isPeakAt(now) ? 'peak' : 'valley';
    if (phase === 'peak' && this.waitOffPeak) {
      const stopped = await this.stopLive(controller, now);
      return { phase, stopped };
    }
    if (phase === 'valley') {
      this.forced = [];
      const resumed = this.paused ? await this.resumePaused(controller, now) : 0;
      return { phase, resumed };
    }
    return { phase };
  }

  snapshot(now = Date.now()) {
    return {
      waitOffPeak: this.waitOffPeak,
      phase: isPeakAt(now) ? 'peak' : 'valley',
      now,
      nextChangeAt: nextChangeAt(now),
      paused: Object.keys(this.paused),
      live: [...this.live],
      forced: this.forced,
      lastResume: this.lastResume,
      lastStop: this.lastStop,
      text: CONTINUE_TEXT,
    };
  }
}

function optionalService(ctx, service) {
  try { return ctx.reflect?.get?.(service); } catch { return undefined; }
}

export function apply(ctx, config = {}) {
  if (config.enabled === false) return;
  const dir = config.dir ?? path.join(process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'), 'offpeak-guard');
  const intervalMs = Number(config.intervalMs ?? 20000);
  const guard = new Guard({ dir, log: (line) => { try { ctx.logger?.info?.('[offpeak] ' + line); } catch { /* ignore */ } } });
  if (typeof config.waitOffPeak === 'boolean') guard.setWait(config.waitOffPeak);

  let disposed = false;
  let controller;
  let timer;
  let lastPhase = null;

  const kick = async () => {
    if (disposed || controller === undefined) return;
    const now = Date.now();
    try {
      const result = await guard.tick(controller, now);
      if (result.phase !== undefined && result.phase !== null && result.phase !== lastPhase) {
        lastPhase = result.phase;
        guard.note('phase -> ' + result.phase);
      }
    } catch (error) {
      guard.note('tick failed: ' + String(error?.message ?? error));
    }
  };

  // 记录哪些会话正在跑；峰期新起的会话立刻停
  try {
    ctx.on('session/event', (session, event) => {
      const id = session?.id;
      if (typeof id !== 'string' || id.length === 0) return;
      const type = String(event?.type ?? '');
      if (type === 'turn/start') {
        if (isPeakAt(Date.now()) && guard.waitOffPeak && !guard.forced.includes(id)) {
          guard.live.add(id);
          guard.note('peak turn/start ' + id + ' -> stop');
          Promise.resolve().then(() => kick());
          return;
        }
        guard.live.add(id);
      } else if (type === 'turn/end') {
        guard.live.delete(id);
      }
    });
  } catch (error) {
    guard.note('subscribe failed: ' + String(error?.message ?? error));
  }

  const boot = (services) => {
    controller = services?.sessionController ?? optionalService(ctx, 'sessionController');
    kick().catch(() => {});
    const loop = () => {
      if (disposed) return;
      kick().catch(() => {});
      timer = setTimeout(loop, intervalMs);
      timer.unref?.();
    };
    loop();
  };
  try {
    if (typeof ctx.inject === 'function') ctx.inject(['sessionController'], boot);
    else boot(ctx);
  } catch {
    boot(ctx);
  }

  // 给前端用的接口
  const mount = (web) => {
    const handler = (req, res) => {
      const send = (status, value) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(value));
      };
      if (req.method === 'GET') return send(200, guard.snapshot());
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        let body = {};
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = {}; }
        const action = body.action ?? String(req.url ?? '').split('/').pop();
        if (action === 'toggle') {
          guard.setWait(body.waitOffPeak === true);
          return send(200, guard.snapshot());
        }
        if (action === 'resume-now') {
          const count = guard.forceAll();
          guard.resumePaused(controller, Date.now()).then((done) => send(200, { ...guard.snapshot(), resumed: done, forced: count })).catch((error) => send(500, { error: String(error?.message ?? error) }));
          return;
        }
        if (action === 'kick') {
          kick().then(() => send(200, guard.snapshot())).catch((error) => send(500, { error: String(error?.message ?? error) }));
          return;
        }
        send(400, { error: 'unknown action' });
      });
    };
    try {
      web.webServer.register({ kind: 'prefix', path: '/offpeak-guard/api', handler });
    } catch (error) {
      guard.note('route registration failed: ' + String(error));
    }
  };
  try {
    if (typeof ctx.inject === 'function') ctx.inject(['webServer'], mount);
    else if (optionalService(ctx, 'webServer') !== undefined) mount(ctx);
  } catch { /* ignore */ }

  try { ctx.provide?.('offpeakGuard', guard); } catch { /* optional */ }
  ctx.offpeakGuard = guard;

  const dispose = () => {
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
  };
  try {
    if (typeof ctx.effect === 'function') ctx.effect(() => dispose);
    else ctx.on?.('dispose', dispose);
  } catch { ctx.on?.('dispose', dispose); }
}

