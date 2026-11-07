import assert from "node:assert/strict";
import { Blob, File } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual component handlers and shared renderer without adding a
// DOM/test dependency. Real PNG pixels are also checked in a local browser.
const source = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ["render", "App"].map(name => ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name).getText(ast));
// Supply the base URL that Vite normally substitutes in the browser bundle.
const componentSource = functions.join("\n").replaceAll("import.meta.env.BASE_URL", '"/token-craft/"');
const { outputText } = ts.transpileModule(componentSource + "\nglobalThis.App = App;", {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
});

function canvas() {
  const calls = [];
  const context = {
    calls,
    clearRect: () => { calls.length = 0; },
    save() {}, restore() {}, beginPath() {}, clip() {},
    arc: (...args) => calls.push({ type: "arc", args }),
    rect: (...args) => calls.push({ type: "rect", args }),
    drawImage: (_image, x, y, width, height) => calls.push({ type: "image", x, y, width, height }),
    stroke: () => calls.push({ type: "stroke", color: context.strokeStyle, width: context.lineWidth }),
    getImageData: () => ({ data: [0, 0, 0, 255] }),
  };
  return {
    context, width: 0, height: 0,
    getContext: () => context,
    addEventListener() {}, removeEventListener() {},
    toBlob: callback => callback(new Blob(["test export"], { type: "image/png" })),
  };
}

function setup() {
  const hooks = [];
  let cursor = 0, dirty = true, tree, effects = [];
  const preview = canvas(), exports = [], uploads = [], items = [], snaps = [];
  const context = {
    SIZE: 512, PREVIEW: 320, Blob, File,
    Image: class { naturalWidth = 960; naturalHeight = 640; async decode() {} },
    URL: { createObjectURL: () => "test://art", revokeObjectURL() {} },
    startThemeSync: () => () => {}, startResponsiveActionHeight: () => () => {},
    useState: initial => {
      const index = cursor++;
      hooks[index] ??= { value: initial };
      return [hooks[index].value, value => {
        const next = typeof value === "function" ? value(hooks[index].value) : value;
        if (!Object.is(next, hooks[index].value)) { hooks[index].value = next; dirty = true; }
      }];
    },
    useRef: initial => {
      const index = cursor++;
      hooks[index] ??= { current: initial };
      return hooks[index];
    },
    useEffect: (callback, deps) => {
      const index = cursor++;
      const previous = hooks[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        hooks[index] = { deps };
        effects.push(callback);
      }
    },
    React: { createElement: (type, props, ...children) => {
      if (type === "canvas") props.ref.current = preview;
      if (type === "input" && props.ref) props.ref.current = { click() {} };
      return { type, props: props ?? {}, children: children.flat(Infinity) };
    } },
    document: { createElement: () => {
      const output = canvas();
      const original = output.toBlob;
      output.toBlob = callback => {
        exports.push({ width: output.width, height: output.height, calls: [...output.context.calls] });
        original(callback);
      };
      return output;
    } },
    buildImageUpload: file => {
      const upload = { file, grid: {} };
      return {
        name(value) { upload.name = value; return this; },
        dpi(value) { upload.grid.dpi = value; return this; },
        offset(value) { upload.grid.offset = value; return this; },
        build() { return upload; },
      };
    },
    buildImage: (image, grid) => {
      const item = { image, grid };
      return {
        name(value) { item.name = value; return this; },
        layer(value) { item.layer = value; return this; },
        position(value) { item.position = value; return this; },
        build() { return item; },
      };
    },
    OBR: {
      isAvailable: true, onReady: callback => callback(),
      assets: {
        uploadImages: async (values, type) => { assert.equal(type, "CHARACTER"); uploads.push(...values); },
        downloadImages: async () => [{ name: "Saved token", image: { width: 512, height: 512, mime: "image/png", url: "https://example.invalid/token.png" } }],
      },
      viewport: { getWidth: async () => 1200, getHeight: async () => 800, inverseTransformPoint: async p => p },
      scene: {
        isReady: async () => true,
        grid: { getType: async () => "SQUARE", snapPosition: async (point, sensitivity, corners, center) => {
          snaps.push({ sensitivity, corners, center }); return point;
        } },
        items: { addItems: async values => { items.push(...values); } },
      },
    },
  };
  vm.runInNewContext(outputText, context);
  function run() {
    let iterations = 0;
    while (dirty) {
      assert.ok(iterations++ < 10, "component should settle");
      dirty = false; cursor = 0; effects = [];
      tree = context.App();
      for (const callback of effects) callback();
    }
  }
  function nodes(node = tree) {
    return node && typeof node === "object" ? [node, ...node.children.flatMap(child => nodes(child))] : [];
  }
  function text(node) { return node.children.map(child => typeof child === "object" && child ? text(child) : child ?? "").join(""); }
  const find = predicate => { const node = nodes().find(predicate); assert.ok(node, "control must exist"); return node; };
  const button = label => find(n => n.type === "button" && (n.props["aria-label"] === label || text(n) === label));
  const range = label => find(n => n.type === "label" && text(n).startsWith(label)).children.find(n => n?.type === "input");
  run();
  return {
    preview, exports, uploads, items, snaps, button, range, nodes,
    picker: () => find(n => n.props["aria-label"] === "Custom border color"),
    async click(label) { await button(label).props.onClick(); run(); },
    async changeRange(label, value) { range(label).props.onChange({ target: { value: String(value) } }); run(); },
    async customColor(value) { find(n => n.props["aria-label"] === "Custom border color").props.onChange({ target: { value } }); run(); },
    async load() {
      await find(n => n.type === "input" && n.props.type === "file").props.onChange({ target: { files: [new File(["image"], "art.png", { type: "image/png" })], value: "art.png" } });
      run();
    },
  };
}

