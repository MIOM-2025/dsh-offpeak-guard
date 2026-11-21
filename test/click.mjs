import assert from 'node:assert';

let captured = null;
global.window = { __ModuleLoader__: { load(spec) { captured = spec; } } };

class El {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.attrs = {}; this.style = {};
    this.listeners = {}; this.textContent = ''; this.title = '';
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, f) { this.listeners[t] = f; }
  appendChild(c) { this.children.push(c); c.parentElement = this; return c; }
  insertBefore(c, ref) {
    const i = ref == null ? -1 : this.children.indexOf(ref);
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    c.parentElement = this;
    return c;
  }
  get firstChild() { return this.children[0] ?? null; }
  contains(node) {
    if (node === this) return true;
    return this.children.some((child) => (child.contains ? child.contains(node) : child === node));
  }
  querySelector(sel) {
    if (sel === '[data-offpeak-btn]') return this.children.find((c) => c.attrs['data-offpeak-btn'] === '1') ?? null;
    return null;
  }
  querySelectorAll(sel) {
    if (sel === '[class*="trailing"]') return this.children.filter((c) => c.classes && c.classes.some((n) => n.indexOf('trailing') >= 0));
    if (sel === 'button') return this.children.filter((c) => c.tagName === 'button');
    return [];
  }
}

const send = new El('button');
const group = new El('div');
group.classes = ['uV2eYG_trailing'];
group.appendChild(send);
const seat = new El('div');
seat.appendChild(group);
global.document = {
  createElement: (tag) => new El(tag),
  body: new El('body'),
  querySelector: (sel) => (sel === '[data-composer-seat]' ? seat : null),
};

const calls = [];
let toggleValue = null;
global.fetch = async function (url, init) {
  const method = init && init.method ? init.method : 'GET';
  calls.push(method + ' ' + url);
  const payload = init && init.body ? JSON.parse(init.body) : null;
  if (method === 'GET') {
    return { ok: true, json: async () => ({ phase: 'peak', waitOffPeak: true, now: Date.now(), nextChangeAt: Date.now() + 3600000, paused: ['a'] }) };
  }
  if (url.endsWith('/toggle')) {
    toggleValue = payload.waitOffPeak;
    return { ok: true, json: async () => ({ phase: 'peak', waitOffPeak: payload.waitOffPeak, now: Date.now(), nextChangeAt: Date.now() + 3600000, paused: [] }) };
  }
  return { ok: true, json: async () => ({ phase: 'peak', waitOffPeak: false, resumed: 2, now: Date.now(), nextChangeAt: Date.now() + 3600000, paused: [] }) };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await import('../client.js');
const plugin = captured.factory(function () { return {}; });
plugin.apply({});
await sleep(500);

const button = group.children.find((c) => c.attrs['data-offpeak-btn'] === '1');
assert.ok(button, '按钮要挂上');
assert.equal(button.children[0].textContent, '等待谷期 开', '初始第一行: ' + button.children[0].textContent);
assert.ok(button.children[1].textContent.startsWith('峰期'), '第二行是阶段+倒计时: ' + button.children[1].textContent);
assert.equal(button.style.opacity, '1');

// 第一次点击：淡出 -> 已继续 2 -> 淡出 -> 等待谷期 关
button.listeners.click({ preventDefault() {}, stopPropagation() {} });
await sleep(60);
assert.equal(button.style.opacity, '0', '点击后先淡出（隐藏过渡）');
await sleep(320);
assert.ok(button.children[0].textContent.includes('已继续'), '淡出后显示结果: ' + button.children[0].textContent);
await sleep(1300);
assert.equal(button.children[0].textContent, '等待谷期 关', '结果淡出后显示新状态: ' + button.children[0].textContent);
assert.equal(button.style.opacity, '1', '最后淡回可见');

const posts = calls.filter((c) => c.startsWith('POST')).map((c) => c.split('/').pop());
assert.deepEqual(posts, ['toggle', 'resume-now'], '先关开关再续跑: ' + posts.join(','));
assert.equal(toggleValue, false);

// 第二次点击：同样的过渡，关 -> 已开启 -> 开
calls.length = 0;
button.listeners.click({ preventDefault() {}, stopPropagation() {} });
await sleep(60);
assert.equal(button.style.opacity, '0', '第二次点击同样先淡出');
await sleep(320);
assert.ok(button.children[0].textContent.includes('已开启'), '显示已开启: ' + button.children[0].textContent);
await sleep(1300);
assert.equal(button.children[0].textContent, '等待谷期 开', '最后回到等待谷期 开');
const posts2 = calls.filter((c) => c.startsWith('POST')).map((c) => c.split('/').pop());
assert.deepEqual(posts2, ['toggle'], '只切开关: ' + posts2.join(','));
assert.equal(toggleValue, true);

console.log('ALL PASS click');
process.exit(0);

