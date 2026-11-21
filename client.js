window.__ModuleLoader__.load({
  id: 'dsh-offpeak-guard',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const API = '/offpeak-guard/api';
    const MARK = 'data-offpeak-btn';

    let state = null;
    let skew = 0;
    let busy = false;
    let button = null;
    let flash = null; // { text, until, good }

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

    // 一切显示都从这三个值推出来：谷/峰、等待开关、剩余时间。
    function view() {
      const phase = state && state.phase === 'peak' ? 'peak' : 'valley';
      const wait = !state || state.waitOffPeak !== false;
      const remain = state && typeof state.nextChangeAt === 'number' ? state.nextChangeAt - (Date.now() + skew) : 0;
      const paused = state && Array.isArray(state.paused) ? state.paused.length : 0;
      const left = fmt(remain);
      if (flash && Date.now() < flash.until) {
        return {
          phase: phase, wait: wait, remain: remain, paused: paused,
          label: flash.text,
          color: flash.good ? '#2f9e5f' : '#c0392b',
          edge: flash.good ? 'rgba(47,158,95,.55)' : 'rgba(192,57,43,.55)',
          background: 'transparent',
          title: '等待谷期【' + (wait ? '开' : '关') + '】' + (phase === 'peak' ? ' · 峰期' : ' · 谷期'),
        };
      }
      if (phase === 'peak' && wait) {
        return {
          phase: phase, wait: wait, remain: remain, paused: paused,
          label: '⏳ 等待中 ' + left,
          color: '#ffffff',
          edge: 'rgba(74,125,255,.9)',
          background: '#4a7dff',
          title: '等待谷期【开】· 峰期\n正在等待谷期，距谷期还有 ' + left + (paused > 0 ? '，已暂停 ' + paused + ' 个会话' : '')
            + '\n点击：关掉等待，并立即续跑已暂停的会话',
        };
      }
      if (phase === 'peak') {
        return {
          phase: phase, wait: wait, remain: remain, paused: paused,
          label: '⚡ 不等待 ' + left,
          color: 'var(--dsw-alias-label-tertiary, #888)',
          edge: 'rgba(127,127,127,.35)',
          background: 'transparent',
          title: '等待谷期【关】· 峰期\n峰期照常跑，按峰价计费，距谷期还有 ' + left
            + '\n点击：开启等待（峰期会立刻停掉正在跑的会话，谷期再自动续跑）',
        };
      }
      return {
        phase: phase, wait: wait, remain: remain, paused: paused,
        label: wait ? '🌙 等待·开' : '🌙 等待·关',
        color: wait ? '#2f9e5f' : 'var(--dsw-alias-label-tertiary, #888)',
        edge: wait ? 'rgba(47,158,95,.55)' : 'rgba(127,127,127,.35)',
        background: 'transparent',
        title: '等待谷期【' + (wait ? '开' : '关') + '】· 谷期\n距峰期还有 ' + left
          + (paused > 0 ? '，' + paused + ' 个会话等待续跑' : '')
          + '\n点击：' + (wait ? '关闭等待（谷期、峰期都照常跑）' : '开启等待（峰期会自动停）'),
      };
    }

    function paint() {
      if (!button) return;
      const next = view();
      if (button.textContent !== next.label) button.textContent = next.label;
      if (button.title !== next.title) button.title = next.title;
      if (button.style.color !== next.color) button.style.color = next.color;
      if (button.style.borderColor !== next.edge) button.style.borderColor = next.edge;
      const background = next.background;
      if (button.style.background !== background) button.style.background = background;
    }

    async function onClick(event) {
      event.preventDefault();
      event.stopPropagation();
      if (busy) return;
      busy = true;
      const wait = !state || state.waitOffPeak !== false;
      const phase = state && state.phase === 'peak' ? 'peak' : 'valley';
      paint();
      try {
        if (wait) {
          const after = await act('toggle', { waitOffPeak: false });
          setState(after);
          if (phase === 'peak') {
            const result = await act('resume-now', {});
            setState(result);
            setFlash('已继续 ' + (result && result.resumed ? result.resumed : 0) + ' 个', true);
          } else {
            setFlash('已关闭等待', false);
          }
        } else {
          const after = await act('toggle', { waitOffPeak: true });
          setState(after);
          setFlash('已开启等待', true);
        }
      } catch (error) {
        setFlash('操作失败', false);
      } finally {
        busy = false;
        paint();
      }
    }

    function createButton() {
      const node = document.createElement('button');
      node.type = 'button';
      node.setAttribute(MARK, '1');
      node.style.cssText = [
        'display:inline-flex', 'align-items:center', 'justify-content:center',
        'height:28px', 'min-width:36px', 'padding:0 8px', 'margin-right:6px',
        'font-size:12px', 'line-height:1', 'font-variant-numeric:tabular-nums',
        'border-radius:8px', 'border:1px solid rgba(127,127,127,.3)',
        'background:transparent', 'cursor:pointer', 'user-select:none',
        'white-space:nowrap', 'color:inherit', 'transition:background .15s, color .15s, border-color .15s',
      ].join(';');
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

    function ensure() {
      try {
        const host = locateHost();
        if (!host) return;
        const existing = host.querySelector('[' + MARK + ']');
        if (existing) { button = existing; return; }
        button = createButton();
        host.insertBefore(button, host.firstChild);
        paint();
      } catch (error) { /* ignore */ }
    }

    function apply(ctx) {
      const tick = function () { ensure(); paint(); };
      tick();
      setInterval(tick, 500);
      setInterval(refresh, 3000);
      refresh();
    }

    module.exports = { apply: apply, inject: [] };
    return module.exports;
  },
});

