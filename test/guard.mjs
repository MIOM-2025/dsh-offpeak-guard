import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { Guard, isPeakAt } from '../index.js';

const bj = (y, m, d, h, min) => Date.UTC(y, m - 1, d, h, min || 0, 0) - 8 * 3600 * 1000;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'offpeak-'));
let failures = 0;
const check = async (label, fn) => {
  try { await fn(); console.log('PASS ' + label); }
  catch (error) { failures += 1; console.log('FAIL ' + label + ' -> ' + String(error && error.message ? error.message : error)); }
};

function fakeController() {
  return {
    cancelled: [], prompts: [],
    async cancel(request) { this.cancelled.push(request.sessionId); },
    async prompt(request) { this.prompts.push(request); },
  };
}

await check('峰期判定：工作日高峰 / 早间 / 周末 / 节假日', async () => {
  assert.equal(isPeakAt(bj(2026, 11, 16, 10)), true);   // 周一 10:00
  assert.equal(isPeakAt(bj(2026, 11, 16, 15)), true);   // 周一 15:00
  assert.equal(isPeakAt(bj(2026, 11, 16, 8)), false);   // 周一 08:00
  assert.equal(isPeakAt(bj(2026, 11, 16, 13)), false);  // 午休
  assert.equal(isPeakAt(bj(2026, 11, 21, 10)), false);  // 周六
  assert.equal(isPeakAt(bj(2026, 11, 22, 15)), false);  // 周日
  assert.equal(isPeakAt(bj(2026, 10, 1, 10)), false);   // 国庆
});

await check('峰期 tick：停掉正在跑的会话并登记暂停', async () => {
  const guard = new Guard({ dir: tmp() });
  const controller = fakeController();
  guard.live.add('session-a');
  guard.live.add('session-b');
  const result = await guard.tick(controller, bj(2026, 11, 16, 10));
  assert.equal(result.stopped, 2);
  assert.deepEqual(controller.cancelled.sort(), ['session-a', 'session-b']);
  assert.deepEqual(Object.keys(guard.paused).sort(), ['session-a', 'session-b']);
});

await check('谷期 tick：自动续跑并清空暂停清单', async () => {
  const guard = new Guard({ dir: tmp() });
  const controller = fakeController();
  guard.pause('session-a', null);
  guard.pause('session-b', null);
  const result = await guard.tick(controller, bj(2026, 11, 16, 20));
  assert.equal(result.resumed, 2);
  assert.equal(controller.prompts.length, 2);
  assert.equal(controller.prompts[0].mode, 'queue');
  assert.match(controller.prompts[0].content[0].text, /谷期/);
  assert.deepEqual(guard.paused, {});
  assert.ok(guard.lastResume && guard.lastResume.count === 2);
});

await check('关掉等待谷期后，峰期不再停会话', async () => {
  const guard = new Guard({ dir: tmp() });
  const controller = fakeController();
  guard.setWait(false);
  guard.live.add('session-a');
  const result = await guard.tick(controller, bj(2026, 11, 16, 10));
  assert.equal(controller.cancelled.length, 0);
  assert.equal(result.stopped, undefined);
});

await check('点「立即继续」后，峰期不会马上又停掉', async () => {
  const guard = new Guard({ dir: tmp() });
  const controller = fakeController();
  guard.pause('session-a', null);
  guard.forceAll();
  guard.live.add('session-a');
  await guard.tick(controller, bj(2026, 11, 16, 10));
  assert.equal(controller.cancelled.length, 0);
});

await check('状态快照带阶段、切换点和倒计时依据', async () => {
  const guard = new Guard({ dir: tmp() });
  const snapshot = guard.snapshot(bj(2026, 11, 16, 10));
  assert.equal(snapshot.phase, 'peak');
  assert.equal(snapshot.waitOffPeak, true);
  assert.equal(snapshot.nextChangeAt, bj(2026, 11, 16, 12)); // 午休 12:00 转谷
  assert.equal(snapshot.now, bj(2026, 11, 16, 10));
});

await check('开关落盘，重启后还在', async () => {
  const dir = tmp();
  const first = new Guard({ dir });
  first.setWait(false);
  const second = new Guard({ dir });
  assert.equal(second.waitOffPeak, false);
});

console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILED');
process.exit(failures === 0 ? 0 : 1);

