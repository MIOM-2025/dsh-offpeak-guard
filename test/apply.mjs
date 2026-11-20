import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { apply } from '../index.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offpeak-apply-'));
let route = null;
const cancelled = [];
const controller = {
  async cancel(request) { cancelled.push(request.sessionId); },
  async prompt() {},
};
const webServer = { register(spec) { route = spec; } };
const handlers = [];
const ctx = {
  on(event, fn) { handlers.push([event, fn]); },
  inject(deps, cb) {
    if (deps.includes('webServer')) return cb({ webServer });
    return cb({ sessionController: controller });
  },
  effect() {},
  logger: { info() {} },
};

apply(ctx, { dir, intervalMs: 60000 });
assert.ok(route, '应该注册了 /offpeak-guard/api');
assert.equal(route.path, '/offpeak-guard/api');
assert.ok(route.handler, '应该有 handler');

function fakeReq(method, url, body) {
  const listeners = {};
  return {
    method, url,
    on(event, fn) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
      return this;
    },
    end() {
      if (body !== undefined) (listeners.data || []).forEach((fn) => fn(Buffer.from(JSON.stringify(body))));
      (listeners.end || []).forEach((fn) => fn());
    },
  };
}

function fakeRes() {
  const state = { status: 0, body: '' };
  return {
    headersSent: false,
    writeHead(status) { state.status = status; this.headersSent = true; },
    end(text) { state.body = text; },
    result() { return { status: state.status, json: JSON.parse(state.body) }; },
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// GET 状态
const getRes = fakeRes();
route.handler(fakeReq('GET', '/offpeak-guard/api'), getRes);
const state = getRes.result();
assert.equal(state.status, 200);
assert.equal(state.json.waitOffPeak, true);
assert.ok(['peak', 'valley'].includes(state.json.phase));
assert.equal(typeof state.json.nextChangeAt, 'number');

// POST 关开关
const postRes = fakeRes();
const postReq = fakeReq('POST', '/offpeak-guard/api/toggle', { waitOffPeak: false });
route.handler(postReq, postRes);
postReq.end();
await wait(50);
const toggled = postRes.result();
assert.equal(toggled.status, 200);
assert.equal(toggled.json.waitOffPeak, false);
const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
assert.equal(onDisk.waitOffPeak, false);

// 未知动作
const badRes = fakeRes();
const badReq = fakeReq('POST', '/offpeak-guard/api/nope', {});
route.handler(badReq, badRes);
badReq.end();
await wait(20);
assert.equal(badRes.result().status, 400);

// turn/start 事件被订阅了
assert.ok(handlers.some(([event]) => event === 'session/event'));

console.log('ALL PASS apply()');

