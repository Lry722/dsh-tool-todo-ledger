import test from 'node:test';
import assert from 'node:assert/strict';

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: 'fragment',
  memo: (component) => component,
  useId: () => 'id',
  useRef: (value) => ({ current: value }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: (effect) => { effect(); },
};

const primitives = {
  SettingsForm: 'SettingsForm',
  SettingsValueField: 'SettingsValueField',
  SettingsFormModel: class {
    constructor(scope, specs) {
      this.scope = scope;
      this.specs = specs;
    }
    bind(projection) {
      return { getSnapshot: projection, subscribe: () => () => {} };
    }
    shell() {
      return { writable: true, dirty: false, saving: false, failed: false };
    }
    field() {
      return { value: '60000', overridden: false, invalid: false, empty: false };
    }
    actions() {
      return {
        save: () => {},
        discard: () => {},
        edit: () => {},
        resetField: () => {},
      };
    }
    dispose() {}
  },
  settingsNumberField: (field) => ({ field }),
  StateDot: () => null,
  IconChecklistOutlineRegular: () => null,
  IconChevronDownOutlineRegular: () => null,
  IconChevronUpOutlineRegular: () => null,
};

globalThis.requestAnimationFrame = (callback) => queueMicrotask(callback);
let definition;
globalThis.window = {
  __ModuleLoader__: {
    load: (loaded) => { definition = loaded; },
  },
};
await import('../client.js');

function requireModule(name) {
  if (name === 'react') return React;
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
  throw new Error(`unexpected module: ${name}`);
}

function createContext(sessionId, instance) {
  const registrations = [];
  const loaded = [];
  const effect = (callback) => {
    const dispose = callback();
    return typeof dispose === 'function' ? dispose : () => {};
  };
  const register = (options, component) => {
    registrations.push({ ...options, component });
    return () => {};
  };
  return {
    registrations,
    loaded,
    effect,
    locale: {
      register: () => () => {},
      bind: () => (key) => key,
    },
    sessions: {
      binding: () => ({ session: { loadThrough: async (seq) => { loaded.push(seq); } } }),
    },
    sidebarRightTabs: { register: () => () => {} },
    configForms: {
      get: () => ({}),
      whileServed: (_namespaces, register) => register(),
    },
    slots: {
      _stores: instance === undefined
        ? new Map()
        : new Map([['conversation-store', { instances: new Map([[sessionId, instance]]) }]]),
      entries: (name) => name === 'conversation.session'
        ? [{
          store: 'conversation-store',
          inject: (id, actions) => ({ openView: (view, focus) => actions.openView(view, focus) }),
        }]
        : [],
      inject: (name, callback) => effect(callback),
      register,
    },
  };
}

function dockFor(ctx) {
  const { apply } = definition.factory(requireModule);
  apply(ctx);
  const dock = ctx.registrations.find((options) => options.name === 'conversation.input.dock');
  assert.ok(dock?.inject, 'conversation.input.dock must register an inject face');
  return dock.inject();
}

function renderTree(node) {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(renderTree);
  if (typeof node.type === 'function') {
    const children = node.children.length === 1 ? node.children[0] : node.children;
    return renderTree(node.type({ ...node.props, children }));
  }
  return { ...node, children: node.children.map(renderTree) };
}

