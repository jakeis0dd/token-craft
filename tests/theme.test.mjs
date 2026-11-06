import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/theme.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const light = {
  mode: "LIGHT",
  background: { default: "#f4f3f6", paper: "#ffffff" },
  text: { primary: "rgba(0, 0, 0, 0.87)", secondary: "rgba(0, 0, 0, 0.6)", disabled: "rgba(0, 0, 0, 0.38)" },
  primary: { main: "#6200ee", dark: "#4500a6", light: "#9d46ff", contrastText: "#ffffff" },
};
const dark = { ...light, mode: "DARK" };

function setup({ available = true, ready = true, getTheme = () => light, subscribe, failReady = false } = {}) {
  let listener, readyCallback;
  const state = { reads: 0, subscriptions: 0, unsubscribed: false, warnings: [] };
  const properties = new Map();
  const root = { dataset: {}, style: { setProperty: (key, value) => properties.set(key, value) } };
  const timers = new Map();
  let nextTimer = 0;
  const sdk = {
    isAvailable: available,
    onReady: callback => {
      if (failReady) throw new Error("SDK unavailable");
      readyCallback = callback;
      if (ready) callback();
    },
    theme: {
      getTheme: async () => { state.reads++; return getTheme(); },
      onChange: callback => {
        state.subscriptions++;
        if (subscribe) subscribe();
        listener = callback;
        return () => { state.unsubscribed = true; listener = undefined; };
      },
    },
  };
  const context = {
    exports: {},
    document: { documentElement: root },
    require: name => { assert.equal(name, "@owlbear-rodeo/sdk"); return { default: sdk }; },
    setTimeout: (callback, delay) => {
      assert.equal(delay, 1500);
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: id => timers.delete(id),
    console: { warn: (...args) => state.warnings.push(args) },
  };
  vm.runInNewContext(outputText, context);
  const cleanup = context.exports.startThemeSync();
  return {
    root, properties, state, timers, cleanup,
    change: theme => listener?.(theme),
    ready: () => readyCallback?.(),
    expire: () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } },
  };
}

test("reads the initial native light palette and releases the initialization surface", async () => {
  const h = setup();
  assert.equal(h.root.dataset.themeReady, undefined);
  await flush();
  assert.equal(h.root.dataset.theme, "light");
  assert.equal(h.root.style.colorScheme, "light");
  assert.equal(h.root.dataset.themeReady, "true");
  assert.equal(h.properties.get("--obr-background"), light.background.default);
  assert.equal(h.properties.get("--obr-paper"), light.background.paper);
  assert.equal(h.properties.get("--obr-text"), light.text.primary);
  assert.equal(h.properties.get("--obr-primary"), light.primary.main);
  assert.equal(h.properties.get("--obr-primary-text"), light.primary.contrastText);
  assert.equal(h.state.reads, 1);
  assert.equal(h.state.subscriptions, 1);
  assert.equal(h.timers.size, 0);
  h.cleanup();
});

test("detects initial dark mode and responds synchronously to live theme changes", async () => {
  const h = setup({ getTheme: () => dark });
  await flush();
  assert.equal(h.root.dataset.theme, "dark");
  assert.equal(h.root.style.colorScheme, "dark");
  h.change(light);
  assert.equal(h.root.dataset.theme, "light");
  h.change(dark);
  assert.equal(h.root.dataset.theme, "dark");
  assert.equal(h.state.reads, 1, "live changes should not poll or reread the SDK");
  h.cleanup();
});

test("a delayed initial response cannot override the latest theme event", async () => {
  const pending = deferred();
  const h = setup({ getTheme: () => pending.promise });
  h.change(dark);
  h.change(light);
  pending.resolve(dark); await flush();
  assert.equal(h.root.dataset.theme, "light");
  assert.equal(h.timers.size, 0);
  h.cleanup();
});

test("a failed initial read cannot replace an already received native theme", async () => {
  const pending = deferred();
  const h = setup({ getTheme: () => pending.promise });
  h.change(light);
  pending.reject(new Error("late failure")); await flush();
  assert.equal(h.root.dataset.theme, "light");
  assert.equal(h.state.warnings.length, 1);
  h.cleanup();
});

