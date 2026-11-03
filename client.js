window.__ModuleLoader__.load({
  id: 'dsh-tool-todo-ledger',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const namespace = 'todo-ledger';
    const locale = 'todoLedger';

    const en = {
      title: 'Review todo plans with AGENTS.md',
      description: 'Before each todo_write plan change, an independent model reviews the plan against the active project instructions. Violations are reported without blocking the change.',
      failed: 'Could not save preference',
      todoTitle: 'Tasks',
      done: '{done} done',
      active: '{active} active',
      pending: '{pending} pending',
      statusCompleted: 'Completed',
      statusActive: 'In progress',
      statusPending: 'Pending',
      currentIssue: 'Current issue',
      jumpToStart: 'Jump to the step that started this task',
      jumpFailed: 'Could not locate the step that started this task',
    };
    const zh = {
      title: '使用 AGENTS.md 审查任务规划',
      description: '每次 todo_write 修改规划前，由独立模型依据当前生效的项目指令进行审查。发现违例会明确提示，但不会阻塞修改。',
      failed: '无法保存设置',
      todoTitle: '任务',
      done: '已完成 {done}',
      active: '进行中 {active}',
      pending: '待办 {pending}',
      statusCompleted: '已完成',
      statusActive: '进行中',
      statusPending: '待办',
      currentIssue: '当前 issue',
      jumpToStart: '跳转到开始此任务的步骤',
      jumpFailed: '无法定位开始此任务的步骤',
    };

    const css = `
      .todo-ledger-setting{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
      .todo-ledger-setting__title{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary)}
      .todo-ledger-setting__description{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
      .todo-ledger-setting__error{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
      .todo-ledger-setting__switch{position:relative;flex:0 0 auto;width:32px;height:18px;padding:0;border:0;border-radius:9px;background:var(--dsw-alias-state-idle-primary);cursor:pointer}
      .todo-ledger-setting__switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
      .todo-ledger-setting__switch:disabled{cursor:default;opacity:.5}
      .todo-ledger-setting__knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .15s ease}
      .todo-ledger-setting__switch[aria-checked="true"] .todo-ledger-setting__knob{transform:translateX(14px)}
      .todo-ledger-setting__switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
      .todo-ledger-dock{box-sizing:border-box;flex:none;overflow:hidden;margin:0 auto;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));border:0;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-panel);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
      .todo-ledger-dock__body{display:flex;flex-direction:column;gap:8px;padding:6px 12px}
      .todo-ledger-dock__header{display:flex;align-items:center;gap:10px;width:100%;padding:0;border:none;background:transparent;text-align:left;cursor:pointer}
      .todo-ledger-dock__lead,.todo-ledger-dock__chevron{display:grid;flex:none;place-items:center;color:var(--dsw-alias-label-tertiary)}
      .todo-ledger-dock__title{flex:none;font-size:13px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}
      .todo-ledger-dock__progress{flex:1 1 auto;min-width:0;overflow:hidden;font-size:13px;line-height:20px;font-weight:400;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap}
      .todo-ledger-dock__list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;max-height:180px;overflow-y:auto}
      .todo-ledger-dock__item{display:flex;align-items:center;gap:10px;min-width:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
      .todo-ledger-dock__glyph{display:grid;flex:none;place-items:center;width:16px;height:16px}
      .todo-ledger-dock__content{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .todo-ledger-state__root{flex:none;width:12px;height:12px;display:flex;align-items:center;justify-content:center}
      .todo-ledger-state__dot{position:relative;width:10px;height:10px;display:block}
      .todo-ledger-state__dot:after{content:'';position:absolute;inset:20%;border-radius:50%;background:currentColor}
      .todo-ledger-state__root[data-state="done"]{color:var(--dsw-alias-state-success-primary)}
      .todo-ledger-state__root[data-state="ongoing"]{color:var(--dsw-alias-state-success-primary)}
      .todo-ledger-state__root[data-state="idle"]{color:var(--dsw-alias-label-tertiary)}
      .todo-ledger-dock__entry{min-width:0}
      .todo-ledger-dock__issue{display:flex;align-items:center;gap:6px;min-width:0;padding-left:26px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
      .todo-ledger-dock__issue--nested{margin-top:4px}
      .todo-ledger-dock__branch{flex:none;color:var(--dsw-alias-label-tertiary)}
      .todo-ledger-dock__issue-content{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .todo-ledger-dock__jump{width:100%;padding:0;border:0;background:transparent;font-family:inherit;text-align:left;cursor:pointer}
      .todo-ledger-dock__jump:hover .todo-ledger-dock__content{color:var(--dsw-alias-label-primary);text-decoration:underline;text-underline-offset:3px}
      .todo-ledger-dock__jump:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:2px}
      .todo-ledger-dock__jump:disabled{cursor:wait;opacity:.65}
      .todo-ledger-dock__jump-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
    `;

    function ReviewRow({ useReview, setReview, t }) {
      const review = useReview((value) => value);
      const [busy, setBusy] = React.useState(false);
      const [failed, setFailed] = React.useState(false);
      const enabled = review.value?.reviewEnabled === true;
      const disabled = busy || review.status !== 'ready' || !review.writable;
      const toggle = async () => {
        if (disabled) return;
        setBusy(true);
        setFailed(false);
        let accepted = false;
        try {
          accepted = await setReview(!enabled);
        } catch (_error) {
          accepted = false;
        }
        setBusy(false);
        setFailed(!accepted);
      };
      return h('div', { className: 'todo-ledger-setting' },
        h('style', null, css),
        h('div', null,
          h('div', { className: 'todo-ledger-setting__title' }, t('title')),
          h('div', { className: 'todo-ledger-setting__description' }, t('description')),
          failed ? h('div', { className: 'todo-ledger-setting__error', role: 'alert' }, t('failed')) : null,
        ),
        h('button', {
          type: 'button',
          className: 'todo-ledger-setting__switch',
          role: 'switch',
          'aria-checked': enabled,
          'aria-label': t('title'),
          disabled,
          onClick: toggle,
        }, h('span', { className: 'todo-ledger-setting__knob', 'aria-hidden': true })),
      );
    }

    function progressLabel(todos, t) {
      const done = todos.filter((item) => item.status === 'completed').length;
      const active = todos.filter((item) => item.status === 'in_progress').length;
      const pending = todos.length - done - active;
      return [
        ...(done > 0 ? [t('done', { done })] : []),
        ...(active > 0 ? [t('active', { active })] : []),
        ...(pending > 0 ? [t('pending', { pending })] : []),
      ].join(' · ');
    }

    function ChecklistIcon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': 'true', strokeWidth: 1 },
        h('path', { d: 'M3.75 6.25C4.7165 6.25 5.5 5.4665 5.5 4.5C5.5 3.5335 4.7165 2.75 3.75 2.75C2.7835 2.75 2 3.5335 2 4.5C2 5.4665 2.7835 6.25 3.75 6.25Z', stroke: 'currentColor' }),
        h('path', { d: 'M7.5 4.5H13.5', stroke: 'currentColor' }),
        h('path', { d: 'M3.75 13.25C4.7165 13.25 5.5 12.4665 5.5 11.5C5.5 10.5335 4.7165 9.75 3.75 9.75C2.7835 9.75 2 10.5335 2 11.5C2 12.4665 2.7835 13.25 3.75 13.25Z', stroke: 'currentColor' }),
        h('path', { d: 'M7.5 11.5H13.5', stroke: 'currentColor' }),
      );
    }

    function ChevronIcon({ up }) {
      const d = up
        ? 'M12 10L8.70711 6.70711C8.31658 6.31658 7.68342 6.31658 7.29289 6.70711L4 10'
        : 'M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6';
      return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': 'true', strokeWidth: 1 },
        h('path', { d, stroke: 'currentColor' }),
      );
    }

    const statusDotState = { completed: 'done', in_progress: 'ongoing', pending: 'idle' };

    function StateDot({ status }) {
      return h('div', { className: 'todo-ledger-state__root', 'data-state': statusDotState[status] },
        h('div', { className: 'todo-ledger-state__dot' }),
      );
    }

    function IssueLine({ text, t, nested = false }) {
      return h('div', {
        className: `todo-ledger-dock__issue${nested ? ' todo-ledger-dock__issue--nested' : ''}`,
        role: 'note',
        'aria-label': `${t('currentIssue')}: ${text}`,
      },
        h('span', { className: 'todo-ledger-dock__branch', 'aria-hidden': true }, '↳'),
        h('span', { className: 'todo-ledger-dock__issue-content', title: text }, text),
      );
    }

    function findChatToolCall(callId) {
      const key = `9:tool-call${callId}`;
      return Array.from(document.querySelectorAll('[data-chat-node-key]'))
        .find((element) => element.dataset.chatNodeKey === key) ?? null;
    }

    function nextFrame() {
      return new Promise((resolve) => { requestAnimationFrame(resolve); });
    }

    async function afterRender() {
      await nextFrame();
      await nextFrame();
    }

    async function waitForChatToolCall(callId) {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const target = findChatToolCall(callId);
        if (target) return target;
        await nextFrame();
      }
      return null;
    }

    async function revealChatToolCall(target) {
      const hidden = [];
      for (let current = target; current; current = current.parentElement) {
        if (current.hasAttribute('hidden')) hidden.push(current);
      }
      for (const element of hidden.reverse()) element.dispatchEvent(new Event('beforematch'));
      if (hidden.length === 0) return true;
      await afterRender();
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (!target.isConnected) return false;
        if (!target.closest('[hidden]')) return true;
        await nextFrame();
      }
      return false;
    }

    function chatTargetVisible(target) {
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const scroller = target.closest('[data-conversation-scroll]');
      if (!scroller) return true;
      const viewport = scroller.getBoundingClientRect();
      return rect.top < viewport.bottom && rect.bottom > viewport.top;
    }

    async function scrollToChatToolCall(target) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        target.scrollIntoView({ behavior: 'instant', block: 'center' });
        await nextFrame();
        if (chatTargetVisible(target)) return true;
      }
      return chatTargetVisible(target);
    }

    async function openTodoStart(ctx, sessionId, item) {
      if (!item.startCallId) return false;
      try {
        let target = findChatToolCall(item.startCallId);
        if (!target && typeof item.startSeq === 'number') {
          const session = ctx.sessions.binding(sessionId)?.session;
          if (!session) return false;
          await session.loadThrough(item.startSeq);
          await afterRender();
          target = await waitForChatToolCall(item.startCallId);
        }
        if (!target || !ctx.sessions.binding(sessionId)) return false;
        if (!await revealChatToolCall(target)) return false;
        return await scrollToChatToolCall(target);
      } catch (_error) {
        return false;
      }
    }

    function TodoPanel({ todos, t, onJump }) {
      const [collapsed, setCollapsed] = React.useState(true);
      const [jumping, setJumping] = React.useState(null);
      const [jumpFailed, setJumpFailed] = React.useState(false);
      if (todos.length === 0) return null;
      const statusLabels = { completed: t('statusCompleted'), in_progress: t('statusActive'), pending: t('statusPending') };
      const activeIssue = todos.find((item) => item.status === 'in_progress' && item.issue);
      const jump = async (item) => {
        if (jumping !== null) return;
        setJumping(item.startCallId);
        setJumpFailed(false);
        let opened = false;
        try { opened = await onJump(item); } catch (_error) { opened = false; }
        setJumping(null);
        setJumpFailed(!opened);
      };
      return h('section', { className: 'todo-ledger-dock', 'data-testid': 'todo-panel', 'aria-label': t('todoTitle') },
        h('style', null, css),
        h('div', { className: 'todo-ledger-dock__body' },
          h('button', {
            type: 'button',
            className: 'todo-ledger-dock__header',
            'aria-expanded': !collapsed,
            onClick: () => setCollapsed((value) => !value),
          },
            h('span', { className: 'todo-ledger-dock__lead', 'aria-hidden': true }, h(ChecklistIcon)),
            h('span', { className: 'todo-ledger-dock__title' }, t('todoTitle')),
            h('span', { className: 'todo-ledger-dock__progress' }, progressLabel(todos, t)),
            h('span', { className: 'todo-ledger-dock__chevron', 'aria-hidden': true }, h(ChevronIcon, { up: collapsed })),
          ),
          collapsed && activeIssue ? h(IssueLine, { text: activeIssue.issue, t }) : null,
          !collapsed ? h('ul', { className: 'todo-ledger-dock__list' }, todos.map((item, index) => h('li', {
            key: `${index}:${item.content}`,
            className: 'todo-ledger-dock__entry',
          },
            h(item.startCallId ? 'button' : 'div', {
              className: `todo-ledger-dock__item${item.startCallId ? ' todo-ledger-dock__jump' : ''}`,
              'data-status': item.status,
              ...(item.startCallId ? {
                type: 'button',
                title: t('jumpToStart'),
                disabled: jumping !== null,
                'aria-busy': jumping === item.startCallId || undefined,
                onClick: () => { void jump(item); },
              } : {}),
            },
              h('span', { className: 'todo-ledger-dock__glyph', role: 'img', 'aria-label': statusLabels[item.status] }, h(StateDot, { status: item.status })),
              h('span', { className: 'todo-ledger-dock__content' }, item.content),
            ),
            item.status === 'in_progress' && item.issue ? h(IssueLine, { text: item.issue, t, nested: true }) : null,
          ))) : null,
          jumpFailed ? h('div', { className: 'todo-ledger-dock__jump-error', role: 'alert' }, t('jumpFailed')) : null,
        ),
      );
    }

    function TodoDock({ useProjection, t, sessionId, openTodoStart }) {
      return h(TodoPanel, {
        todos: useProjection('todoLedger') ?? [],
        t,
        onJump: (item) => openTodoStart(sessionId, item),
      });
    }

    return {
      inject: ['slots', 'locale', 'configForms', 'sessions'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(locale, { en, zh }));
        ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'todo',
          order: 0,
          locale,
          inject: () => ({ openTodoStart: (sessionId, item) => openTodoStart(ctx, sessionId, item) }),
        }, TodoDock)));
        const form = ctx.configForms.get(namespace);
        const face = () => ({
          hooks: { review: form },
          setReview: (enabled) => form.set('reviewEnabled', enabled),
        });
        ctx.effect(() => ctx.configForms.whileServed([namespace], () => ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item',
          id: namespace,
          order: 40,
          locale,
          inject: face,
        }, ReviewRow))));
      },
    };
  },
});
