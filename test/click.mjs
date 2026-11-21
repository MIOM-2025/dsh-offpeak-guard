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
  appendChild(c) { this.children.push(c); return c; }
  insertBefore(c, ref) {
    const i = ref == null ? -1 : this.children.indexOf(ref);
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    return c;
  }
  querySelector(sel) {
    if (sel === '[data-offpeak-btn]') return this.children.find((c) => c.attrs['data-offpeak-btn'] === '1') ?? null;
    return null;
  }
  querySelectorAll(sel) {
    if (sel === '[class*="trailing"]') return this.classes.includes('_trailing') ? [this] : [];
    if (sel === 'button') return this.children.filter((c) => c.tagName === 'button');
    return [];
  }
}

function buildDom() {
  const group = new El('div');
  group.classes = ['uV2eYG_trailing'];
  const send = new El('button');
  group.appendChild(send);
  const seat = new El('div');
  seat.querySelectorAll = function (sel) {
    if (sel === '[class*="trailing"]') return [group];
    return El.prototype.querySelectorAll.call(this, sel);
  };
  global.document = {
    createElement: (tag) => new El(tag),
    querySelector: (sel) => (sel === '[data-composer-seat]' ? seat : null),
  };
  return { group: group, send: send };
}

const calls = [];
let toggleValue = null;
function mockFetch(mode) {
  calls.length = 0;
  global.fetch = async function (url, init) {
    const method = init && init.method ? init.method : 'GET';
    calls.push(method + ' ' + url);
    const body = init && init.body ? JSON.parse(init.body) : null;
    if (mode === 'peak-waiting') {
      if (method === 'GET') {
        return { ok: true, json: async () => ({ phase: 'peak', waitOffPeak: true, now: Date.now(), nextChangeAt: Date.now() + 3600000, paused: ['a', 'b'] }) };
      }
      if (url.endsWith('/toggle')) {
        toggleValue = body.waitOffPeak;
        return { ok: true, json: async () => ({ phase: 'peak', waitOffPeak: body.waitOffPeak, now: Date.now(), nextChangeAt: Date.now() + 3600000, paused: ['a', 'b'] }) };
      }
      if (url.endsWith('/resume-now')) {
        return { ok: true, json: async () => ({ phase: 'peak', waitOffPeak: false, resumed: 2, now: Date.now(), nextChangeAt: Date.now() + 3600000, paused: [] }) };
      }
    }
    if (mode === 'peak-off') {
      if (method === 'GET') {
        return { ok: true, json: async () => ({ phase: 'peak', waitOffPeak: false, now: Date.now(), nextChangeAt: Date.now() + 3600000, paused: [] }) };
      }
      if (url.endsWith('/toggle')) {
        return { ok: true, json: async () => ({ phase: 'peak', waitOffPeak: body.waitOffPeak, now: Date.now(), nextChangeAt: Date.now() + 3600000, paused: [] }) };
      }
    }
    return { ok: true, json: async () => ({}) };
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await import('../client.js');
const plugin = captured.factory(function () { return {}; });

// 场景一：峰期、等待开着 -> 点一下应该「关掉等待 + 立即续跑」
mockFetch('peak-waiting');
const first = buildDom();
plugin.apply({});
await sleep(700);
const button = first.group.querySelector('[data-offpeak-btn]');
assert.ok(button, '按钮应该挂上');
assert.ok(button.textContent.includes('等待中'), '开状态下按钮要写「等待中」: ' + button.textContent);
assert.ok(button.title.includes('点击：关掉等待'), 'tooltip 要说明点击效果');
assert.ok(button.style.background === '#4a7dff', '开状态要实心高亮');

await button.listeners.click({ preventDefault() {}, stopPropagation() {} });
await sleep(120);
const posts = calls.filter((c) => c.startsWith('POST'));
assert.deepEqual(posts.map((c) => c.split('/').pop()), ['toggle', 'resume-now'], '应该先关开关再续跑: ' + posts.join(','));
assert.equal(toggleValue, false);
assert.ok(button.textContent.includes('已继续'), '点击后要回显结果: ' + button.textContent);


// 场景二：同一页面上把等待关掉之后，再点一下只应该开开关，不续跑
await sleep(2100); // 等回显文字过期
assert.ok(button.textContent.includes('不等待'), '关状态下要写「不等待」: ' + button.textContent);
assert.equal(button.style.background, 'transparent');
calls.length = 0;
await button.listeners.click({ preventDefault() {}, stopPropagation() {} });
await sleep(150);
const posts2 = calls.filter((c) => c.startsWith('POST'));
assert.deepEqual(posts2.map((c) => c.split('/').pop()), ['toggle'], '只应该切开关: ' + posts2.join(','));
assert.equal(toggleValue, true);
assert.ok(button.textContent.includes('已开启'), '点击后要回显结果: ' + button.textContent);

console.log('ALL PASS click');
process.exit(0);