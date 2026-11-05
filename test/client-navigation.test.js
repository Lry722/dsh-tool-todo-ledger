import test from 'node:test';
import assert from 'node:assert/strict';

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: 'fragment',
  memo: (component) => component,
  useId: () => 'id',
  useRef: (value) => ({ current: value }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {},
};

const primitives = {
  Switch: () => null,
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
  const effect = (callback) => {
    const dispose = callback();
    return typeof dispose === 'function' ? dispose : () => {};
  };
  const register = (options) => {
    registrations.push(options);
    return () => {};
  };
  return {
    registrations,
    effect,
    locale: {
      register: () => () => {},
      bind: () => (key) => key,
    },
    configForms: {
      get: () => ({ set: () => true }),
      whileServed: (_namespaces, callback) => callback(),
    },
    sessions: {
      binding: () => ({ session: { loadThrough: async () => {} } }),
    },
    sidebarRightTabs: { register: () => () => {} },
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

  assert.equal(await dock.openTodoStart('session-1', { startCallId: 'call-1' }), true);
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