function elementsOf(node) {
  if (node === null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  return [node, ...node.children.flatMap(elementsOf)];
}

function stringsOf(node) {
  if (typeof node === 'string') return [node];
  if (node === null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(stringsOf);
  return node.children.flatMap(stringsOf);
}

function sidebarFor(ctx) {
  const { apply } = definition.factory(requireModule);
  apply(ctx);
  const tab = ctx.registrations.find((options) => options.name === 'sidebar.right.pane.tab');
  assert.equal(typeof tab?.component, 'function', 'sidebar.right.pane.tab must register a component');
  const { uiStates, openTodoStart } = tab.inject();
  return {
    uiStates,
    render(useProjection) {
      return renderTree(tab.component({
        useProjection,
        t: (key) => key,
        sessionId: 'session-1',
        openTodoStart,
        uiStates,
      }));
    },
  };
}

test('a trajectory jump focuses the requested tool call through the session view', async () => {
  const calls = [];
  let viewRequest = null;
  const instance = {
    actions: {
      openView: (view, focus) => {
        calls.push([view, focus]);
        viewRequest = { view, focus };
        queueMicrotask(() => { viewRequest = null; });
      },
    },
    getSnapshot: () => ({ viewRequest }),
  };
  globalThis.document = { querySelector: (selector) => selector === '[data-trajectory-scroll]' ? {} : null };
  const ctx = createContext('session-1', instance);
  const dock = dockFor(ctx);

  assert.equal(await dock.openTodoStart('session-1', { startCallId: 'call-1', startSeq: 7 }), true);
  assert.deepEqual(ctx.loaded, [7]);
  assert.deepEqual(calls, [['trajectory', 'call-1']]);
});

test('the trajectory path stays inactive while the chat view is rendered', async () => {
  const calls = [];
  const instance = {
    actions: { openView: (...args) => calls.push(args) },
    getSnapshot: () => ({ viewRequest: null }),
  };
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const ctx = createContext('session-1', instance);
  const dock = dockFor(ctx);

  assert.equal(await dock.openTodoStart('session-1', { startCallId: 'call-1' }), false);
  assert.deepEqual(calls, []);
});

test('an unavailable session store reports failure without touching the chat view', async () => {
  globalThis.document = {
    querySelector: (selector) => selector === '[data-trajectory-scroll]' ? {} : null,
    querySelectorAll: () => [],
  };
  const ctx = createContext('session-1');
  const dock = dockFor(ctx);

  assert.equal(await dock.openTodoStart('session-1', { startCallId: 'call-1' }), false);
});

test('the sidebar renders no empty state while the projection is still loading', () => {
  const ctx = createContext('session-1');
  const sidebar = sidebarFor(ctx);

  const tree = sidebar.render(() => undefined);
  assert.ok(!stringsOf(tree).includes('historyEmpty'));
  const section = elementsOf(tree).find((element) => element.props?.className === 'todo-ledger-sidebar');
  assert.equal(section?.props['aria-busy'], true);
});

test('the sidebar renders the empty state only for a loaded empty projection', () => {
  const ctx = createContext('session-1');
  const sidebar = sidebarFor(ctx);
  const projection = () => ({ current: [], turns: [], currentTurn: 0 });

  const tree = sidebar.render(projection);
  assert.ok(stringsOf(tree).includes('historyEmpty'));
  const section = elementsOf(tree).find((element) => element.props?.className === 'todo-ledger-sidebar');
  assert.equal(section?.props['aria-busy'], undefined);
});

function turnProjection(tasks, turn = 1, open = true) {
  return {
    current: [],
    currentTurn: turn,
    turns: [{
      turn,
      startSeq: 1,
      open,
      total: tasks.length,
      completed: tasks.filter((task) => task.status === 'completed').length,
      voided: tasks.filter((task) => task.status === 'void').length,
      preview: tasks[0]?.content ?? '',
      tasks,
    }],
  };
}

test('task text and the sidebar container use distinct classes', () => {
  const ctx = createContext('session-1');
  const sidebar = sidebarFor(ctx);
  const tree = sidebar.render(() => turnProjection([
    { id: 'task-1', status: 'in_progress', content: 'Ship the fix', issues: [] },
  ]));

  const elements = elementsOf(tree);
  assert.deepEqual(
    elements.filter((element) => element.props?.className === 'todo-ledger-sidebar__content').map((element) => element.type),
    ['div'],
  );
  assert.deepEqual(
    elements.filter((element) => element.props?.className === 'todo-ledger-sidebar__task-content').map((element) => [element.type, element.children[0]]),
    [['span', 'Ship the fix']],
  );
});

test('the sidebar exposes a single turn pane without tabs', () => {
  const ctx = createContext('session-1');
  const sidebar = sidebarFor(ctx);
  const tree = sidebar.render(() => ({ current: [], turns: [], currentTurn: 0 }));
  const elements = elementsOf(tree);
  assert.equal(elements.filter((element) => element.props?.role === 'tablist').length, 0);
  assert.equal(elements.filter((element) => element.props?.role === 'tab').length, 0);
  const body = elements.find((element) => element.props?.className === 'todo-ledger-sidebar__body');
  assert.equal(body.props.role, 'region');
  assert.equal(body.props['aria-label'], 'history');
  assert.equal(body.props.tabIndex, 0);
  const section = elements.find((element) => element.props?.className === 'todo-ledger-sidebar');
  assert.equal(section?.props['aria-label'], 'sidebarTitle');
});

function manyTurns(count) {
  return Array.from({ length: count }, (_value, index) => ({
    turn: index + 1,
    total: 1,
    completed: 0,
    voided: 0,
    open: false,
    tasks: [],
  }));
}

test('the turn rail renders only a window around the selected turn', () => {
  const ctx = createContext('session-1');
  const sidebar = sidebarFor(ctx);
  sidebar.uiStates.set('session-1', { selectedTurn: 500 });
  const turns = manyTurns(500);
  const tree = sidebar.render(() => ({ current: [], turns, currentTurn: 500 }));
  const elements = elementsOf(tree);
  const marks = elements.filter((element) => element.props?.className === 'todo-ledger-sidebar__turn-rail-mark');
  const spacers = elements.filter((element) => element.props?.className === 'todo-ledger-sidebar__turn-rail-spacer');

  // The selected turn is the tail, so the window covers it.
  assert.equal(marks.length, 120);
  assert.deepEqual(spacers.map((spacer) => spacer.props.style.height), ['3800px']);
});

test('per-session UI state stays bounded while browsing sessions', () => {
  const ctx = createContext('session-1');
  const sidebar = sidebarFor(ctx);
  sidebar.uiStates.clear();
  const tab = ctx.registrations.find((options) => options.name === 'sidebar.right.pane.tab');
  for (let index = 0; index < 200; index += 1) {
    renderTree(tab.component({
      useProjection: () => ({ current: [], turns: [], currentTurn: 0 }),
      t: (key) => key,
      sessionId: `session-${index}`,
      openTodoStart: () => {},
      uiStates: sidebar.uiStates,
    }));
  }
  assert.equal(sidebar.uiStates.size, 64);
});

test('the plugin page configures the reminder interval with the shared settings form', () => {
  const ctx = createContext('session-1');
  const { apply } = definition.factory(requireModule);
  apply(ctx);
  const settings = ctx.registrations.find((options) => options.name === 'plugins.bundle.config');
  assert.equal(settings?.key, 'dsh-tool-todo-ledger');
  const face = settings.inject();
  assert.equal(settings.component({
    t: (key) => key,
    view: 'summary',
    useReminderSettings: (selector) => selector(face.hooks.reminderSettings.getSnapshot()),
  }), 'settingsSummary');

  const state = face.hooks.reminderSettings.getSnapshot();
  const tree = settings.component({
    t: (key) => key,
    view: 'page',
    useReminderSettings: (selector) => selector(state),
    ...face,
  });
  assert.equal(tree.type, 'SettingsForm');
  const field = tree.props.children;
  assert.equal(field?.type, 'SettingsValueField');
  assert.equal(field?.props.numeric, true);
  assert.equal(field?.props.value, '60000');
  assert.equal(field?.props.label, 'reminderIntervalLabel');
});