test("a failed theme read falls back to visible dark mode and later events recover", async () => {
  const h = setup({ getTheme: () => { throw new Error("theme unavailable"); } });
  await flush();
  assert.equal(h.root.dataset.theme, "dark");
  assert.equal(h.root.dataset.themeReady, "true");
  assert.equal(h.timers.size, 0);
  h.change(light);
  assert.equal(h.root.dataset.theme, "light");
  h.cleanup();
});

test("a stalled theme query reaches the deadline and can still resolve later", async () => {
  const pending = deferred();
  const h = setup({ getTheme: () => pending.promise });
  h.expire();
  assert.equal(h.root.dataset.theme, "dark");
  assert.equal(h.root.dataset.themeReady, "true");
  pending.resolve(light); await flush();
  assert.equal(h.root.dataset.theme, "light");
  h.cleanup();
});

test("the fallback deadline also covers SDK readiness without a handshake", async () => {
  const h = setup({ ready: false });
  assert.equal(h.state.reads, 0);
  h.expire();
  assert.equal(h.root.dataset.theme, "dark");
  assert.equal(h.root.dataset.themeReady, "true");
  h.ready(); await flush();
  assert.equal(h.root.dataset.theme, "light");
  h.cleanup();
});

test("readiness and subscription exceptions reveal the fallback safely", async () => {
  for (const options of [
    { failReady: true },
    { subscribe: () => { throw new Error("subscription unavailable"); } },
  ]) {
    const h = setup(options);
    await flush();
    assert.equal(h.root.dataset.theme, "dark");
    assert.equal(h.root.dataset.themeReady, "true");
    assert.equal(h.timers.size, 0);
    h.cleanup();
  }
});

test("standalone mode uses dark immediately without SDK calls or a timer", () => {
  const h = setup({ available: false });
  assert.equal(h.root.dataset.theme, "dark");
  assert.equal(h.root.style.colorScheme, "dark");
  assert.equal(h.root.dataset.themeReady, "true");
  assert.equal(h.state.reads, 0);
  assert.equal(h.state.subscriptions, 0);
  assert.equal(h.timers.size, 0);
  h.cleanup();
});

test("cleanup unsubscribes and discards pending reads and further events", async () => {
  const pending = deferred();
  const h = setup({ getTheme: () => pending.promise });
  h.cleanup();
  assert.equal(h.state.unsubscribed, true);
  assert.equal(h.timers.size, 0);
  assert.equal(h.root.dataset.themeReady, "true");
  const snapshot = JSON.stringify(h.root);
  pending.resolve(light);
  h.change(light); await flush();
  assert.equal(JSON.stringify(h.root), snapshot);
  assert.equal(h.properties.size, 0);
});

test("cleanup before SDK readiness prevents late subscription and theme reads", async () => {
  const h = setup({ ready: false });
  h.cleanup();
  h.ready(); await flush();
  assert.equal(h.state.subscriptions, 0);
  assert.equal(h.state.reads, 0);
  assert.equal(h.timers.size, 0);
});

test("corrects low-contrast native accent text without changing the accent fill", async () => {
  for (const [main, contrastText, expected] of [
    ["#bb99ff", "#ffffff", "#000000"],
    ["#111", "#000000", "#ffffff"],
    ["rgb(250, 250, 250)", "rgba(0, 0, 0, 0.1)", "#000000"],
    ["#ffffff", "rgba(0, 0, 0, 0.87)", "rgba(0, 0, 0, 0.87)"],
  ]) {
    const theme = { ...light, primary: { ...light.primary, main, contrastText } };
    const h = setup({ getTheme: () => theme });
    await flush();
    assert.equal(h.properties.get("--obr-primary"), main);
    assert.equal(h.properties.get("--obr-primary-text"), expected);
    h.cleanup();
  }
});

test("dark enabled button text and status text meet 4.5:1 contrast", () => {
  const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
  const declarations = new Map([...css.match(/^:root \{([^}]+)\}/)[1].matchAll(/(--[\w-]+):\s*(#[\da-f]{6})/gi)].map(m => [m[1], m[2]]));
  const lum = color => color.slice(1).match(/../g).map(c => parseInt(c, 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  for (const [foreground, background] of [
    ["--button-text", "--button-bg"], ["--selected-text", "--selected-bg"],
    ["--primary-text", "--primary-bg"], ["--primary-hover-text", "--primary-hover-bg"],
    ["--status-text", "--app-bg"],
  ]) {
    const a = lum(declarations.get(foreground)), b = lum(declarations.get(background));
    assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, foreground);
  }
});
