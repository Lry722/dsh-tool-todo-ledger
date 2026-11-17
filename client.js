window.__ModuleLoader__.load({
  id: 'dsh-tool-todo-ledger',
  factory(require) {
    const React = require('react');
    const {
      StateDot,
      SettingsForm,
      SettingsFormModel,
      SettingsValueField,
      settingsNumberField,
      IconChecklistOutlineRegular,
      IconChevronDownOutlineRegular,
      IconChevronUpOutlineRegular,
    } = require('@deepseek-ai/dsh-client-ui-primitives');
    const h = React.createElement;
    const locale = 'todoLedger';
    const sidebarId = 'dsh-tool-todo-ledger';
    const settingsNamespace = 'todo-ledger';
    const settingsKey = 'dsh-tool-todo-ledger';

    const en = {
      todoTitle: 'To-dos',
      sidebarTitle: 'Tasks',
      sidebarDescription: 'Inspect per-turn worksets, turn-end status, and issue summaries.',
      done: '{done} completed',
      pending: '{pending} pending',
      statusCompleted: 'Completed',
      statusActive: 'In progress',
      statusPending: 'Pending',
      statusVoid: 'Discarded',
      currentIssue: 'Current issue',
      issueCount: '{count} issues',
      history: 'History',
      historyEmpty: 'No turn history is available.',
      turn: 'Turn {turn}',
      earlyTasks: 'Earlier tasks',
      turnSummary: 'Turn summary',
      openTurn: 'Current turn',
      emptyTurn: 'This turn has no task records.',
      taskTotal: '{total} tasks',
      taskCompleted: '{completed} completed',
      taskVoided: '{voided} discarded',
      jumpToStart: 'Jump to the step that started this task',
      jumpFailed: 'Could not locate the requested step',
      jumpToIssue: 'Jump to the latest step that reported {issue}',
      settingsSummary: 'Control how often todo_report repeats the active task and issue.',
      reminderIntervalLabel: 'Reminder interval',
      reminderIntervalHint: 'Milliseconds between reminders that repeat the current task and issue. 0 disables reminders.',
      overridden: 'Overridden',
      reset: 'Reset to default',
      readOnly: 'This deployment stores settings read-only.',
      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      save: 'Save',
      saving: 'Saving…',
      saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
      invalidNumber: 'Enter a number, or leave blank to use the default.',
    };
    const zh = {
      todoTitle: '任务',
      sidebarTitle: '任务',
      sidebarDescription: '查看逐 turn 工作集、轮末状态和 issue 摘要。',
      done: '{done} 已完成',
      pending: '{pending} 待处理',
      statusCompleted: '已完成',
      statusActive: '进行中',
      statusPending: '待处理',
      statusVoid: '已作废',
      currentIssue: '当前 issue',
      issueCount: '{count} 个 issue',
      history: '历史记录',
      historyEmpty: '暂无 turn 历史。',
      turn: '第 {turn} 轮',
      earlyTasks: '早期任务',
      turnSummary: 'turn 摘要',
      openTurn: '当前轮',
      emptyTurn: '这一轮没有任务记录。',
      taskTotal: '{total} 项',
      taskCompleted: '{completed} 已完成',
      taskVoided: '{voided} 已作废',
      jumpToStart: '跳转到开始此任务的步骤',
      jumpFailed: '无法定位对应步骤',
      jumpToIssue: '跳转到最近报告 {issue} 的步骤',
      settingsSummary: '控制 todo_report 重复当前任务与 issue 的间隔。',
      reminderIntervalLabel: '提醒间隔',
      reminderIntervalHint: '每隔多少毫秒在 todo_report 的结果中重复当前任务与 issue；0 表示关闭提醒。',
      overridden: '已覆盖',
      reset: '恢复默认',
      readOnly: '本部署的设置为只读。',
      unavailable: '该插件当前未加载，暂时无法配置。',
      save: '保存',
      saving: '保存中…',
      saveFailed: '本部署没有接受这些值，已保留供你修改。',
      invalidNumber: '请填数字；留空表示使用默认值。',
    };

    const css = `
      .todo-ledger-dock{box-sizing:border-box;flex:none;overflow:hidden;margin:0 auto;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));border:0;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-panel);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
      .todo-ledger-dock__body{display:flex;flex-direction:column;gap:8px;padding:6px 12px}
      .todo-ledger-dock__header{display:flex;align-items:center;gap:10px;width:100%;padding:0;border:none;background:transparent;text-align:left;cursor:pointer}
      .todo-ledger-dock__lead,.todo-ledger-dock__chevron{display:grid;flex:none;place-items:center;color:var(--dsw-alias-label-tertiary)}
      .todo-ledger-dock__title{flex:none;font-size:13px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}
      .todo-ledger-dock__progress{display:flex;flex:1 1 auto;gap:6px;min-width:0;overflow:hidden;font-size:13px;line-height:20px;font-weight:400;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
      .todo-ledger-dock__progress>span{flex:none}
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
      .todo-ledger-dock__issue.todo-ledger-dock__issue-jump{box-sizing:border-box;padding-left:25px}
      .todo-ledger-dock__issue-jump .todo-ledger-dock__issue-content{flex:1}
      .todo-ledger-dock__jump:hover .todo-ledger-dock__content,.todo-ledger-dock__jump:hover .todo-ledger-dock__issue-content{color:var(--dsw-alias-label-primary)}
      .todo-ledger-dock__jump:focus-visible,.todo-ledger-sidebar button:focus-visible,.todo-ledger-sidebar input:focus-visible,.todo-ledger-sidebar select:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
      .todo-ledger-dock__jump:disabled,.todo-ledger-sidebar button:disabled{cursor:default;opacity:.4}
      .todo-ledger-dock__jump-error,.todo-ledger-sidebar__jump-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
      .todo-ledger-sidebar{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:22px}
      .todo-ledger-sidebar__content{position:relative;flex:1;min-height:0}
      .todo-ledger-sidebar__body{box-sizing:border-box;height:100%;overflow-y:auto;padding:10px 46px 16px 14px}
      .todo-ledger-sidebar__tasks{display:flex;flex-direction:column;gap:3px;margin:0;padding:0;list-style:none}
      .todo-ledger-sidebar__task{min-width:0;padding:6px;border-radius:var(--dsw-radius-md)}
      .todo-ledger-sidebar__task[data-status=in_progress]{background:var(--dsw-alias-interactive-bg-hover)}
      .todo-ledger-sidebar__task-row{display:flex;align-items:flex-start;gap:7px;min-width:0}
      .todo-ledger-sidebar__glyph{display:grid;flex:none;place-items:center;width:16px;height:22px}
      .todo-ledger-sidebar__task-main{flex:1;min-width:0}
      .todo-ledger-sidebar__task-content{display:block;min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);font-size:13px;line-height:22px}
      .todo-ledger-sidebar__task[data-status=in_progress] .todo-ledger-sidebar__task-content{color:var(--dsw-alias-label-primary);font-weight:500}
      .todo-ledger-sidebar__task[data-status=completed] .todo-ledger-sidebar__task-content{color:var(--dsw-alias-label-secondary)}
      .todo-ledger-sidebar__task[data-status=void] .todo-ledger-sidebar__task-content{text-decoration:line-through;color:var(--dsw-alias-label-tertiary)}
      .todo-ledger-sidebar__icon,.todo-ledger-sidebar__issue-toggle{display:inline-flex;flex:none;align-items:center;justify-content:center;gap:3px;width:24px;height:24px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;transition:background-color .12s,color .12s,opacity .12s}
      .todo-ledger-sidebar__icon:hover:not(:disabled),.todo-ledger-sidebar__issue-toggle:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .todo-ledger-sidebar__task-jump{height:22px;margin-top:0;font-size:15px;line-height:1;opacity:0;pointer-events:none}
      .todo-ledger-sidebar__task:hover .todo-ledger-sidebar__task-jump,.todo-ledger-sidebar__task:focus-within .todo-ledger-sidebar__task-jump,.todo-ledger-sidebar__task-jump:focus-visible{opacity:1;pointer-events:auto}
      .todo-ledger-sidebar__task .todo-ledger-sidebar__task-jump:disabled{opacity:0}
      .todo-ledger-sidebar__task:hover .todo-ledger-sidebar__task-jump:disabled,.todo-ledger-sidebar__task:focus-within .todo-ledger-sidebar__task-jump:disabled{opacity:.4}
      @media(hover:none){.todo-ledger-sidebar__task .todo-ledger-sidebar__task-jump{opacity:1;pointer-events:auto}.todo-ledger-sidebar__task .todo-ledger-sidebar__task-jump:disabled{opacity:.4}}
      .todo-ledger-sidebar__issue-toggle{width:auto;min-width:24px;height:20px;margin-top:2px;padding:0 2px;font-size:12px;line-height:20px;white-space:nowrap}
      .todo-ledger-sidebar__issues{margin:6px 0 2px;padding:0;border-top:.5px solid var(--dsw-alias-border-l2);border-bottom:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px}
      .todo-ledger-sidebar__issue{padding:5px 8px;overflow-wrap:anywhere;line-height:20px}
      .todo-ledger-sidebar__issue+.todo-ledger-sidebar__issue{border-top:.5px solid var(--dsw-alias-border-l2)}
      .todo-ledger-sidebar__issue[data-active=true]{color:var(--dsw-alias-label-primary);font-weight:500}
      .todo-ledger-sidebar__issue-jump{box-sizing:border-box;display:flex;align-items:flex-start;gap:8px;width:100%;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
      .todo-ledger-sidebar__issue-jump:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .todo-ledger-sidebar__issue-name{flex:1;min-width:0}
      .todo-ledger-sidebar__turn-heading{display:flex;align-items:center;gap:8px;min-width:0}
      .todo-ledger-sidebar__turn-selector{position:relative;flex:1;min-width:0}
      .todo-ledger-sidebar__turn-select-value{position:absolute;inset:0 24px 0 2px;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:14px;line-height:28px;font-weight:500;text-overflow:ellipsis;white-space:nowrap;pointer-events:none}
      .todo-ledger-sidebar__turn-select{box-sizing:border-box;width:100%;height:28px;padding:0 24px 0 2px;border:0;background:transparent;color:transparent;font:inherit;font-size:14px;line-height:22px;font-weight:500;appearance:none;-webkit-appearance:none}
      .todo-ledger-sidebar__turn-select option{color:var(--dsw-alias-label-primary)}
      .todo-ledger-sidebar__turn-select-chevron{position:absolute;top:7px;right:4px;color:var(--dsw-alias-label-tertiary);pointer-events:none}
      .todo-ledger-sidebar__history{min-width:0}
      .todo-ledger-sidebar__turn-rail{--turn-preview-height:100px;position:absolute;z-index:2;top:50%;right:14px;width:28px;height:min(max(0px,calc(100% - 64px)),420px);display:flex;flex-direction:column;justify-content:center;contain:layout;transform:translateY(-50%)}
      .todo-ledger-sidebar__turn-rail-scroller{max-height:100%;padding:6px 0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;cursor:pointer}
      .todo-ledger-sidebar__turn-rail-scroller::-webkit-scrollbar{display:none}
      .todo-ledger-sidebar__turn-rail-mark{position:relative;display:block;width:28px;height:10px;padding:0;border:0;border-radius:8px;background:transparent;cursor:pointer}
      .todo-ledger-sidebar__turn-rail-mark:before{content:"";position:absolute;top:50%;right:0;width:20px;height:2px;border-radius:2px;background:var(--dsw-alias-border-l4);transform:translateY(-50%) scaleX(.6);transform-origin:100%;transition:transform .14s,background-color .14s}
      .todo-ledger-sidebar__turn-rail-mark:hover:before,.todo-ledger-sidebar__turn-rail-mark:focus-visible:before,.todo-ledger-sidebar__turn-rail-mark[data-preview=true]:before{background:var(--dsw-alias-label-tertiary);transform:translateY(-50%) scaleX(.9)}
      .todo-ledger-sidebar__turn-rail-mark[data-active=true]:before{background:var(--dsw-alias-label-primary);transform:translateY(-50%) scaleX(1)}
      .todo-ledger-sidebar .todo-ledger-sidebar__turn-rail-mark:focus-visible{outline:none}
      .todo-ledger-sidebar__turn-rail-mark:focus-visible:after{content:"";position:absolute;inset:0 0 0 auto;width:20px;border-radius:inherit;outline:1px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}
      .todo-ledger-sidebar__turn-preview{top:clamp(0px,calc(var(--turn-preview-center) - var(--turn-preview-height) / 2),calc(100% - var(--turn-preview-height)));box-sizing:border-box;position:absolute;right:calc(100% + 10px);width:min(300px,calc(100vw - 120px));max-height:var(--turn-preview-height);padding:10px 12px;border:0;border-radius:var(--dsw-radius-lg);overflow:hidden;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-panel);color:var(--dsw-alias-label-primary);pointer-events:none;transition:top .14s cubic-bezier(.2,.8,.2,1);animation:.12s ease-out todo-ledger-turn-preview-enter}
      .todo-ledger-sidebar__turn-preview-title,.todo-ledger-sidebar__turn-preview-task{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical}
      .todo-ledger-sidebar__turn-preview-title{font:var(--dsw-font-xs-strong-13);-webkit-line-clamp:1}
      .todo-ledger-sidebar__turn-preview-task{margin-top:4px;color:var(--dsw-alias-label-caption);font:var(--dsw-font-xxs-12);-webkit-line-clamp:3}
      @keyframes todo-ledger-turn-preview-enter{0%{opacity:0;transform:translate(4px)}}
      @media(prefers-reduced-motion:reduce){.todo-ledger-sidebar__turn-rail-mark:before,.todo-ledger-sidebar__turn-preview{transition:none;animation:none}}
      .todo-ledger-sidebar__turn-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 0 10px;padding:0 0 10px;border-bottom:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
      .todo-ledger-sidebar__turn-stats{display:flex;flex:1 1 auto;flex-wrap:wrap;gap:2px 10px;min-width:0}
      .todo-ledger-sidebar__open{display:inline-block;color:var(--dsw-alias-label-tertiary)}
      .todo-ledger-sidebar__empty{padding:32px 12px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;text-align:center}
    `;

    function progressLabel(todos, t) {
      const done = todos.filter((item) => item.status === 'completed').length;
      const pending = todos.filter((item) => item.status === 'pending').length;
      return [
        ...(done > 0 ? [t('done', { done })] : []),
        ...(pending > 0 ? [t('pending', { pending })] : []),
      ];
    }

    const statusDotState = { completed: 'done', in_progress: 'ongoing', pending: 'idle', void: 'idle' };
    const statusLabels = (t) => ({
      completed: t('statusCompleted'),
      in_progress: t('statusActive'),
      pending: t('statusPending'),
      void: t('statusVoid'),
    });

    function IssueLine({ text, t, nested = false, startCallId, startSeq, jumping, onJump }) {
      const navigable = typeof startCallId === 'string' && typeof startSeq === 'number';
      return h(navigable ? 'button' : 'div', {
        className: `todo-ledger-dock__issue${nested ? ' todo-ledger-dock__issue--nested' : ''}${navigable ? ' todo-ledger-dock__jump todo-ledger-dock__issue-jump' : ''}`,
        ...(navigable ? {
          type: 'button',
          'aria-label': t('jumpToIssue', { issue: text }),
          disabled: jumping !== null,
          'aria-busy': jumping === startCallId || undefined,
          onClick: () => { void onJump({ name: text, startCallId, startSeq }); },
        } : {
          role: 'note',
          'aria-label': `${t('currentIssue')}: ${text}`,
        }),
      },
        h('span', { className: 'todo-ledger-dock__branch', 'aria-hidden': true }),
        h('span', { className: 'todo-ledger-dock__issue-content' }, text),
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

    function conversationSession(ctx, sessionId) {
      for (const entry of ctx.slots.entries('conversation.session')) {
        if (typeof entry.inject !== 'function' || entry.store === undefined || typeof entry.store === 'function') continue;
        // DSH exposes no public view-navigation API; reuse the live Session store rendered by the slot.
        const instance = ctx.slots._stores?.get(entry.store)?.instances?.get(sessionId);
        if (instance === undefined) continue;
        return { face: entry.inject(sessionId, instance.actions), instance };
      }
      return undefined;
    }

    async function openTrajectoryToolCall(ctx, sessionId, item) {
      try {
        const conversation = conversationSession(ctx, sessionId);
        if (conversation === undefined) return false;
        if (typeof item.startSeq === 'number') {
          const session = ctx.sessions.binding(sessionId)?.session;
          if (!session) return false;
          await session.loadThrough(item.startSeq);
        }
        conversation.face.openView('trajectory', item.startCallId);
        for (let attempt = 0; attempt < 60; attempt += 1) {
          if (conversation.instance.getSnapshot().viewRequest === null) return true;
          await nextFrame();
        }
        return false;
      } catch (_error) {
        return false;
      }
    }

    async function openTodoStart(ctx, sessionId, item) {
      if (!item.startCallId) return false;
      if (document.querySelector('[data-trajectory-scroll]')) return await openTrajectoryToolCall(ctx, sessionId, item);
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
            h('span', { className: 'todo-ledger-dock__progress' }, progressLabel(todos, t).map((label) => h('span', { key: label }, label))),
            h('span', { className: 'todo-ledger-dock__chevron', 'aria-hidden': true },
              collapsed ? h(IconChevronUpOutlineRegular) : h(IconChevronDownOutlineRegular)),
          ),
          collapsed && activeIssue ? h(IssueLine, {
            text: activeIssue.issue,
            startCallId: activeIssue.issueCallId,
            startSeq: activeIssue.issueSeq,
            t,
            jumping,
            onJump: jump,
          }) : null,
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
            item.status === 'in_progress' && item.issue ? h(IssueLine, {
              text: item.issue,
              startCallId: item.issueCallId,
              startSeq: item.issueSeq,
              t,
              nested: true,
              jumping,
              onJump: jump,
            }) : null,
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

    // Show the most recent turn that actually recorded work: the open turn while
    // it is running, otherwise the just-finished turn. Empty turns stay reachable
    // through the selector but must not become the default.
    function defaultTurn(turns) {
      const nonEmpty = turns.filter((turn) => turn.total > 0);
      return (nonEmpty.at(-1) ?? turns.at(-1))?.turn;
    }

    function turnLabel(turn, t) {
      return turn === 0 ? t('earlyTasks') : t('turn', { turn });
    }

    function turnDetailsLabel(turn, t) {
      return [turnLabel(turn.turn, t), t('taskTotal', { total: turn.total }), ...(turn.tasks.length > 0 ? [turn.tasks[0].content] : [])].join('\u3000');
    }

    // The rail is a scroll position, not a content list: rendering every turn
    // button makes long sessions expensive while only a small window is visible.
    const TURN_RAIL_WINDOW = 120;
    const TURN_RAIL_MARK_HEIGHT = 10;
    // Persisted per-session view state is a convenience cache, not durable data.
    // Bound it so browsing many sessions cannot grow the map forever.
    const MAX_UI_STATES = 64;

    function rememberUiState(uiStates, sessionId, value) {
      uiStates.delete(sessionId);
      uiStates.set(sessionId, value);
      while (uiStates.size > MAX_UI_STATES) {
        uiStates.delete(uiStates.keys().next().value);
      }
    }

    function TurnRail({ turns, selectedTurn, onSelect, t }) {
      const scrollerRef = React.useRef(null);
      const activeRef = React.useRef(null);
      const [preview, setPreview] = React.useState(null);
      const [railWindow, setRailWindow] = React.useState(null);
      const previewId = React.useId();
      const selectedIndex = turns.findIndex((turn) => turn.turn === selectedTurn);
      const maxWindowStart = Math.max(0, turns.length - TURN_RAIL_WINDOW);
      const autoStart = selectedIndex < 0
        ? 0
        : Math.max(0, Math.min(selectedIndex - Math.floor(TURN_RAIL_WINDOW / 2), maxWindowStart));
      // A new selection always starts from a window that contains it; scrolling
      // then moves that same window so every turn stays reachable.
      const windowStart = railWindow !== null && railWindow.selectedTurn === selectedTurn
        ? Math.max(0, Math.min(railWindow.start, maxWindowStart))
        : autoStart;
      const windowEnd = Math.min(turns.length, windowStart + TURN_RAIL_WINDOW);
      const visibleTurns = turns.slice(windowStart, windowEnd);
      React.useEffect(() => {
        const scroller = scrollerRef.current;
        const active = activeRef.current;
        if (!scroller || !active) return;
        const centered = active.offsetTop - (scroller.clientHeight - active.clientHeight) / 2;
        scroller.scrollTop = Math.max(0, Math.min(centered, scroller.scrollHeight - scroller.clientHeight));
        setRailWindow({ selectedTurn, start: autoStart });
      }, [selectedTurn, turns.length]);
      const onRailScroll = (event) => {
        setPreview(null);
        const scroller = event.currentTarget;
        const top = scroller.scrollTop;
        const bottom = top + scroller.clientHeight;
        const renderedTop = windowStart * TURN_RAIL_MARK_HEIGHT;
        const renderedBottom = windowEnd * TURN_RAIL_MARK_HEIGHT;
        let next;
        if (top < renderedTop) {
          next = Math.floor(top / TURN_RAIL_MARK_HEIGHT) - 20;
        } else if (bottom > renderedBottom) {
          next = Math.ceil(bottom / TURN_RAIL_MARK_HEIGHT) - (TURN_RAIL_WINDOW - 20);
        } else {
          return;
        }
        next = Math.max(0, Math.min(next, maxWindowStart));
        if (next === windowStart) return;
        setRailWindow((previous) => (
          previous?.selectedTurn === selectedTurn && previous.start === next
            ? previous
            : { selectedTurn, start: next }
        ));
      };
      const showPreview = (turn, element) => {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        setPreview({ item: turn, center: element.offsetTop - scroller.scrollTop + element.clientHeight / 2 });
      };
      if (turns.length < 2) return null;
      return h('nav', { className: 'todo-ledger-sidebar__turn-rail', 'aria-label': t('turnSummary'), onPointerLeave: () => setPreview(null) },
        h('div', { ref: scrollerRef, className: 'todo-ledger-sidebar__turn-rail-scroller', onScroll: onRailScroll },
          windowStart > 0
            ? h('div', {
              key: 'before',
              className: 'todo-ledger-sidebar__turn-rail-spacer',
              'aria-hidden': true,
              style: { height: `${windowStart * TURN_RAIL_MARK_HEIGHT}px` },
            })
            : null,
          visibleTurns.map((turn) => h('button', {
            key: turn.turn,
            ref: turn.turn === selectedTurn ? activeRef : undefined,
            type: 'button',
            className: 'todo-ledger-sidebar__turn-rail-mark',
            'data-active': turn.turn === selectedTurn || undefined,
            'data-preview': preview?.item.turn === turn.turn || undefined,
            'aria-current': turn.turn === selectedTurn ? 'true' : undefined,
            'aria-describedby': preview?.item.turn === turn.turn ? previewId : undefined,
            'aria-label': turnDetailsLabel(turn, t),
            onPointerMove: (event) => showPreview(turn, event.currentTarget),
            onFocus: (event) => showPreview(turn, event.currentTarget),
            onBlur: () => setPreview(null),
            onClick: () => onSelect(turn.turn),
          })),
          windowEnd < turns.length
            ? h('div', {
              key: 'after',
              className: 'todo-ledger-sidebar__turn-rail-spacer',
              'aria-hidden': true,
              style: { height: `${(turns.length - windowEnd) * TURN_RAIL_MARK_HEIGHT}px` },
            })
            : null,
        ),
        preview ? h('div', {
          id: previewId,
          role: 'tooltip',
          className: 'todo-ledger-sidebar__turn-preview',
          style: { '--turn-preview-center': `${preview.center}px` },
        },
          h('div', { className: 'todo-ledger-sidebar__turn-preview-title' },
            [turnLabel(preview.item.turn, t), t('taskTotal', { total: preview.item.total })].join('\u3000')),
          h('div', { className: 'todo-ledger-sidebar__turn-preview-task' }, preview.item.tasks[0]?.content ?? t('emptyTurn')),
        ) : null,
      );
    }

    function IssueSummary({ issue, t, jumping, onJump }) {
      const navigable = typeof issue.startCallId === 'string' && typeof issue.startSeq === 'number';
      return h(navigable ? 'button' : 'div', {
        className: `todo-ledger-sidebar__issue${navigable ? ' todo-ledger-sidebar__issue-jump' : ''}`,
        'data-active': issue.active || undefined,
        ...(navigable ? {
          type: 'button',
          'aria-label': t('jumpToIssue', { issue: issue.name }),
          'aria-busy': jumping === issue.startCallId || undefined,
          disabled: jumping !== null,
          onClick: () => { void onJump(issue); },
        } : {}),
      },
        h('span', { className: 'todo-ledger-sidebar__issue-name' }, issue.name),
      );
    }

    function TaskEntry({ item, expanded, onToggle, t, jumping, onJump }) {
      const labels = statusLabels(t);
      const active = item.issues.filter((issue) => issue.active);
      const historical = item.issues.filter((issue) => !issue.active);
      return h('li', { className: 'todo-ledger-sidebar__task', 'data-status': item.status },
        h('div', { className: 'todo-ledger-sidebar__task-row' },
          h('span', { className: 'todo-ledger-sidebar__glyph', role: 'img', 'aria-label': labels[item.status] },
            h(StateDot, { state: statusDotState[item.status] })),
          h('div', { className: 'todo-ledger-sidebar__task-main' },
            h('span', { className: 'todo-ledger-sidebar__task-content', title: item.content }, item.content),
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
              active.map((issue) => h(IssueSummary, { key: `active:${issue.name}`, issue, t, jumping, onJump })),
              historical.map((issue) => h(IssueSummary, { key: `history:${issue.name}`, issue, t, jumping, onJump })),
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
      if (!selected) return h('div', { className: 'todo-ledger-sidebar__empty' }, t('historyEmpty'));
      return h('div', { className: 'todo-ledger-sidebar__history' },
        h('div', { className: 'todo-ledger-sidebar__turn-heading' },
          h('div', { className: 'todo-ledger-sidebar__turn-selector' },
            h('span', { className: 'todo-ledger-sidebar__turn-select-value', 'aria-hidden': true },
              [turnLabel(selected.turn, t), t('taskTotal', { total: selected.total })].join('\u3000')),
            h(IconChevronDownOutlineRegular, { className: 'todo-ledger-sidebar__turn-select-chevron', size: 14, 'aria-hidden': true }),
            h('select', {
              className: 'todo-ledger-sidebar__turn-select',
              value: selectedTurn,
              'aria-label': t('turnSummary'),
              onChange: (event) => onSelect(Number(event.target.value)),
            }, [...turns].reverse().map((turn) => h('option', { key: turn.turn, value: turn.turn }, turnDetailsLabel(turn, t)))),
          ),
        ),
        h('div', { className: 'todo-ledger-sidebar__turn-meta' },
          h('div', { className: 'todo-ledger-sidebar__turn-stats' },
            h('span', null, t('taskCompleted', { completed: selected.completed })),
            h('span', null, t('taskVoided', { voided: selected.voided })),
            selected.turn === currentTurn && selected.open ? h('span', { className: 'todo-ledger-sidebar__open' }, t('openTurn')) : null,
          ),
        ),
        selected.tasks.length === 0
          ? h('div', { className: 'todo-ledger-sidebar__empty' }, t('emptyTurn'))
          : h(TaskList, { items: selected.tasks, scope: `turn:${selected.turn}`, expandActive: false, t, jumping, onJump }),
      );
    }

    function TodoSidebarSession({ useProjection, t, sessionId, openTodoStart, uiStates }) {
      const saved = uiStates.get(sessionId);
      const [selectedTurn, setSelectedTurn] = React.useState(saved?.selectedTurn);
      const projection = useProjection('todoLedger');
      const loaded = projection !== undefined;
      const turns = (projection?.turns ?? []).filter((turn) => turn.turn !== 0 || turn.total > 0);
      const currentTurn = projection?.currentTurn ?? 0;
      const { jumping, jumpFailed, jump } = useTaskJump((item) => openTodoStart(sessionId, item));
      const validSelection = turns.some((turn) => turn.turn === selectedTurn);
      const fallback = defaultTurn(turns);
      const effectiveSelection = validSelection ? selectedTurn : fallback;
      React.useEffect(() => {
        if (!validSelection && fallback !== undefined) setSelectedTurn(fallback);
      }, [validSelection, fallback]);
      React.useEffect(() => {
        rememberUiState(uiStates, sessionId, { selectedTurn });
      }, [sessionId, selectedTurn, uiStates]);
      const onJump = (item) => jump(item);
      return h('section', {
        className: 'todo-ledger-sidebar',
        'aria-label': t('sidebarTitle'),
        'aria-busy': !loaded || undefined,
      },
        h('style', null, css),
        h('div', { className: 'todo-ledger-sidebar__content' },
          h('div', {
            className: 'todo-ledger-sidebar__body',
            role: 'region',
            'aria-label': t('history'),
            tabIndex: 0,
          },
            !loaded
              ? null
              : h(HistoryView, { turns, currentTurn, selectedTurn: effectiveSelection, onSelect: setSelectedTurn, t, jumping, onJump }),
            jumpFailed ? h('div', { className: 'todo-ledger-sidebar__jump-error', role: 'alert' }, t('jumpFailed')) : null,
          ),
          loaded ? h(TurnRail, { turns, selectedTurn: effectiveSelection, onSelect: setSelectedTurn, t }) : null,
        ),
      );
    }

    function settingsFormLabels(t) {
      return {
        unavailable: t('unavailable'),
        readOnly: t('readOnly'),
        saveFailed: t('saveFailed'),
        save: t('save'),
        saving: t('saving'),
      };
    }

    /** Staged form over the `todo-ledger` namespace, using the shared settings primitives. */
    var ReminderSettingsController = class {
      form;
      store;
      constructor(scope) {
        this.form = new SettingsFormModel(scope, [settingsNumberField('reminderIntervalMs')]);
        this.store = this.form.bind(() => this.projection());
      }
      projection() {
        return {
          ...this.form.shell(),
          reminderIntervalMs: this.form.field('reminderIntervalMs'),
        };
      }
      inject() {
        return {
          hooks: { reminderSettings: this.store },
          ...this.form.actions(),
        };
      }
      dispose() {
        this.form.dispose();
      }
    };

    function TodoLedgerSettings({ t, view, useReminderSettings, save, discard, edit, resetField }) {
      const state = useReminderSettings((snapshot) => snapshot);
      if (view === 'summary') return t('settingsSummary');
      return h(SettingsForm, {
        labels: settingsFormLabels(t),
        state,
        onSave: save,
        onDiscard: discard,
        children: h(SettingsValueField, {
          id: 'plugin-config-todo-ledger-reminder-interval',
          label: t('reminderIntervalLabel'),
          hint: t('reminderIntervalHint'),
          overriddenLabel: t('overridden'),
          resetLabel: t('reset'),
          invalidLabel: t('invalidNumber'),
          numeric: true,
          disabled: !state.writable,
          ...state.reminderIntervalMs,
          onEdit: (text) => {
            edit('reminderIntervalMs', text);
          },
          onReset: () => {
            resetField('reminderIntervalMs');
          },
        }),
      });
    }

    function TodoSidebar(props) {
      return h(TodoSidebarSession, { ...props, key: props.sessionId });
    }

    function TodoSidebarTitle({ t }) {
      return h('span', null, t('sidebarTitle'));
    }

    return {
      inject: ['slots', 'locale', 'sessions', 'sidebarRightTabs', 'configForms'],
      apply(ctx) {
        const uiStates = new Map();
        const t = ctx.locale.bind(locale);
        const settingsForm = new ReminderSettingsController(ctx.configForms.get(settingsNamespace));
        ctx.effect(() => () => settingsForm.dispose(), 'todo-ledger settings form');
        ctx.effect(() => ctx.locale.register(locale, { en, zh }));
        ctx.effect(() => ctx.configForms.whileServed([settingsNamespace], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: settingsKey,
          locale,
          inject: () => settingsForm.inject(),
        }, TodoLedgerSettings))));
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
      },
    };
  },
});
