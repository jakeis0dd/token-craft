import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/responsiveHeight.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Fake SDK and timers keep lifecycle/race checks deterministic, without a room.
function setup({ initialOpen = true, getHeight, setHeight, isOpen } = {}) {
  let listener;
  let nextTimer = 0;
  const timers = new Map();
  const state = { height: 1000, reads: 0, writes: [], unsubscribed: false, warnings: [] };
  const sdk = {
    viewport: { getHeight: async () => {
      state.reads++;
      return getHeight ? getHeight() : state.height;
    } },
    action: {
      isOpen: async () => isOpen ? isOpen() : initialOpen,
      setHeight: async height => {
        state.writes.push(height);
        if (setHeight) await setHeight(height);
      },
      onOpenChange: callback => {
        listener = callback;
        return () => { listener = undefined; state.unsubscribed = true; };
      },
    },
  };
  const context = {
    exports: {},
    require: name => {
      assert.equal(name, "@owlbear-rodeo/sdk");
      return { default: sdk };
    },
    setInterval: (callback, delay) => {
      assert.equal(delay, 750);
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    },
    clearInterval: id => timers.delete(id),
    console: { warn: (...args) => state.warnings.push(args) },
  };
  vm.runInNewContext(outputText, context);
  const cleanup = context.exports.startResponsiveActionHeight();
  return {
    state, timers, cleanup,
    open: value => listener?.(value),
    tick: () => { for (const callback of timers.values()) callback(); },
  };
}

test("sizes on opening, follows smaller/larger host heights and skips unchanged heights", async () => {
  const h = setup();
  await flush();
  assert.deepEqual(h.state.writes, [1000]);
  assert.equal(h.timers.size, 1);
  h.tick(); await flush();
  assert.deepEqual(h.state.writes, [1000]);
  h.state.height = 550;
  h.tick(); await flush();
  h.state.height = 1400;
  h.tick(); await flush();
  assert.deepEqual(h.state.writes, [1000, 550, 1400]);
  h.cleanup();
});

test("polls only while open, refreshes on reopening and cleans up subscriptions", async () => {
  const h = setup({ initialOpen: false });
  await flush();
  assert.equal(h.state.reads, 0);
  assert.equal(h.timers.size, 0);
  h.open(true); await flush();
  h.open(true); await flush();
  assert.equal(h.timers.size, 1);
  assert.deepEqual(h.state.writes, [1000]);
  h.open(false);
  assert.equal(h.timers.size, 0);
  h.tick(); await flush();
  assert.equal(h.state.reads, 1);
  h.open(true); await flush();
  assert.deepEqual(h.state.writes, [1000, 1000]);
  h.cleanup();
  assert.equal(h.timers.size, 0);
  assert.equal(h.state.unsubscribed, true);
  h.open(true); h.tick(); await flush();
  assert.equal(h.state.reads, 2);
});

test("serializes slow setHeight calls, including a close/reopen while pending", async () => {
  const pending = deferred();
  let active = 0;
  let maxActive = 0;
  const h = setup({ setHeight: async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await pending.promise;
    active--;
  } });
  await flush();
  h.tick(); h.tick();
  h.open(false); h.open(true);
  h.state.height = 700;
  h.tick(); await flush();
  assert.equal(h.state.reads, 1);
  assert.deepEqual(h.state.writes, [1000]);
  pending.resolve(); await flush();
  assert.deepEqual(h.state.writes, [1000, 700]);
  assert.equal(maxActive, 1);
  h.cleanup();
});

test("discards a viewport measurement from an earlier opening", async () => {
  const pending = deferred();
  let first = true;
  const h = setup({ getHeight: () => {
    if (first) { first = false; return pending.promise; }
    return 600;
  } });
  await flush();
  h.tick(); h.tick();
  assert.equal(h.state.reads, 1);
  h.open(false); h.open(true);
  pending.resolve(1400); await flush();
  assert.deepEqual(h.state.writes, [600]);
  h.cleanup();
});

test("cleanup or closing prevents a pending measurement from resizing the action", async () => {
  for (const dispose of [false, true]) {
    const pending = deferred();
    const h = setup({ getHeight: () => pending.promise });
    await flush();
    if (dispose) h.cleanup(); else h.open(false);
    pending.resolve(1000); await flush();
    assert.deepEqual(h.state.writes, []);
    assert.equal(h.timers.size, 0);
    if (!dispose) h.cleanup();
  }
});

test("newer open events take precedence over a delayed initial isOpen query", async () => {
  const pending = deferred();
  const h = setup({ isOpen: () => pending.promise });
  h.open(false);
  pending.resolve(true); await flush();
  assert.equal(h.timers.size, 0);
  assert.equal(h.state.reads, 0);
  h.open(true); await flush();
  assert.deepEqual(h.state.writes, [1000]);
  h.cleanup();
});

test("ignores invalid sizes and retries SDK failures without losing the current size", async () => {
  let height = NaN;
  let failWrite = true;
  const h = setup({
    getHeight: () => { if (height === "error") throw new Error("viewport unavailable"); return height; },
    setHeight: () => { if (failWrite) throw new Error("resize failed"); },
  });
  await flush();
  for (height of [Infinity, 0, -20]) { h.tick(); await flush(); }
  assert.deepEqual(h.state.writes, []);
  height = "error";
  h.tick(); await flush();
  height = 900;
  h.tick(); await flush();
  failWrite = false;
  h.tick(); await flush();
  h.tick(); await flush();
  assert.deepEqual(h.state.writes, [900, 900]);
  assert.equal(h.state.warnings.length, 2);
  h.cleanup();
});

test("recovers through open events if the initial open-state query fails", async () => {
  const h = setup({ isOpen: () => { throw new Error("action unavailable"); } });
  await flush();
  assert.equal(h.timers.size, 0);
  assert.equal(h.state.warnings.length, 1);
  h.open(true); await flush();
  assert.deepEqual(h.state.writes, [1000]);
  h.cleanup();
});
