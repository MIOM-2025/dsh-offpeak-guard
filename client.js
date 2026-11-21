window.__ModuleLoader__.load({
  id: 'dsh-offpeak-guard',
  factory: (require) => {
    // 桌面端/多页面可能重复加载同一个 client 插件，这里只认第一份，避免两个浮层互相打架
    if (window.__dshOffpeakGuardLoaded) return { apply: function () {}, inject: [] };
    window.__dshOffpeakGuardLoaded = true;
    var module = { exports: {} };
    var exports = module.exports;
    const API = '/offpeak-guard/api';
    const MARK = 'data-offpeak-btn';
    const W = 92;
    const H = 28;

    let state = null;
    let skew = 0;
    let busy = false;
    let layer = null;
    let button = null;
    let flash = null;
    let lastTitle = '';
    let started = false;

    function fmt(ms) {
      const total = Math.max(0, Math.round(ms / 1000));
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      const pad = function (n) { return n < 10 ? '0' + n : String(n); };
      if (h > 0) return h + 'h' + pad(m) + 'm';
      if (m > 0) return m + 'm' + pad(s) + 's';
      return s + 's';
    }

    async function refresh() {
      try {
        const response = await fetch(API, { headers: { accept: 'application/json' } });
        if (!response.ok) return;
        const next = await response.json();
        if (typeof next.now === 'number') skew = next.now - Date.now();
        state = next;
      } catch (error) { /* 网络抖一下就算了 */ }
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

    function setFlash(text, good) {
      flash = { text: text, until: Date.now() + 1800, good: good === true };
    }

    function view() {
      const phase = state && state.phase === 'peak' ? 'peak' : 'valley';
      const wait = !state || state.waitOffPeak !== false;
      const remain = state && typeof state.nextChangeAt === 'number' ? state.nextChangeAt - (Date.now() + skew) : 0;
      const paused = state && Array.isArray(state.paused) ? state.paused.length : 0;
      const left = fmt(remain);
      if (flash && Date.now() < flash.until) {
        return {
          label: flash.text,
          color: flash.good ? 'var(--dsw-alias-label-inverse, #fff)' : 'var(--dsw-alias-label-inverse, #fff)',
          background: flash.good ? '#2f9e5f' : '#c0392b',
          edge: 'transparent',
          title: '等待谷期【' + (wait ? '开' : '关') + '】' + (phase === 'peak' ? ' · 峰期' : ' · 谷期'),
        };
      }
      if (phase === 'peak' && wait) {
        return {
          label: '⏳ 等待 ' + left,
          color: '#ffffff',
          background: '#4a7dff',
          edge: 'transparent',
          title: '等待谷期【开】· 峰期：正在等待谷期，已暂停 ' + paused + ' 个会话。点击＝关掉等待并立即续跑',
        };
      }
      if (phase === 'peak') {
        return {
          label: '⚡ 不等 ' + left,
          color: 'var(--dsw-alias-label-tertiary, #888)',
          background: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12))',
          edge: 'rgba(127,127,127,.3)',
          title: '等待谷期【关】· 峰期：照常跑、按峰价计费。点击＝开启等待（峰期会立刻停）',
        };
      }
      return {
        label: wait ? '🌙 开 ' + left : '🌙 关 ' + left,
        color: wait ? 'var(--dsw-alias-label-inverse, #fff)' : 'var(--dsw-alias-label-tertiary, #888)',
        background: wait ? '#2f9e5f' : 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12))',
        edge: wait ? 'transparent' : 'rgba(127,127,127,.3)',
        title: '等待谷期【' + (wait ? '开' : '关') + '】· 谷期：距峰期 ' + left + '。点击＝' + (wait ? '关闭等待' : '开启等待'),
      };
    }

    function paint() {
      if (!button) return;
      const next = view();
      if (button.textContent !== next.label) button.textContent = next.label;
      if (lastTitle !== next.title) { button.title = next.title; lastTitle = next.title; }
      if (button.style.color !== next.color) button.style.color = next.color;
      if (button.style.background !== next.background) button.style.background = next.background;
      if (button.style.borderColor !== next.edge) button.style.borderColor = next.edge;
    }

    async function onClick(event) {
      event.preventDefault();
      event.stopPropagation();
      if (busy) return;
      busy = true;
      const wait = !state || state.waitOffPeak !== false;
      const phase = state && state.phase === 'peak' ? 'peak' : 'valley';
      try {
        if (wait) {
          setState(await act('toggle', { waitOffPeak: false }));
          if (phase === 'peak') {
            const result = await act('resume-now', {});
            setState(result);
            setFlash('已继续 ' + (result && result.resumed ? result.resumed : 0) + ' 个', true);
          } else {
            setFlash('已关闭等待', false);
          }
        } else {
          setState(await act('toggle', { waitOffPeak: true }));
          setFlash('已开启等待', true);
        }
      } catch (error) {
        setFlash('操作失败', false);
      } finally {
        busy = false;
        paint();
      }
    }

    // 独立浮层：挂在 body 上、fixed 定位，React 重渲染碰不到它，所以不会闪。
    function ensureLayer() {
      if (layer) return layer;
      layer = document.createElement('div');
      layer.setAttribute(MARK, '1');
      layer.style.position = 'fixed';
      layer.style.zIndex = '60';
      layer.style.display = 'none';
      layer.style.pointerEvents = 'auto';
      button = document.createElement('button');
      button.type = 'button';
      const s = button.style;
      s.display = 'block';
      s.width = W + 'px';
      s.height = H + 'px';
      s.padding = '0';
      s.boxSizing = 'border-box';
      s.overflow = 'hidden';
      s.textOverflow = 'ellipsis';
      s.whiteSpace = 'nowrap';
      s.fontSize = '12px';
      s.lineHeight = H + 'px';
      s.textAlign = 'center';
      s.fontVariantNumeric = 'tabular-nums';
      s.borderRadius = '8px';
      s.border = '1px solid rgba(127,127,127,.3)';
      s.background = 'transparent';
      s.color = 'inherit';
      s.cursor = 'pointer';
      s.userSelect = 'none';
      s.transition = 'background .15s,color .15s';
      button.addEventListener('click', onClick);
      layer.appendChild(button);
      document.body.appendChild(layer);
      return layer;
    }
    function place() {
      const seat = document.querySelector('[data-composer-seat]');
      if (!seat) { if (layer) layer.style.display = 'none'; return; }
      const all = Array.prototype.slice.call(seat.querySelectorAll('button'));
      if (all.length === 0) { if (layer) layer.style.display = 'none'; return; }
      const anchor = all[all.length - 1];
      const rect = anchor.getBoundingClientRect();
      const lefts = all.map(function (node) { return node.getBoundingClientRect().left; });
      const minLeft = Math.min.apply(null, lefts);
      let left = minLeft - W - 6;
      let top = rect.top + (rect.height - H) / 2;
      if (left < 4) {
        left = Math.max(4, rect.right - W);
        top = rect.top - H - 6;
      }
      layer.style.left = Math.round(left) + 'px';
      layer.style.top = Math.round(top) + 'px';
      layer.style.display = 'block';
    }

    function apply(ctx) {
      if (started) return;
      started = true;
      try { ensureLayer(); } catch (error) { return; }
      const tick = function () { place(); paint(); };
      tick();
      setInterval(tick, 300);
      setInterval(refresh, 3000);
      refresh();
    }

    module.exports = { apply: apply, inject: [] };
    return module.exports;
  },
});

