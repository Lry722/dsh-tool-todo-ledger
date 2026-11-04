window.__ModuleLoader__.load({
  id: 'dsh-tool-todo-ledger',
  factory(require) {
    const React = require('react');
    const {
      Switch,
      StateDot,
      IconChecklistOutlineRegular,
      IconChevronDownOutlineRegular,
      IconChevronLeftOutlineRegular,
      IconChevronRightOutlineRegular,
      IconChevronUpOutlineRegular,
    } = require('@deepseek-ai/dsh-client-ui-primitives');
    const h = React.createElement;
    const namespace = 'todo-ledger';
    const locale = 'todoLedger';
    const sidebarId = 'dsh-tool-todo-ledger';

    const en = {
      title: 'Review todo plans with AGENTS.md',
      description: 'Before each todo_write plan change, an independent model reviews the plan against the active project instructions. Violations are reported without blocking the change.',
      failed: 'Could not save preference',
      todoTitle: 'To-dos',
      sidebarTitle: 'Tasks',
      sidebarDescription: 'Inspect the current plan, turn history, and issue summaries.',
      done: '{done} completed',
      pending: '{pending} pending',
      statusCompleted: 'Completed',
      statusActive: 'In progress',
      statusPending: 'Pending',
      statusVoid: 'Discarded',
      currentIssue: 'Current issue',
      historicalIssues: 'Earlier issues ({count})',
      issueCount: '{count} issues',
      currentPlan: 'Current plan',
      history: 'History',
      currentPlanEmpty: 'The current plan is empty.',
      historyEmpty: 'No turn history is available.',
      turn: 'Turn {turn}',
      earlyTasks: 'Earlier tasks',
      turnNumber: 'Turn number',
      turnSummary: 'Turn summary',
      olderTurn: 'Go to the earlier turn',
      newerTurn: 'Go to the later turn',
      openTurn: 'Current turn',
      emptyTurn: 'This turn has no task records.',
      taskSummary: '{total} tasks · {completed} completed · {voided} discarded',
      jumpToStart: 'Jump to the step that started this task',
      jumpFailed: 'Could not locate the step that started this task',
    };
    const zh = {
      title: '使用 AGENTS.md 审查任务规划',
      description: '每次 todo_write 修改规划前，由独立模型依据当前生效的项目指令进行审查。发现违例会明确提示，但不会阻塞修改。',
      failed: '无法保存设置',
      todoTitle: '任务',
      sidebarTitle: '任务',
      sidebarDescription: '查看当前规划、turn 历史和 issue 摘要。',
      done: '{done} 已完成',
      pending: '{pending} 待处理',
      statusCompleted: '已完成',
      statusActive: '进行中',
      statusPending: '待处理',
      statusVoid: '已作废',
      currentIssue: '当前 issue',
      historicalIssues: '历史 issue（{count}）',
      issueCount: '{count} 个 issue',
      currentPlan: '当前规划',
      history: '历史记录',
      currentPlanEmpty: '当前规划为空。',
      historyEmpty: '暂无 turn 历史。',
      turn: '第 {turn} 轮',
      earlyTasks: '早期任务',
      turnNumber: 'turn 编号',
      turnSummary: 'turn 摘要',
      olderTurn: '转到较早一轮',
      newerTurn: '转到较晚一轮',
      openTurn: '当前轮',
      emptyTurn: '这一轮没有任务记录。',
      taskSummary: '{total} 项 · {completed} 已完成 · {voided} 已作废',
      jumpToStart: '跳转到开始此任务的步骤',
      jumpFailed: '无法定位开始此任务的步骤',
    };

    const css = `
      .todo-ledger-setting{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
      .todo-ledger-setting__title{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary)}
      .todo-ledger-setting__description{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
      .todo-ledger-setting__error{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
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
      .todo-ledger-dock__entry{min-width:0}
      .todo-ledger-dock__issue{display:flex;align-items:center;gap:7px;min-width:0;padding-left:25px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
      .todo-ledger-dock__issue--nested{margin-top:4px}
      .todo-ledger-dock__branch{box-sizing:border-box;flex:none;width:9px;height:9px;margin-left:2px;border-left:1px solid var(--dsw-alias-border-l3);border-bottom:1px solid var(--dsw-alias-border-l3);border-bottom-left-radius:4px;transform:translateY(-2px)}
      .todo-ledger-dock__issue-content{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .todo-ledger-dock__jump{width:100%;padding:0;border:0;background:transparent;font-family:inherit;text-align:left;cursor:pointer}
      .todo-ledger-dock__jump:hover .todo-ledger-dock__content{color:var(--dsw-alias-label-primary)}
      .todo-ledger-dock__jump:focus-visible,.todo-ledger-sidebar button:focus-visible,.todo-ledger-sidebar input:focus-visible,.todo-ledger-sidebar select:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
      .todo-ledger-dock__jump:disabled,.todo-ledger-sidebar button:disabled{cursor:default;opacity:.4}
      .todo-ledger-dock__jump-error,.todo-ledger-sidebar__jump-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
      .todo-ledger-sidebar{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:22px}
      .todo-ledger-sidebar__tabs{display:flex;flex:none;align-self:stretch;gap:20px;margin:0 14px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
      .todo-ledger-sidebar__tab{position:relative;min-height:36px;padding:0 0 6px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:22px;cursor:pointer}
      .todo-ledger-sidebar__tab::after{position:absolute;right:0;bottom:-.5px;left:0;height:2px;border-radius:1px;background:transparent;content:''}
      .todo-ledger-sidebar__tab:hover{color:var(--dsw-alias-label-primary)}
      .todo-ledger-sidebar__tab[aria-selected=true]{color:var(--dsw-alias-label-primary);font-weight:500}
      .todo-ledger-sidebar__tab[aria-selected=true]::after{background:var(--dsw-alias-label-primary)}
      .todo-ledger-sidebar__body{flex:1;min-height:0;overflow-y:auto;padding:10px 14px 16px}
      .todo-ledger-sidebar__tasks{display:flex;flex-direction:column;gap:3px;margin:0;padding:0;list-style:none}
      .todo-ledger-sidebar__task{min-width:0;padding:6px;border-radius:var(--dsw-radius-md)}
      .todo-ledger-sidebar__task[data-status=in_progress]{background:var(--dsw-alias-interactive-bg-hover)}
      .todo-ledger-sidebar__task-row{display:flex;align-items:flex-start;gap:7px;min-width:0}
      .todo-ledger-sidebar__glyph{display:grid;flex:none;place-items:center;width:16px;height:22px}
      .todo-ledger-sidebar__index{flex:none;min-width:20px;padding-right:2px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:22px;font-variant-numeric:tabular-nums;text-align:right}
      .todo-ledger-sidebar__task-main{flex:1;min-width:0}
      .todo-ledger-sidebar__content{display:block;min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);font-size:13px;line-height:22px}
      .todo-ledger-sidebar__task[data-status=in_progress] .todo-ledger-sidebar__content{color:var(--dsw-alias-label-primary);font-weight:500}
      .todo-ledger-sidebar__task[data-status=completed] .todo-ledger-sidebar__content{color:var(--dsw-alias-label-secondary)}
      .todo-ledger-sidebar__task[data-status=void] .todo-ledger-sidebar__content{text-decoration:line-through;color:var(--dsw-alias-label-tertiary)}
      .todo-ledger-sidebar__icon,.todo-ledger-sidebar__issue-toggle{display:inline-flex;flex:none;align-items:center;justify-content:center;gap:3px;width:24px;height:24px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;transition:background-color .12s,color .12s,opacity .12s}
      .todo-ledger-sidebar__icon:hover:not(:disabled),.todo-ledger-sidebar__issue-toggle:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .todo-ledger-sidebar__task-jump{height:22px;margin-top:0;font-size:15px;line-height:1;opacity:0;pointer-events:none}
      .todo-ledger-sidebar__task:hover .todo-ledger-sidebar__task-jump,.todo-ledger-sidebar__task:focus-within .todo-ledger-sidebar__task-jump,.todo-ledger-sidebar__task-jump:focus-visible{opacity:1;pointer-events:auto}
      .todo-ledger-sidebar__task .todo-ledger-sidebar__task-jump:disabled{opacity:0}
      .todo-ledger-sidebar__task:hover .todo-ledger-sidebar__task-jump:disabled,.todo-ledger-sidebar__task:focus-within .todo-ledger-sidebar__task-jump:disabled{opacity:.4}
      @media(hover:none){.todo-ledger-sidebar__task .todo-ledger-sidebar__task-jump{opacity:1;pointer-events:auto}.todo-ledger-sidebar__task .todo-ledger-sidebar__task-jump:disabled{opacity:.4}}
      .todo-ledger-sidebar__issue-toggle{width:auto;min-width:24px;height:20px;margin-top:2px;padding:0 2px;font-size:12px;line-height:20px;white-space:nowrap}
      .todo-ledger-sidebar__issues{margin:6px 0 2px;padding:2px 0 0 10px;border-left:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px}
      .todo-ledger-sidebar__issue-heading{margin:2px 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px;font-weight:500}
      .todo-ledger-sidebar__issue{padding:1px 0;overflow-wrap:anywhere}
      .todo-ledger-sidebar__issue[data-active=true]{color:var(--dsw-alias-label-primary);font-weight:500}
      .todo-ledger-sidebar__turn-heading{display:flex;align-items:center;gap:8px;min-width:0}
      .todo-ledger-sidebar__turn-select{box-sizing:border-box;flex:1;min-width:0;height:28px;padding:0 2px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;font-weight:500;text-overflow:ellipsis}
      .todo-ledger-sidebar__turn-stepper{display:inline-flex;flex:none;align-items:center;height:26px;padding:1px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover)}
      .todo-ledger-sidebar__turn-stepper .todo-ledger-sidebar__icon{width:22px;height:22px;margin:0}
      .todo-ledger-sidebar__turn-stepper .todo-ledger-sidebar__icon:hover:not(:disabled){background:var(--dsw-specific-menu)}
      .todo-ledger-sidebar__turn-input{box-sizing:border-box;width:36px;min-width:0;height:22px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:20px;text-align:center;appearance:textfield;-moz-appearance:textfield}
      .todo-ledger-sidebar__turn-input::-webkit-outer-spin-button,.todo-ledger-sidebar__turn-input::-webkit-inner-spin-button{margin:0;-webkit-appearance:none}
      .todo-ledger-sidebar__turn-meta{margin:4px 0 10px;padding:0 0 10px;border-bottom:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
      .todo-ledger-sidebar__turn-preview{margin-top:3px;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}
      .todo-ledger-sidebar__open{display:inline-block;margin-left:6px;color:var(--dsw-alias-label-tertiary)}
      .todo-ledger-sidebar__open::before{content:'·';margin-right:6px}
      .todo-ledger-sidebar__empty{padding:32px 12px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;text-align:center}
    `;

    function ReviewRow({ useReview, setReview, t }) {
      const review = useReview((value) => value);
      const [busy, setBusy] = React.useState(false);
      const [failed, setFailed] = React.useState(false);
      const enabled = review.value?.reviewEnabled === true;
      const disabled = busy || review.status !== 'ready' || !review.writable;
      const toggle = async (next) => {
        if (disabled) return;
        setBusy(true);
        setFailed(false);
        let accepted = false;
        try {
          accepted = await setReview(next);
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
        h(Switch, {
          checked: enabled,
          disabled,
          label: t('title'),
          onChange: (next) => { void toggle(next); },
        }),
      );
    }

    function progressLabel(todos, t) {
      const done = todos.filter((item) => item.status === 'completed').length;
      const pending = todos.filter((item) => item.status === 'pending').length;
      return [
        ...(done > 0 ? [t('done', { done })] : []),
        ...(pending > 0 ? [t('pending', { pending })] : []),
      ].join(' · ');
    }

    const statusDotState = { completed: 'done', in_progress: 'ongoing', pending: 'idle', void: 'idle' };
    const statusLabels = (t) => ({
      completed: t('statusCompleted'),
      in_progress: t('statusActive'),
      pending: t('statusPending'),
      void: t('statusVoid'),
    });

    function IssueLine({ text, t, nested = false }) {
      return h('div', {
        className: `todo-ledger-dock__issue${nested ? ' todo-ledger-dock__issue--nested' : ''}`,
        role: 'note',
        'aria-label': `${t('currentIssue')}: ${text}`,
      },
        h('span', { className: 'todo-ledger-dock__branch', 'aria-hidden': true }),
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

    function useTaskJump(onJump) {
      const [jumping, setJumping] = React.useState(null);
      const [jumpFailed, setJumpFailed] = React.useState(false);
      const jump = async (item) => {
        if (jumping !== null) return;
        setJumping(item.startCallId);
        setJumpFailed(false);
        let opened = false;
        try { opened = await onJump(item); } catch (_error) { opened = false; }
        setJumping(null);
        setJumpFailed(!opened);
      };
      return { jumping, jumpFailed, jump };
    }

    function TodoPanel({ todos, t, onJump }) {
      const [collapsed, setCollapsed] = React.useState(true);
      const { jumping, jumpFailed, jump } = useTaskJump(onJump);
      if (todos.length === 0) return null;
      const labels = statusLabels(t);
      const activeIssue = todos.find((item) => item.status === 'in_progress' && item.issue);
      return h('section', { className: 'todo-ledger-dock', 'data-testid': 'todo-panel', 'aria-label': t('todoTitle') },
        h('style', null, css),
        h('div', { className: 'todo-ledger-dock__body' },
          h('button', {
            type: 'button',
            className: 'todo-ledger-dock__header',
            'aria-expanded': !collapsed,
            onClick: () => setCollapsed((value) => !value),
          },
            h('span', { className: 'todo-ledger-dock__lead', 'aria-hidden': true }, h(IconChecklistOutlineRegular)),
            h('span', { className: 'todo-ledger-dock__title' }, t('todoTitle')),
            h('span', { className: 'todo-ledger-dock__progress' }, progressLabel(todos, t)),
            h('span', { className: 'todo-ledger-dock__chevron', 'aria-hidden': true },
              collapsed ? h(IconChevronUpOutlineRegular) : h(IconChevronDownOutlineRegular)),
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
              h('span', { className: 'todo-ledger-dock__glyph', role: 'img', 'aria-label': labels[item.status] }, h(StateDot, { state: statusDotState[item.status] })),
              h('span', { className: 'todo-ledger-dock__content' }, item.content),
            ),
            item.status === 'in_progress' && item.issue ? h(IssueLine, { text: item.issue, t, nested: true }) : null,
          ))) : null,
          jumpFailed ? h('div', { className: 'todo-ledger-dock__jump-error', role: 'alert' }, t('jumpFailed')) : null,
        ),
      );
    }

    function TodoDock({ useProjection, t, sessionId, openTodoStart }) {
      const projection = useProjection('todoLedger');
      return h(TodoPanel, {
        todos: projection?.dock ?? [],
        t,
        onJump: (item) => openTodoStart(sessionId, item),
      });
    }

    function defaultTurn(turns) {
      const nonEmpty = turns.filter((turn) => turn.total > 0);
      const archived = nonEmpty.filter((turn) => !turn.open);
      return (archived.at(-1) ?? nonEmpty.at(-1) ?? turns.at(-1))?.turn;
    }

    function adjacentTurn(turns, selectedTurn, offset) {
      const index = turns.findIndex((turn) => turn.turn === selectedTurn);
      return index < 0 ? undefined : turns[index + offset]?.turn;
    }

    function turnLabel(turn, t) {
      return turn === 0 ? t('earlyTasks') : t('turn', { turn });
    }

    function IssueSummary({ issue }) {
      return h('div', { className: 'todo-ledger-sidebar__issue', 'data-active': issue.active || undefined },
        h('span', { title: issue.name }, issue.name),
      );
    }

    function TaskEntry({ item, showIndex, expanded, onToggle, t, jumping, onJump }) {
      const labels = statusLabels(t);
      const active = item.issues.filter((issue) => issue.active);
      const historical = item.issues.filter((issue) => !issue.active);
      return h('li', { className: 'todo-ledger-sidebar__task', 'data-status': item.status },
        h('div', { className: 'todo-ledger-sidebar__task-row' },
          h('span', { className: 'todo-ledger-sidebar__glyph', role: 'img', 'aria-label': labels[item.status] },
            h(StateDot, { state: statusDotState[item.status] })),
          showIndex ? h('span', { className: 'todo-ledger-sidebar__index' }, `${item.index}.`) : null,
          h('div', { className: 'todo-ledger-sidebar__task-main' },
            h('span', { className: 'todo-ledger-sidebar__content', title: item.content }, item.content),
            item.issues.length > 0 ? h('button', {
              type: 'button',
              className: 'todo-ledger-sidebar__issue-toggle',
              'aria-expanded': expanded,
              'aria-label': t('issueCount', { count: item.issues.length }),
              onClick: onToggle,
            },
              h(expanded ? IconChevronUpOutlineRegular : IconChevronDownOutlineRegular, { size: 14, 'aria-hidden': true }),
              h('span', null, t('issueCount', { count: item.issues.length })),
            ) : null,
            expanded && item.issues.length > 0 ? h('div', { className: 'todo-ledger-sidebar__issues' },
              active.length > 0 ? h('div', { className: 'todo-ledger-sidebar__issue-heading' }, t('currentIssue')) : null,
              active.map((issue) => h(IssueSummary, { key: `active:${issue.name}`, issue })),
              historical.length > 0 ? h('div', { className: 'todo-ledger-sidebar__issue-heading' }, t('historicalIssues', { count: historical.length })) : null,
              historical.map((issue) => h(IssueSummary, { key: `history:${issue.name}`, issue })),
            ) : null,
          ),
          item.startCallId ? h('button', {
            type: 'button',
            className: 'todo-ledger-sidebar__icon todo-ledger-sidebar__task-jump',
            title: t('jumpToStart'),
            'aria-label': t('jumpToStart'),
            'aria-busy': jumping === item.startCallId || undefined,
            disabled: jumping !== null,
            onClick: () => { void onJump(item); },
          }, '↗') : null,
        ),
      );
    }

    function TaskList({ items, scope, expandActive, t, jumping, onJump }) {
      const [overrides, setOverrides] = React.useState({});
      return h('ul', { className: 'todo-ledger-sidebar__tasks' }, items.map((item) => {
        const key = `${scope}:${item.id}`;
        const activeDefault = expandActive && item.status === 'in_progress' && item.issues.some((issue) => issue.active);
        const expanded = overrides[key] ?? activeDefault;
        return h(TaskEntry, {
          key,
          item,
          showIndex: typeof item.index === 'number',
          expanded,
          onToggle: () => setOverrides((value) => ({ ...value, [key]: !expanded })),
          t,
          jumping,
          onJump,
        });
      }));
    }

    function HistoryView({ turns, currentTurn, selectedTurn, onSelect, t, jumping, onJump }) {
      const selected = turns.find((turn) => turn.turn === selectedTurn);
      const [draft, setDraft] = React.useState(selectedTurn === undefined ? '' : String(selectedTurn));
      React.useEffect(() => { setDraft(selectedTurn === undefined ? '' : String(selectedTurn)); }, [selectedTurn]);
      if (!selected) return h('div', { className: 'todo-ledger-sidebar__empty' }, t('historyEmpty'));
      const commit = () => {
        const value = Number(draft);
        if (draft.trim() && Number.isInteger(value) && turns.some((turn) => turn.turn === value)) onSelect(value);
        else setDraft(String(selectedTurn));
      };
      const older = adjacentTurn(turns, selectedTurn, -1);
      const newer = adjacentTurn(turns, selectedTurn, 1);
      return h('div', null,
        h('div', { className: 'todo-ledger-sidebar__turn-heading' },
          h('select', {
            className: 'todo-ledger-sidebar__turn-select',
            value: selectedTurn,
            'aria-label': t('turnSummary'),
            onChange: (event) => onSelect(Number(event.target.value)),
          }, [...turns].reverse().map((turn) => h('option', { key: turn.turn, value: turn.turn },
            `${turnLabel(turn.turn, t)} · ${turn.total}${turn.preview ? ` · ${turn.preview}` : ''}`))),
          h('div', { className: 'todo-ledger-sidebar__turn-stepper' },
            h('button', { type: 'button', className: 'todo-ledger-sidebar__icon', title: t('olderTurn'), 'aria-label': t('olderTurn'), disabled: older === undefined, onClick: () => onSelect(older) },
              h(IconChevronLeftOutlineRegular, { size: 14, 'aria-hidden': true })),
            h('input', {
              className: 'todo-ledger-sidebar__turn-input',
              type: 'number',
              min: 0,
              step: 1,
              value: draft,
              'aria-label': t('turnNumber'),
              onChange: (event) => setDraft(event.target.value),
              onBlur: commit,
              onKeyDown: (event) => {
                if (event.key === 'Enter') { event.preventDefault(); commit(); }
                if (event.key === 'Escape') setDraft(String(selectedTurn));
              },
            }),
            h('button', { type: 'button', className: 'todo-ledger-sidebar__icon', title: t('newerTurn'), 'aria-label': t('newerTurn'), disabled: newer === undefined, onClick: () => onSelect(newer) },
              h(IconChevronRightOutlineRegular, { size: 14, 'aria-hidden': true })),
          ),
        ),
        h('div', { className: 'todo-ledger-sidebar__turn-meta' },
          h('div', null,
            t('taskSummary', { total: selected.total, completed: selected.completed, voided: selected.voided }),
            selected.turn === currentTurn && selected.open ? h('span', { className: 'todo-ledger-sidebar__open' }, t('openTurn')) : null,
          ),
          selected.preview ? h('div', { className: 'todo-ledger-sidebar__turn-preview' }, selected.preview) : null,
        ),
        selected.tasks.length === 0
          ? h('div', { className: 'todo-ledger-sidebar__empty' }, t('emptyTurn'))
          : h(TaskList, { items: selected.tasks, scope: `turn:${selected.turn}`, expandActive: false, t, jumping, onJump }),
      );
    }

    function TodoSidebarSession({ useProjection, t, sessionId, openTodoStart, uiStates }) {
      const saved = uiStates.get(sessionId);
      const [view, setView] = React.useState(saved?.view ?? 'current');
      const [selectedTurn, setSelectedTurn] = React.useState(saved?.selectedTurn);
      const projection = useProjection('todoLedger');
      const turns = projection?.turns ?? [];
      const currentTurn = projection?.currentTurn ?? 0;
      const { jumping, jumpFailed, jump } = useTaskJump((item) => openTodoStart(sessionId, item));
      const validSelection = turns.some((turn) => turn.turn === selectedTurn);
      const fallback = defaultTurn(turns);
      const effectiveSelection = validSelection ? selectedTurn : fallback;
      React.useEffect(() => {
        if (view === 'history' && !validSelection && fallback !== undefined) setSelectedTurn(fallback);
      }, [view, validSelection, fallback]);
      React.useEffect(() => {
        uiStates.set(sessionId, { view, selectedTurn });
      }, [sessionId, view, selectedTurn, uiStates]);
      const onJump = (item) => jump(item);
      return h('section', { className: 'todo-ledger-sidebar', 'aria-label': t('sidebarTitle') },
        h('style', null, css),
        h('div', { className: 'todo-ledger-sidebar__tabs', role: 'tablist' },
          h('button', { type: 'button', role: 'tab', className: 'todo-ledger-sidebar__tab', 'aria-selected': view === 'current', onClick: () => setView('current') }, t('currentPlan')),
          h('button', { type: 'button', role: 'tab', className: 'todo-ledger-sidebar__tab', 'aria-selected': view === 'history', onClick: () => setView('history') }, t('history')),
        ),
        h('div', { className: 'todo-ledger-sidebar__body', role: 'tabpanel' },
          view === 'current'
            ? ((projection?.current.length ?? 0) === 0
              ? h('div', { className: 'todo-ledger-sidebar__empty' }, t('currentPlanEmpty'))
              : h(TaskList, { items: projection.current, scope: 'current', expandActive: true, t, jumping, onJump }))
            : h(HistoryView, { turns, currentTurn, selectedTurn: effectiveSelection, onSelect: setSelectedTurn, t, jumping, onJump }),
          jumpFailed ? h('div', { className: 'todo-ledger-sidebar__jump-error', role: 'alert' }, t('jumpFailed')) : null,
        ),
      );
    }

    function TodoSidebar(props) {
      return h(TodoSidebarSession, { ...props, key: props.sessionId });
    }

    function TodoSidebarTitle({ t }) {
      return h('span', null, t('sidebarTitle'));
    }

    return {
      inject: ['slots', 'locale', 'configForms', 'sessions', 'sidebarRightTabs'],
      apply(ctx) {
        const uiStates = new Map();
        const t = ctx.locale.bind(locale);
        ctx.effect(() => ctx.locale.register(locale, { en, zh }));
        ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'todo',
          order: 0,
          locale,
          inject: () => ({ openTodoStart: (sessionId, item) => openTodoStart(ctx, sessionId, item) }),
        }, TodoDock)));
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: sidebarId,
          kind: 'todo-ledger',
          title: () => t('sidebarTitle'),
          guide: [{
            id: 'tasks',
            order: 30,
            title: () => t('sidebarTitle'),
            description: () => t('sidebarDescription'),
            icon: IconChecklistOutlineRegular,
          }],
        }));
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: sidebarId,
          locale,
          inject: () => ({ uiStates, openTodoStart: (sessionId, item) => openTodoStart(ctx, sessionId, item) }),
        }, TodoSidebar)));
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: sidebarId,
          locale,
        }, TodoSidebarTitle)));
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
