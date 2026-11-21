window.__ModuleLoader__.load({
  id: 'dsh-offpeak-guard',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const API = '/offpeak-guard/api';
    const MARK = 'data-offpeak-btn';
    const FADE = 170;

    let state = null;
    let skew = 0;
    let busy = false;
    let button = null;
    let line1 = null;
    let line2 = null;
    let lastTitle = '';
    let started = false;
    let animating = false;
    let lastFix = 0;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function fmt(ms) {
      const total = Math.max(0, Math.round(ms / 1000));
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      const pad = function (n) { return n < 10 ? '0' + n : String(n); };
      return h > 0 ? pad(h) + ':' + pad(m) : pad(m) + ':' + pad(s);
    }

    async function refresh() {
      try {
        const response = await fetch(API, { headers: { accept: 'application/json' } });
        if (!response.ok) return;
        const next = await response.json();
        if (typeof next.now === 'number') skew = next.now - Date.now();
        state = next;
      } catch (error) { /* ignore */ }
    }

    async function act(action, body) {
      const response = await fetch(API + '/' + action, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const data = await response.json().catch(function () { return null; });
      if (!response.ok) throw new Error(data && data.error ? data.error : ('HTTP ' + response.status));
      if (data && typeof data.now === 'number') skew = data.now - Date.now();
      return data;
    }

    function setState(data) {
      if (data && (data.phase === 'peak' || data.phase === 'valley')) state = data;
    }

    function view() {
      const phase = state && state.phase === 'peak' ? 'peak' : 'valley';
      const wait = !state || state.waitOffPeak !== false;
      const remain = state && typeof state.nextChangeAt === 'number' ? state.nextChangeAt - (Date.now() + skew) : 0;
      const paused = state && Array.isArray(state.paused) ? state.paused.length : 0;
      const clock = fmt(remain);
      if (phase === 'peak' && wait) {
        return {
          top: '等待谷期 开',
          bottom: '峰期 ' + clock,
          color: '#ffffff',
          background: '#4a7dff',
          title: '等待谷期【开】\n峰期：正在等待，已暂停 ' + paused + ' 个会话\n距谷期还有 ' + clock + '\n点击：关闭等待，并立即续跑已暂停的会话',
        };
      }
      if (phase === 'peak') {
        return {
          top: '等待谷期 关',
          bottom: '峰期 ' + clock,
          color: 'var(--dsw-alias-label-secondary, #999)',
          background: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12))',
          title: '等待谷期【关】\n峰期：照常跑，按峰价计费\n距谷期还有 ' + clock + '\n点击：开启等待（峰期会立刻停掉正在跑的会话）',
        };
      }
      return {
        top: '等待谷期 ' + (wait ? '开' : '关'),
        bottom: '谷期 ' + clock,
        color: wait ? '#ffffff' : 'var(--dsw-alias-label-secondary, #999)',
        background: wait ? '#2f9e5f' : 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12))',
        title: '等待谷期【' + (wait ? '开' : '关') + '】\n谷期：便宜时段，距峰期 ' + clock
          + (paused > 0 ? '，' + paused + ' 个会话等待续跑' : '')
          + '\n点击：' + (wait ? '关闭等待（峰期谷期都照常跑）' : '开启等待（峰期自动停）'),
      };
    }

    // 只写字，不碰颜色/透明度（动画由 sequence 控制）
    function paintText() {
      if (!button) return;
      const next = view();
      if (line1 && line1.textContent !== next.top) line1.textContent = next.top;
      if (line2 && line2.textContent !== next.bottom) line2.textContent = next.bottom;
      if (lastTitle !== next.title) { button.title = next.title; lastTitle = next.title; }
      if (button.style.color !== next.color) button.style.color = next.color;
      if (button.style.background !== next.background) button.style.background = next.background;
    }

    function fadeTo(value) {
      if (!button) return sleep(FADE);
      button.style.opacity = String(value);
      return sleep(FADE);
    }

    // 点一下的过渡：先淡出旧文字 → 显示结果 → 停一会 → 淡出 → 显示新状态 → 淡入
    async function sequence(resultText) {
      animating = true;
      try {
        await fadeTo(0);
        if (line1) line1.textContent = resultText;
        if (line2) line2.textContent = '';
        await fadeTo(1);
        await sleep(900);
        await fadeTo(0);
        paintText();
        await fadeTo(1);
      } finally {
        animating = false;
        if (button) button.style.opacity = '1';
      }
    }

    async function onClick(event) {
      event.preventDefault();
      event.stopPropagation();
      if (busy) return;
      busy = true;
      let resultText = '失败';
      try {
        const wait = !state || state.waitOffPeak !== false;
        const phase = state && state.phase === 'peak' ? 'peak' : 'valley';
        if (wait) {
          setState(await act('toggle', { waitOffPeak: false }));
          if (phase === 'peak') {
            const result = await act('resume-now', {});
            setState(result);
            resultText = '已继续 ' + (result && result.resumed ? result.resumed : 0);
          } else {
            resultText = '已关闭';
          }
        } else {
          setState(await act('toggle', { waitOffPeak: true }));
          resultText = '已开启';
        }
      } catch (error) {
        resultText = '失败';
      }
      try {
        await sequence(resultText);
      } finally {
        busy = false;
      }
    }

    function createButton() {
      const node = document.createElement('button');
      node.type = 'button';
      node.setAttribute(MARK, '1');
      const s = node.style;
      s.display = 'inline-flex';
      s.flexDirection = 'column';
      s.alignItems = 'center';
      s.justifyContent = 'center';
      s.height = '30px';
      s.minWidth = '86px';
      s.padding = '0 8px';
      s.marginRight = '6px';
      s.boxSizing = 'border-box';
      s.borderRadius = '8px';
      s.border = '1px solid rgba(127,127,127,.28)';
      s.background = 'transparent';
      s.color = 'inherit';
      s.cursor = 'pointer';
      s.userSelect = 'none';
      s.whiteSpace = 'nowrap';
      s.fontVariantNumeric = 'tabular-nums';
      s.opacity = '1';
      s.transition = 'opacity .17s ease, background .15s ease, color .15s ease';

      const a = document.createElement('span');
      a.style.fontSize = '11px';
      a.style.lineHeight = '13px';
      a.style.fontWeight = '600';
      const b = document.createElement('span');
      b.style.fontSize = '10px';
      b.style.lineHeight = '12px';
      b.style.opacity = '0.85';
      node.appendChild(a);
      node.appendChild(b);
      line1 = a;
      line2 = b;
      node.addEventListener('click', onClick);
      return node;
    }

    function locateHost() {
      const seat = document.querySelector('[data-composer-seat]');
      if (!seat) return null;
      const groups = seat.querySelectorAll('[class*="trailing"]');
      if (groups.length > 0) return groups[groups.length - 1];
      const buttons = seat.querySelectorAll('button');
      if (buttons.length > 0) {
        const last = buttons[buttons.length - 1];
        if (last.parentElement) return last.parentElement;
      }
      return null;
    }

    function contains(host) {
      if (!host || !button) return false;
      if (typeof host.contains === 'function') return host.contains(button);
      return button.parentElement === host;
    }

    function ensure(force) {
      try {
        const host = locateHost();
        if (!host) return;
        if (contains(host)) return;
        const now = Date.now();
        if (force !== true && now - lastFix < 120) return;
        lastFix = now;
        if (!button) button = createButton();
        host.insertBefore(button, host.firstChild);
        paintText();
      } catch (error) { /* ignore */ }
    }

    function watch() {
      if (typeof MutationObserver === 'undefined') return;
      try {
        const observer = new MutationObserver(function () { ensure(false); });
        observer.observe(document.body, { childList: true, subtree: true });
      } catch (error) { /* ignore */ }
    }

    function apply(ctx) {
      if (started) return;
      started = true;
      button = createButton();
      ensure(true);
      watch();
      setInterval(function () {
        ensure(false);
        if (!animating) paintText();
      }, 400);
      setInterval(refresh, 3000);
      refresh();
    }

    module.exports = { apply: apply, inject: [] };
    return module.exports;
  },
});

