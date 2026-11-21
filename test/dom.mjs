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
  appendChild(c) { this.children.push(c); this.parentElement = this; c.parentElement = this; return c; }
  insertBefore(c, ref) {
    const i = ref == null ? -1 : this.children.indexOf(ref);
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    c.parentElement = this;
    return c;
  }
  get firstChild() { return this.children[0] ?? null; }
  contains(node) {
    if (node === this) return true;
    return this.children.some((child) => child.contains ? child.contains(node) : child === node);
  }
  querySelector(sel) {
    if (sel === '[data-offpeak-btn]') return this.children.find((c) => c.attrs['data-offpeak-btn'] === '1') ?? null;
    return null;
  }
  querySelectorAll(sel) {
    if (sel === '[class*="trailing"]') return this.children.filter((c) => c.classes && c.classes.some((name) => name.indexOf('trailing') >= 0));
    if (sel === 'button') return this.children.filter((c) => c.tagName === 'button');
    return [];
  }
}

const send = new El('button');
send.textContent = '发送';
const attach = new El('button');
attach.textContent = '附件';
const group = new El('div');
group.classes = ['uV2eYG_trailing'];
group.appendChild(attach);
group.appendChild(send);
const seat = new El('div');
seat.appendChild(group);
global.document = {
  createElement: (tag) => new El(tag),
  body: new El('body'),
  querySelector: (sel) => (sel === '[data-composer-seat]' ? seat : null),
};

await import('../client.js');
const plugin = captured.factory(function () { return {}; });
plugin.apply({});
plugin.apply({}); // 幂等

const mine = group.children.filter((c) => c.attrs['data-offpeak-btn'] === '1');
assert.equal(mine.length, 1, '只能插一个按钮');
const button = mine[0];
assert.equal(group.children[0], button, '按钮要排在 trailing 组最前面（发送按钮左侧）');
assert.equal(group.children.length, 3, '原有按钮不能动');
assert.equal(group.children[1], attach);
assert.equal(group.children[2], send);
assert.equal(button.children.length, 2, '按钮两行：开关状态 + 倒计时');
assert.equal(button.children[0].textContent, '等待谷期', '第一行写清是什么开关');
assert.ok(button.children[1].textContent.startsWith('开 '), '第二行是开关状态+倒计时: ' + button.children[1].textContent);
assert.ok(button.title.includes('等待谷期【开】'), 'tooltip 要说明当前开关');
assert.ok(button.title.includes('点击'), 'tooltip 要说明点击效果');
assert.ok(button.listeners.click, '要可点');

// React 把它删了以后要能自己补回来
group.children = group.children.filter((c) => c !== button);
button.parentElement = null;
await new Promise((resolve) => setTimeout(resolve, 500));
const back = group.children.filter((c) => c.attrs['data-offpeak-btn'] === '1');
assert.equal(back.length, 1, '被移除后应自动补回');
assert.equal(group.children[0], back[0], '补回时仍在最前面');

console.log('ALL PASS dom row');
process.exit(0);

