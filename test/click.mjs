import assert from 'node:assert';

let captured = null;
global.window = { __ModuleLoader__: { load(spec) { captured = spec; } } };

class El {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.attrs = {}; this.style = {};
    this.listeners = {}; this.textContent = ''; this.title = '';
    this.rect = { left: 900, top: 600, right: 960, bottom: 628, width: 60, height: 28 };
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, f) { this.listeners[t] = f; }
  appendChild(c) { this.children.push(c); return c; }
  getBoundingClientRect() { return this.rect; }
  querySelector(sel) {
    if (sel === '[data-offpeak-btn]') return this.children.find((c) => c.attrs['data-offpeak-btn'] === '1') ?? null;
    if (sel === 'button') return this.children.find((c) => c.tagName === 'button') ?? null;
    return null;
  }
  querySelectorAll(sel) {
    if (sel === 'button') return this.children.filter((c) => c.tagName === 'button');
    return [];
  }
}

const send = new El('button');
const seat = new El('div');
seat.appendChild(send);
const body = new El('body');
global.document = {
  createElement: (tag) => new El(tag),
  body: body,
  querySelector: (sel) => (sel === '[data-composer-seat]' ? seat : null),
};

const calls = [];
let toggleValue = null;
global.fetch = async function (url, init) {
  const method = init && init.method ? init.method : 'GET';
  calls.push(method + ' ' + url);
  const body2 = init && init.body ? JSON.parse(init.body) : null;
  if (method === 'GET') {
    return { ok: true, json: async () => ({ phase: 'peak', waitOffPeak: true, now: Date.now(), nextChangeAt: Date.now() + 3600000, paused: ['a', 'b'] }) };
  }
  if (url.endsWith('/toggle')) {
    toggleValue = body2.waitOffPeak;
    return { ok: true, json: async () => ({ phase: 'peak', waitOffPeak: body2.waitOffPeak, now: Date.now(), nextChangeAt: Date.now() + 3600000, paused: ['a', 'b'] }) };
  }
  if (url.endsWith('/resume-now')) {
    return { ok: true, json: async () => ({ phase: 'peak', waitOffPeak: false, resumed: 2, now: Date.now(), nextChangeAt: Date.now() + 3600000, paused: [] }) };
  }
  return { ok: true, json: async () => ({}) };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await import('../client.js');
const plugin = captured.factory(function () { return {}; });
plugin.apply({});
await sleep(400);

const layer = body.children.filter((c) => c.attrs['data-offpeak-btn'] === '1')[0];
const button = layer.children[0];
assert.ok(button.textContent.includes('等待'), '峰期开状态要写「等待」: ' + button.textContent);
assert.equal(button.style.background, '#4a7dff', '开状态实心蓝');

await button.listeners.click({ preventDefault() {}, stopPropagation() {} });
await sleep(150);
const posts = calls.filter((c) => c.startsWith('POST')).map((c) => c.split('/').pop());
assert.deepEqual(posts, ['toggle', 'resume-now'], '应先关开关再续跑: ' + posts.join(','));
assert.equal(toggleValue, false);
assert.ok(button.textContent.includes('已继续'), '要回显结果: ' + button.textContent);
assert.equal(layer.style.display, 'block', '浮层不能被自己藏起来');

// 关掉后再点：只开开关，不续跑
await sleep(2100);
assert.ok(button.textContent.includes('不等'), '关状态要写「不等」: ' + button.textContent);
calls.length = 0;
await button.listeners.click({ preventDefault() {}, stopPropagation() {} });
await sleep(150);
const posts2 = calls.filter((c) => c.startsWith('POST')).map((c) => c.split('/').pop());
assert.deepEqual(posts2, ['toggle'], '只切开关: ' + posts2.join(','));
assert.equal(toggleValue, true);
assert.ok(button.textContent.includes('已开启'), '要回显结果: ' + button.textContent);

console.log('ALL PASS click');
process.exit(0);

