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
      state = data;
      if (typeof data.now === 'number') skew = data.now - Date.now();
    }

    function paint() {
      if (!button) return;
      const phase = state && state.phase === 'peak' ? 'peak' : 'valley';
      const wait = !state || state.waitOffPeak !== false;
      const remain = state && typeof state.nextChangeAt === 'number' ? state.nextChangeAt - (Date.now() + skew) : 0;
      const paused = state && Array.isArray(state.paused) ? state.paused.length : 0;
      let label = '🌙';
      let title = '谷期 · 便宜时段';
      if (phase === 'peak' && wait) {
        label = '⏳ ' + fmt(remain);
        title = '峰期 · 正在等待谷期，距谷期还有 ' + fmt(remain) + (paused > 0 ? '，已暂停 ' + paused + ' 个会话' : '') + '（点击立即继续）';
      } else if (phase === 'peak') {
        label = '⚡ ' + fmt(remain);
        title = '峰期 · 未等待（按峰价计费），距谷期还有 ' + fmt(remain) + '（点击开启等待谷期）';
      } else {
        title = '谷期 · 便宜时段，距峰期还有 ' + fmt(remain) + (paused > 0 ? '，' + paused + ' 个会话等待续跑' : '') + '（点击切换等待谷期）';
        const justResumed = state && state.lastResume && typeof state.lastResume.at === 'number' && Date.now() - state.lastResume.at < 120000;
        if (justResumed) title = '已自动续跑 ' + state.lastResume.count + ' 个会话 · ' + title;
      }
      if (button.textContent !== label) button.textContent = label;
      if (button.title !== title) button.title = title;
      const color = phase === 'peak' && wait ? '#4a7dff' : phase === 'peak' ? 'var(--dsw-alias-label-tertiary, #888)' : '#2f9e5f';
      if (button.style.color !== color) button.style.color = color;
      const edge = phase === 'peak' && wait ? 'rgba(74,125,255,.55)' : 'var(--dsw-alias-border-secondary, rgba(127,127,127,.3))';
      if (button.style.borderColor !== edge) button.style.borderColor = edge;
    }

    async function onClick(event) {
      event.preventDefault();
      event.stopPropagation();
      if (busy) return;
      busy = true;
      try {
        const phase = state && state.phase === 'peak' ? 'peak' : 'valley';
        const wait = !state || state.waitOffPeak !== false;
        if (phase === 'peak' && wait) await act('resume-now', {});
        else await act('toggle', { waitOffPeak: !wait });
      } catch (error) {
        /* 失败就保持原样，下次刷新再说 */
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
        'height:28px', 'min-width:34px', 'padding:0 8px', 'margin-right:6px',
        'font-size:12px', 'line-height:1', 'font-variant-numeric:tabular-nums',
        'border-radius:8px', 'border:1px solid rgba(127,127,127,.3)',
        'background:transparent', 'cursor:pointer', 'user-select:none',
        'white-space:nowrap', 'color:inherit',
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
        if (host.querySelector('[' + MARK + ']')) { button = host.querySelector('[' + MARK + ']'); return; }
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

