import assert from 'node:assert';

let captured = null;
global.window = { __ModuleLoader__: { load(spec) { captured = spec; } } };

class El {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attrs = {};
    this.style = {};
    this.listeners = {};
    this.textContent = '';
    this.title = '';
  }
  setAttribute(key, value) { this.attrs[key] = value; }
  getAttribute(key) { return this.attrs[key]; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  appendChild(child) { this.children.push(child); return child; }
  insertBefore(child, ref) {
    const index = ref === undefined || ref === null ? -1 : this.children.indexOf(ref);
    if (index < 0) this.children.push(child); else this.children.splice(index, 0, child);
    return child;
  }
  get firstChild() { return this.children[0] ?? null; }
  querySelector(selector) {
    if (selector === '[data-offpeak-btn]') return this.children.find((c) => c.attrs['data-offpeak-btn'] === '1') ?? null;
    return null;
  }
  querySelectorAll(selector) {
    if (selector === '[class*="trailing"]') return this.classes.includes('_trailing') ? [this] : [];
    if (selector === 'button') return this.children.filter((c) => c.tagName === 'button');
    return [];
  }
}

class Seat extends El {
  constructor(group, sendButton) {
    super('div');
    this.group = group;
    this.sendButton = sendButton;
  }
  querySelectorAll(selector) {
    if (selector === '[class*="trailing"]') return [this.group];
    return super.querySelectorAll(selector);
  }
}

// —— 造一版和真实结构一致的 DOM：seat > card > controls > trailing[ 发送按钮 ] ——
const send = new El('button');
send.textContent = '发送';
const sibling = new El('button');           // 另一个已有按钮，验证不会被打乱
sibling.textContent = '附件';
const group = new El('div');
group.classes = ['uV2eYG_trailing'];
group.appendChild(sibling);
group.appendChild(send);
const seat = new Seat(group, send);
global.document = {
  createElement(tag) { return new El(tag); },
  querySelector(selector) { return selector === '[data-composer-seat]' ? seat : null; },
  head: new El('head'),
  getElementById() { return null; },
};

await import('../client.js');
assert.ok(captured, 'client 应该注册到 __ModuleLoader__');
const plugin = captured.factory(function () { return {}; });
assert.equal(typeof plugin.apply, 'function');
assert.ok(Array.isArray(plugin.inject) && plugin.inject.length === 0, '不再依赖 slots 服务');

plugin.apply({});
await new Promise((resolve) => setTimeout(resolve, 60));

const mine = group.children.filter((c) => c.attrs['data-offpeak-btn'] === '1');
assert.equal(mine.length, 1, '应该在 trailing 组里插入恰好一个按钮');
assert.equal(group.children[0], mine[0], '按钮要排在最前面（发送按钮左侧）');
assert.equal(group.children.length, 3, '原有按钮不能被移除');
assert.equal(group.children[1], sibling);
assert.equal(group.children[2], send);
assert.ok(mine[0].style.cssText.includes('inline-flex'), '按钮走行内 flex，不靠绝对定位，因此不会重合');
assert.equal(mine[0].getAttribute('data-offpeak-btn'), '1');
assert.equal(mine[0].title.includes('谷期') || mine[0].title.includes('峰期'), true, '按钮应带状态提示');
assert.ok(mine[0].listeners.click, '按钮要有点击处理');

// 再跑一次 ensure 不能重复插入
plugin.apply({});
await new Promise((resolve) => setTimeout(resolve, 60));
assert.equal(group.children.filter((c) => c.attrs['data-offpeak-btn'] === '1').length, 1, '重复调用不能插第二个');

console.log('ALL PASS dom mount');
process.exit(0);

