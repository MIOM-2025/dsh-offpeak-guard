window.__ModuleLoader__.load({
  id: 'dsh-offpeak-guard',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react');
    const { useState, useEffect, useRef } = React;
    const API = '/offpeak-guard/api';

    function ensureStyle() {
      try {
        if (typeof document === 'undefined') return;
        if (document.getElementById('offpeak-guard-style')) return;
        const style = document.createElement('style');
        style.id = 'offpeak-guard-style';
        style.textContent = '@keyframes offpeak-spin{to{transform:rotate(360deg)}}';
        document.head.appendChild(style);
      } catch (error) { /* ignore */ }
    }

    async function getState() {
      const response = await fetch(API, { headers: { accept: 'application/json' } });
      return response.json();
    }

    async function act(action, body) {
      const response = await fetch(API + '/' + action, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status));
      return data;
    }

    function clock(ms) {
      const total = Math.max(0, Math.round(ms / 1000));
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      const pad = function (n) { return n < 10 ? '0' + n : String(n); };
      return h > 0 ? h + ' 小时 ' + pad(m) + ' 分' : pad(m) + ':' + pad(s);
    }

    const ui = {
      bar: {
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        fontSize: 12, padding: '6px 10px', borderRadius: 8, marginBottom: 6,
        border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.3))',
        background: 'var(--dsw-alias-bg-secondary, rgba(127,127,127,.08))',
        color: 'var(--dsw-alias-label-primary)',
      },
      spin: {
        display: 'inline-block', width: 12, height: 12, borderRadius: '50%',
        border: '2px solid rgba(127,127,127,.35)', borderTopColor: '#4a7dff',
        animation: 'offpeak-spin 1s linear infinite',
      },
      button: {
        fontSize: 12, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.35))',
        background: 'transparent', color: 'inherit',
      },
      primary: {
        fontSize: 12, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-accent, #4a7dff)',
        background: 'rgba(74,125,255,.14)', color: 'inherit',
      },
      muted: { color: 'var(--dsw-alias-label-tertiary)' },
      on: { color: '#2f9e5f' },
      off: { color: 'var(--dsw-alias-label-tertiary)' },
    };

    function Dock() {
      const [state, setState] = useState(null);
      const [now, setNow] = useState(Date.now());
      const [busy, setBusy] = useState(false);
      const [note, setNote] = useState('');
      const skew = useRef(0);

      useEffect(ensureStyle, []);

      useEffect(function () {
        let alive = true;
        const load = async function () {
          try {
            const next = await getState();
            if (!alive) return;
            if (typeof next.now === 'number') skew.current = next.now - Date.now();
            setState(next);
          } catch (error) { /* 网络抖一下就算了 */ }
        };
        load();
        const timer = setInterval(load, 3000);
        const beat = setInterval(function () { setNow(Date.now()); }, 1000);
        return function () { alive = false; clearInterval(timer); clearInterval(beat); };
      }, []);

      if (!state) return null;
      const phase = state.phase === 'peak' ? 'peak' : 'valley';
      const remain = typeof state.nextChangeAt === 'number' ? state.nextChangeAt - (now + skew.current) : 0;
      const pausedCount = Array.isArray(state.paused) ? state.paused.length : 0;

      const run = async function (action, body) {
        setBusy(true);
        try {
          const next = await act(action, body);
          if (typeof next.now === 'number') skew.current = next.now - Date.now();
          setState(next);
          setNote('');
        } catch (error) {
          setNote(String(error && error.message ? error.message : error));
        } finally {
          setBusy(false);
        }
      };

      const toggle = function () { run('toggle', { waitOffPeak: !state.waitOffPeak }); };
      const resumeNow = function () { run('resume-now', {}); };

      const justResumed = state.lastResume && typeof state.lastResume.at === 'number' && Date.now() - state.lastResume.at < 180000;

      if (phase === 'peak' && state.waitOffPeak) {
        return React.createElement('div', { style: ui.bar },
          React.createElement('span', { style: ui.spin }),
          React.createElement('span', null, '峰期 · 正在等待谷期'),
          React.createElement('span', { style: ui.muted }, '距谷期还有 ' + clock(remain)),
          pausedCount > 0 ? React.createElement('span', { style: ui.muted }, '· 已暂停 ' + pausedCount + ' 个会话') : null,
          React.createElement('span', { style: { flex: 1 } }),
          React.createElement('button', { style: ui.primary, disabled: busy, onClick: resumeNow }, busy ? '处理中…' : '立即继续'),
          React.createElement('button', { style: ui.button, disabled: busy, onClick: toggle }, '等待谷期：开'),
          note ? React.createElement('span', { style: ui.muted }, note) : null
        );
      }

      if (phase === 'peak') {
        return React.createElement('div', { style: ui.bar },
          React.createElement('span', null, '峰期 · 未等待（按峰价计费）'),
          React.createElement('span', { style: ui.muted }, '距谷期还有 ' + clock(remain)),
          React.createElement('span', { style: { flex: 1 } }),
          React.createElement('button', { style: ui.button, disabled: busy, onClick: toggle }, '等待谷期：关'),
          note ? React.createElement('span', { style: ui.muted }, note) : null
        );
      }

      return React.createElement('div', { style: ui.bar },
        React.createElement('span', { style: ui.on }, '谷期 · 便宜时段'),
        React.createElement('span', { style: ui.muted }, '距峰期还有 ' + clock(remain)),
        pausedCount > 0 ? React.createElement('span', { style: ui.muted }, '· ' + pausedCount + ' 个会话等待续跑') : null,
        justResumed ? React.createElement('span', { style: ui.on }, '· 已自动续跑 ' + state.lastResume.count + ' 个会话') : null,
        React.createElement('span', { style: { flex: 1 } }),
        React.createElement('button', { style: ui.button, disabled: busy, onClick: toggle }, state.waitOffPeak ? '等待谷期：开' : '等待谷期：关'),
        note ? React.createElement('span', { style: ui.muted }, note) : null
      );
    }

    function apply(ctx) {
      ctx.slots.inject('conversation.composer.dock', function () {
        return ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'dsh-offpeak-guard',
          order: 40,
        }, Dock);
      });
    }

    module.exports = { apply: apply, inject: ['slots'] };
    return module.exports;
  },
});