function assertFullCrop(calls, shape, size) {
  assert.equal(calls.filter(c => c.type === "stroke").length, 0);
  const path = calls.find(c => c.type === (shape === "circle" ? "arc" : "rect"));
  assert.ok(path);
  if (shape === "circle") assert.deepEqual(path.args.slice(0, 3), [size / 2, size / 2, size / 2]);
  else assert.deepEqual(path.args, [0, 0, size, size]);
  const image = calls.find(c => c.type === "image");
  assert.ok(image.x <= 0 && image.y <= 0);
  assert.ok(image.x + image.width >= size && image.y + image.height >= size);
}

test("No Border replaces only the black preset and keeps the native custom picker", () => {
  const h = setup();
  const presets = h.nodes().filter(n => n.type === "button" && /^#/.test(n.props["aria-label"] ?? ""));
  assert.deepEqual(presets.map(n => n.props["aria-label"]), ["#e45c5c", "#48b878", "#4c95ef", "#f5c84b"]);
  assert.equal(h.button("No Border").props["aria-pressed"], false);
  assert.equal(h.picker().props.type, "color");
  assert.equal(h.picker().props.value, "#f5c84b");
});

for (const shape of ["circle", "square"]) {
  test(`${shape}: borderless preview/export fills the entire crop and restores stored thickness`, async () => {
    const h = setup(); await h.load();
    if (shape === "square") await h.click("□ Square");
    await h.changeRange("Border thickness", 36);
    await h.click("No Border");
    assert.equal(h.button("No Border").props["aria-pressed"], true);
    assert.equal(h.range("Border thickness").props.value, 36);
    assertFullCrop(h.preview.context.calls, shape, 320);
    await h.click("Save to Library");
    const output = h.exports.at(-1);
    assert.equal(output.width, 512); assert.equal(output.height, 512);
    assertFullCrop(output.calls, shape, 512);
    await h.click("#e45c5c");
    assert.equal(h.range("Border thickness").props.value, 36);
    assert.equal(h.button("No Border").props["aria-pressed"], false);
    const stroke = h.preview.context.calls.find(c => c.type === "stroke");
    assert.equal(stroke.color, "#e45c5c"); assert.equal(stroke.width, 36 * 320 / 512);
  });
}

test("changing No Border invalidates the saved token even when thickness is already zero", async () => {
  const h = setup(); await h.load();
  await h.changeRange("Border thickness", 0);
  await h.click("Save to Library");
  assert.equal(h.button("Add to Scene").props.disabled, false);
  await h.click("No Border");
  assert.equal(h.button("Add to Scene").props.disabled, true);
  await h.click("Save to Library");
  assert.equal(h.button("Add to Scene").props.disabled, false);
  await h.click("#f5c84b");
  assert.equal(h.button("Add to Scene").props.disabled, true);
});

test("custom colors, including black, exit No Border without losing the previous thickness", async () => {
  const h = setup(); await h.load();
  await h.changeRange("Border thickness", 29);
  await h.customColor("#247bad");
  await h.click("No Border");
  assert.equal(h.picker().props.value, "#247bad");
  await h.customColor("#15191f");
  assert.equal(h.button("No Border").props["aria-pressed"], false);
  assert.equal(h.range("Border thickness").props.value, 29);
  const stroke = h.preview.context.calls.find(c => c.type === "stroke");
  assert.equal(stroke.color, "#15191f"); assert.equal(stroke.width, 29 * 320 / 512);
});

test("adjusting remembered thickness while borderless leaves the preview full-size", async () => {
  const h = setup(); await h.load(); await h.click("No Border");
  await h.changeRange("Border thickness", 31);
  assertFullCrop(h.preview.context.calls, "circle", 320);
  await h.click("#48b878");
  assert.equal(h.preview.context.calls.find(c => c.type === "stroke").width, 31 * 320 / 512);
});

for (const shape of ["circle", "square"]) for (const size of [1, 2, 3, 4]) {
  test(`${shape} ${size}×${size}: saves a full borderless crop and retains scene grid configuration`, async () => {
    const h = setup(); await h.load();
    if (shape === "square") await h.click("□ Square");
    await h.click(`${size}×${size}`);
    await h.click("No Border");
    await h.click("Save to Library");
    assertFullCrop(h.exports.at(-1).calls, shape, 512);
    assert.equal(h.uploads[0].file.type, "image/png");
    assert.equal(h.uploads[0].grid.dpi, 512 / size);
    assert.equal(h.uploads[0].grid.offset.x, 256);
    await h.click("Add to Scene");
    assert.equal(h.items.length, 1);
    assert.equal(h.items[0].layer, "CHARACTER");
    assert.equal(h.items[0].grid.dpi, 512 / size);
    assert.equal(h.items[0].grid.offset.x, 256);
    assert.equal(h.items[0].grid.offset.y, 256);
    assert.equal(h.snaps[0].corners, size % 2 === 0);
    assert.equal(h.snaps[0].center, size % 2 !== 0);
  });
}
