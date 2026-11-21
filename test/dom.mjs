import assert from 'node:assert';

let captured = null;
global.window = { __ModuleLoader__: { load(spec) { captured = spec; } } };

class El {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.attrs = {}; this.style = {};
    this.listeners = {}; this.textContent = ''; this.title = '';
    this.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, f) { this.listeners[t] = f; }
  appendChild(c) { this.children.push(c); return c; }
  getBoundingClientRect() { return this.rect; }
  querySelector(sel) {
    if (sel === '[' + 'data-offpeak-btn' + ']') return this.children.find((c) => c.attrs['data-offpeak-btn'] === '1') ?? null;
    if (sel === 'button') return this.children.find((c) => c.tagName === 'button') ?? null;
    return null;
  }
  querySelectorAll(sel) {
    if (sel === 'button') return this.children.filter((c) => c.tagName === 'button');
    return [];
  }
}

const send = new El('button');
send.textContent = '发送';
send.rect = { left: 900, top: 600, right: 960, bottom: 628, width: 60, height: 28 };
const seat = new El('div');
seat.appendChild(send);
const body = new El('body');
global.document = {
  createElement: (tag) => new El(tag),
  body: body,
  querySelector: (sel) => (sel === '[data-composer-seat]' ? seat : null),
};

await import('../client.js');
const plugin = captured.factory(function () { return {}; });
assert.equal(typeof plugin.apply, 'function');

plugin.apply({});
plugin.apply({}); // 第二次必须幂等

const layers = body.children.filter((c) => c.attrs['data-offpeak-btn'] === '1');
assert.equal(layers.length, 1, '只能有一个浮层');
const layer = layers[0];
assert.equal(layer.style.position, 'fixed', '必须是脱离 React 的 fixed 浮层');
assert.equal(layer.style.display, 'block');
assert.equal(layer.children.length, 1, '浮层里只有一个按钮');
const button = layer.children[0];
assert.equal(button.style.width, '92px', '宽度固定，倒计时变长也不会抖');
assert.ok(button.listeners.click, '按钮要可点');
assert.ok(button.textContent.length > 0, '按钮要有文字');

const left = parseInt(layer.style.left, 10);
const top = parseInt(layer.style.top, 10);
assert.equal(left, 900 - 92 - 6, '应贴在发送按钮左边');
assert.equal(top, 600, '与发送按钮垂直居中对齐');
assert.ok(left + 92 + 6 <= 900, '不能和发送按钮重叠');

// 窄屏：左边放不下就挪到发送按钮上方
send.rect = { left: 40, top: 600, right: 100, bottom: 628, width: 60, height: 28 };
const plugin2 = captured.factory(function () { return {}; });
plugin2.apply({});
await new Promise((r) => setTimeout(r, 350));
const layer2 = body.children.filter((c) => c.attrs['data-offpeak-btn'] === '1')[0];
assert.equal(parseInt(layer2.style.top, 10), 600 - 28 - 6, '挤不下时改放上方');
assert.equal(parseInt(layer2.style.left, 10), 100 - 92, '上方版本右对齐发送按钮');

console.log('ALL PASS dom overlay');
process.exit(0);

