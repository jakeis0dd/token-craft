import assert from "node:assert/strict";
import { Blob, File } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const errorSource = readFileSync(new URL("../src/importError.ts", import.meta.url), "utf8");
const errorModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(errorSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, errorModule);
const { formatImportError } = errorModule.exports;

// Exercise the real UI handlers with the same dependency-free approach as the
// existing crop tests. SDK failures and browser image operations are controlled.
const source = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ["render", "App"].map(name => ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name).getText(ast)).join("\n");
const componentJS = ts.transpileModule(component.replaceAll("import.meta.env.BASE_URL", '"/token-craft/"') + "\nglobalThis.App=App;", {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
}).outputText;

const selection = () => [{ name: "Library artwork.png", image: { url: "https://example.invalid/art.png", mime: "image/png", width: 640, height: 960 } }];
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function setup({ ready = true, pick = async () => selection() } = {}) {
  const hooks = [], requests = [], images = [], logs = [], uploads = [];
  let cursor = 0, dirty = true, tree, effects;
  const behavior = { pick, decode: async () => {}, read: () => {} };
  function canvas() {
    const draws = [];
    const context = {
      clearRect() { draws.length = 0; }, save() {}, restore() {}, beginPath() {}, clip() {}, arc() {}, rect() {}, stroke() {},
      drawImage: (image, ...geometry) => draws.push({ image, geometry }),
      getImageData: () => { behavior.read(); return { data: [0, 0, 0, 255] }; },
    };
    return { draws, getContext: () => context, addEventListener() {}, removeEventListener() {}, toBlob: callback => callback(new Blob(["PNG"])) };
  }
  const preview = canvas();
  const context = {
    SIZE: 512, PREVIEW: 320, Blob, File, formatImportError,
    startThemeSync: () => () => {}, startResponsiveActionHeight: () => () => {},
    Image: class {
      naturalWidth = 640; naturalHeight = 960;
      constructor() { images.push(this); }
      set src(value) { assert.equal(this.crossOrigin, "anonymous"); this.source = value; }
      get src() { return this.source; }
      decode() { return behavior.decode(); }
    },
    document: { createElement: () => canvas() },
    console: Object.fromEntries(["log", "warn", "error"].map(method => [method, (...args) => logs.push(args)])),
    useState: initial => {
      const index = cursor++;
      hooks[index] ??= { value: initial };
      return [hooks[index].value, value => {
        const next = typeof value === "function" ? value(hooks[index].value) : value;
        if (!Object.is(next, hooks[index].value)) { hooks[index].value = next; dirty = true; }
      }];
    },
    useRef: initial => { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useEffect: (callback, deps) => {
      const index = cursor++, previous = hooks[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        hooks[index] = { deps }; effects.push(callback);
      }
    },
    React: { createElement: (type, props, ...children) => {
      if (type === "canvas") props.ref.current = preview;
      return { type, props: props ?? {}, children: children.flat(Infinity) };
    } },
    OBR: {
      isAvailable: ready, onReady: callback => callback(),
      assets: {
        downloadImages: (...args) => { requests.push(args); return behavior.pick(...args); },
        uploadImages: async values => { uploads.push(...values); },
      },
    },
    buildImageUpload: file => {
      const builder = { name: () => builder, dpi: () => builder, offset: () => builder, build: () => ({ file }) };
      return builder;
    },
  };
  vm.runInNewContext(componentJS, context);
  function run() {
    let iterations = 0;
    while (dirty) {
      assert.ok(iterations++ < 10, "component should settle");
      cursor = 0; dirty = false; effects = [];
      tree = context.App();
      for (const effect of effects) effect();
    }
  }
  function nodes(node = tree) { return node && typeof node === "object" ? [node, ...node.children.flatMap(child => nodes(child))] : []; }
  function text(node) { return node.children.map(child => child && typeof child === "object" ? text(child) : child ?? "").join(""); }
  const find = predicate => { const node = nodes().find(predicate); assert.ok(node, "control must exist"); return node; };
  const button = label => find(n => n.type === "button" && (text(n) === label || n.props["aria-label"] === label));
  const range = label => find(n => n.type === "label" && text(n).startsWith(label)).children.find(n => n?.type === "input");
  run();
  return {
    behavior, requests, images, logs, uploads, preview, run, nodes, button, range, text,
    status: () => text(find(n => n.props.id === "existing-image-status")),
    start() { const pending = button("▧ Existing image").props.onClick(); run(); return pending; },
    async click(label) { await button(label).props.onClick(); run(); },
    changeRange(label, value) { range(label).props.onChange({ target: { value: String(value) } }); run(); },
    rename(value) { find(n => n.type === "input" && n.props.maxLength === 80).props.onChange({ target: { value } }); run(); },
    snapshot() {
      return {
        name: find(n => n.type === "input" && n.props.maxLength === 80).props.value,
        zoom: range("Zoom").props.value, border: range("Border thickness").props.value,
        noBorder: button("No Border").props["aria-pressed"], square: button("□ Square").props.className,
        size: button("3×3").props.className,
        color: find(n => n.props["aria-label"] === "Custom border color").props.value,
        draws: [...preview.draws], saved: !button("Add to Scene").props.disabled,
      };
    },
  };
}

test("immediate nearby status, exact picker arguments, and duplicate protection before/after rendering", async () => {
  const pending = deferred();
  const h = setup({ pick: () => pending.promise });
  const button = h.button("▧ Existing image");
  const first = button.props.onClick();
  const duplicate = button.props.onClick(); // Before React updates disabled.
  h.run();
  assert.equal(h.status(), "Opening Owlbear image library…");
  assert.equal(h.button("▧ Existing image").props.disabled, true);
  assert.equal(h.button("▧ Existing image").props["aria-busy"], true);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(Array.from(h.requests[0]), [false, undefined, "CHARACTER"]);
  await h.button("▧ Existing image").props.onClick();
  assert.equal(h.requests.length, 1);
  const elements = h.nodes();
  const status = elements.findIndex(n => n.props.id === "existing-image-status");
  assert.equal(elements[status].props.role, "status");
  assert.ok(status > elements.findIndex(n => n.props.className === "sources"));
  assert.ok(status < elements.findIndex(n => n.props.className === "preview"));
  pending.resolve([]); await Promise.all([first, duplicate]); h.run();
  assert.equal(h.button("▧ Existing image").props.disabled, false);
  assert.match(h.status(), /^No image selected\./);
});

test("plain-object SDK rejection is identified as a picker failure without constructing an image", async () => {
  const h = setup({ pick: () => { throw { name: "OwlbearError", code: "NOT_SUPPORTED", message: "Image picker unavailable" }; } });
  await h.start(); h.run();
  assert.equal(h.status(), "Owlbear image picker failed: name: OwlbearError; code: NOT_SUPPORTED; message: Image picker unavailable");
  assert.equal(h.images.length, 0);
  assert.equal(h.button("▧ Existing image").props.disabled, false);
  h.behavior.pick = async () => [];
  await h.start(); h.run();
  assert.match(h.status(), /^No image selected\./, "a failed request releases the lock for retry");
});

test("Existing image avoids the empty defaultSearch rejection through the installed SDK", async () => {
  const sdkModule = { exports: {} };
  const sdkSource = readFileSync(new URL("../node_modules/@owlbear-rodeo/sdk/lib/api/AssetsApi.js", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(sdkSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, sdkModule);
  // Reproduce the live host's validation boundary, using the actual SDK adapter.
  const sdk = new sdkModule.exports.default({ sendAsync: async (id, payload) => {
    assert.equal(id, "OBR_ASSETS_DOWNLOAD_IMAGES");
    assert.equal(payload.multiple, false);
    assert.equal(payload.typeHint, "CHARACTER");
    if (payload.defaultSearch === "") {
      throw { name: "ValidationError", message: '"defaultSearch" is not allowed to be empty' };
    }
    assert.equal(payload.defaultSearch, undefined, "no arbitrary search term may filter the library");
    return { images: selection() };
  } });
  await assert.rejects(sdk.downloadImages(false, "", "CHARACTER"), error => {
    assert.equal(error.name, "ValidationError");
    assert.equal(error.message, '"defaultSearch" is not allowed to be empty');
    return true;
  });
  const h = setup({ pick: (...args) => sdk.downloadImages(...args) });
  await h.start(); h.run();
  assert.equal(h.status(), "Image loaded.");
  assert.equal(h.preview.draws.length, 1);
  assert.equal(h.button("▧ Existing image").props.disabled, false);
  assert.deepEqual(h.logs, []);
});

test("standalone mode does not call the SDK", async () => {
  const h = setup({ ready: false });
  assert.equal(h.button("▧ Existing image").props.disabled, true);
  await h.start(); h.run();
  assert.equal(h.requests.length, 0);
  assert.match(h.status(), /inside Owlbear Rodeo/);
});

test("a malformed picker response is identified before attempting image loading", async () => {
  const h = setup({ pick: async () => ({ images: selection() }) });
  await h.start(); h.run();
  assert.match(h.status(), /^Owlbear image picker failed:.*invalid image selection/);
  assert.equal(h.images.length, 0);
});

test("successful import keeps the returned URL intact and updates the editor only after decoding", async () => {
  const pending = deferred(), picked = selection();
  picked[0].image.url += "?signature=synthetic-private-value";
  const h = setup({ pick: async () => picked });
  h.behavior.decode = () => pending.promise;
  const operation = h.start();
  await new Promise(resolve => setImmediate(resolve)); h.run();
  assert.equal(h.status(), "Loading selected image…");
  assert.equal(h.images[0].src, picked[0].image.url);
  assert.equal(h.preview.draws.length, 0);
  assert.equal(h.button("▧ Existing image").props.disabled, true);
  pending.resolve(); await operation; h.run();
  assert.equal(h.status(), "Image loaded.");
  assert.equal(h.snapshot().name, "Library artwork");
  assert.equal(h.preview.draws[0].image, h.images[0]);
  assert.equal(h.button("▧ Existing image").props.disabled, false);
  assert.deepEqual(h.logs, []);
  assert.ok(!h.status().includes("synthetic-private-value"));
});

for (const stage of ["picker", "decode", "canvas", "cancel", "invalid URL", "invalid name", "unsupported media"]) {
  test(`${stage}: current artwork, crop settings, unsaved edits and saved state survive`, async () => {
    const h = setup(); await h.start(); h.run();
    await h.click("□ Square"); await h.click("3×3"); await h.click("No Border");
    h.changeRange("Border thickness", 29); h.changeRange("Zoom", 2.4);
    h.rename("Edited artwork");
    const canvas = h.nodes().find(n => n.type === "canvas");
    const target = { setPointerCapture() {}, getBoundingClientRect: () => ({ width: 320 }) };
    canvas.props.onPointerDown({ currentTarget: target, pointerId: 1, clientX: 0, clientY: 0 });
    canvas.props.onPointerMove({ currentTarget: target, clientX: 12, clientY: 18 });
    canvas.props.onPointerUp(); h.run();
    for (const saved of [false, true]) {
      if (saved) await h.click("Save to Library");
      const before = h.snapshot();
      assert.equal(before.saved, saved);
      const picked = selection();
      if (stage === "invalid URL") picked[0].image.url = { url: "private" };
      if (stage === "invalid name") picked[0].name = null;
      if (stage === "unsupported media") picked[0].image.mime = "video/mp4";
      h.behavior.pick = async () => {
        if (stage === "picker") throw { code: "PICKER_FAILED", message: "Picker rejected" };
        return stage === "cancel" ? [] : picked;
      };
      h.behavior.decode = async () => { if (stage === "decode") throw { name: "EncodingError", message: "Image decoding failed" }; };
      h.behavior.read = () => { if (stage === "canvas") throw { name: "SecurityError", message: "Canvas pixel access denied" }; };
      await h.start(); h.run();
      assert.deepEqual(h.snapshot(), before);
      assert.equal(h.button("▧ Existing image").props.disabled, false);
      if (stage === "picker") assert.match(h.status(), /^Owlbear image picker failed:.*PICKER_FAILED/);
      else if (stage === "cancel") assert.match(h.status(), /^No image selected\./);
      else assert.match(h.status(), /^Selected image could not be loaded:/);
      if (stage === "decode") assert.match(h.status(), /EncodingError/);
      if (stage === "canvas") assert.match(h.status(), /SecurityError/);
      if (stage === "unsupported media") assert.match(h.status(), /Video and other media formats are not supported/);
    }
  });
}

test("native Error, DOMException, numeric codes and primitive rejections remain useful", () => {
  assert.equal(formatImportError(new Error("Request failed")), "name: Error; message: Request failed");
  assert.match(formatImportError(new DOMException("Image decoding failed", "EncodingError")), /name: EncodingError; code: 0; message: Image decoding failed/);
  assert.equal(formatImportError({ code: 403, message: "Not permitted" }), "code: 403; message: Not permitted");
  assert.equal(formatImportError("Library unavailable"), "Library unavailable");
  assert.equal(formatImportError({ code: "OBR_ASSETS_DOWNLOAD_IMAGES_ERROR", message: "OBR_ASSETS_DOWNLOAD_IMAGES is unavailable" }), "code: OBR_ASSETS_DOWNLOAD_IMAGES_ERROR; message: OBR_ASSETS_DOWNLOAD_IMAGES is unavailable");
  for (const unknown of [null, undefined, {}, "[object Object]", { message: {} }, { arbitrary: "private value" }]) {
    const kind = unknown === null ? "null" : typeof unknown;
    assert.equal(formatImportError(unknown), `No readable error details were provided (${kind} rejection).`);
  }
});

for (const privateDetail of [
  "Failed at https://user:pass@example.invalid/image.png?signature=private",
  "Failed at //example.invalid/image.png", "Failed at blob:https://example.invalid/private",
  "Failed at data:image/png;base64,private", "Failed at /image.png?X-Amz-Signature=private",
  "Authorization Bearer private", "Cookie session private", "access_token private",
  "password private", 'credentials {"value":"private"}', "customCredential=private",
  "abcdefghijklmnopqrstuvwx123456789", "first.second.third", "https%3A%2F%2Fexample.invalid%2Fprivate", "x".repeat(1000),
]) {
  test(`private error field is omitted (${privateDetail.slice(0, 16)})`, () => {
    const message = formatImportError({ name: "OwlbearError", code: "FAILED", message: privateDetail, url: "private", cookies: "private" });
    assert.equal(message, "name: OwlbearError; code: FAILED; message: [Sensitive details omitted]");
    assert.ok(!message.includes("private"));
  });
}

test("error objects are never dumped or stringified, including throwing properties and circular data", () => {
  const error = { code: "FAILED", toString() { throw new Error("Do not stringify"); } };
  error.self = error;
  Object.defineProperty(error, "message", { get() { throw new Error("Private getter"); } });
  assert.equal(formatImportError(error), "code: FAILED");
});

test("UI failures omit private details and never log the rejection", async () => {
  const h = setup({ pick: async () => { throw { code: "FORBIDDEN", message: "Denied https://example.invalid/private?token=synthetic-secret", cookies: "synthetic-cookie" }; } });
  await h.start(); h.run();
  assert.equal(h.status(), "Owlbear image picker failed: code: FORBIDDEN; message: [Sensitive details omitted]");
  assert.deepEqual(h.logs, []);
});

for (const [label, rejection, expected] of [
  ["error object", { error: { code: "UNAVAILABLE", message: "Library unavailable" } }, "code: UNAVAILABLE; message: Library unavailable"],
  ["error string", { error: "Library unavailable" }, "Library unavailable"],
  ["errors array", { errors: [{ message: "Library unavailable" }, "Try again"] }, "message: Library unavailable; Try again"],
  ["issues array", { issues: [{ code: "too_small", path: ["defaultSearch"], message: "Search is empty" }] }, "code: too_small; message: Search is empty; parameter: defaultSearch"],
  ["cause object", { cause: { name: "PickerError", message: "Library unavailable" } }, "name: PickerError; message: Library unavailable"],
  ["nested wrappers", { error: { cause: { errors: ["Library unavailable"] } } }, "Library unavailable"],
  ["root array", ["Library unavailable", { code: 403 }], "Library unavailable; code: 403"],
  ["standard Error cause", new Error("Picker failed", { cause: new Error("Library unavailable") }), "name: Error; message: Picker failed; message: Library unavailable"],
]) {
  test(`formats ${label} without dumping the rejection`, () => {
    assert.equal(formatImportError(rejection), expected);
  });
}

test("all recognized validation parameters are shown and private path segments and values are omitted", () => {
  const rejection = { issues: [
    { path: ["private-user-id", "multiple"], code: "invalid_type", received: "synthetic-private-value" },
    { path: "defaultSearch", message: "Search is empty" },
    { path: ["https://example.invalid/private?token=private", "typeHint"], message: "Unknown category" },
  ] };
  assert.equal(formatImportError(rejection), "code: invalid_type; parameter: multiple; message: Search is empty; parameter: defaultSearch; message: Unknown category; parameter: typeHint");
  assert.ok(!formatImportError(rejection).includes("private"));
});

test("cycle detection handles standard Error causes, object wrappers and self-referencing arrays", () => {
  const error = new Error("Picker failed"); error.cause = error;
  assert.equal(formatImportError(error), "name: Error; message: Picker failed");
  const object = { message: "Picker failed" }; object.error = object; object.cause = object;
  assert.equal(formatImportError(object), "message: Picker failed");
  const array = ["Picker failed"]; array.push(array);
  assert.equal(formatImportError(array), "Picker failed");
});

test("bounds recursion depth and array traversal while retaining reachable diagnostics", () => {
  let deep = { message: "Unreachable detail" };
  for (let index = 0; index < 100; index++) deep = { cause: deep };
  assert.equal(formatImportError(deep), "No readable error details were provided (object rejection).");
  const values = ["First failure", "Second failure", "Third failure"];
  const fourth = { get message() { assert.fail("entries beyond the array limit must not be visited"); } };
  const input = [...values, fourth, ...Array(1000).fill(fourth)];
  assert.equal(formatImportError(input), values.join("; "));
  assert.equal(formatImportError({ message: "Reachable detail", cause: deep }), "message: Reachable detail");
});

test("bounds the total traversal work for branching nested errors", () => {
  let reads = 0;
  function branch(depth) {
    if (depth === 0) return {};
    return Object.fromEntries(["error", "errors", "issues", "cause"].map(field => [field, branch(depth - 1)]));
  }
  const tree = branch(5);
  function count(value) {
    Object.defineProperty(value, "message", { get() { reads++; return undefined; } });
    for (const nested of Object.values(value)) count(nested);
  }
  count(tree);
  assert.equal(formatImportError(tree), "No readable error details were provided (object rejection).");
  assert.ok(reads <= 24, "visited objects must stay within the global node budget");
});

test("bounds combined output length after filtering every diagnostic field", () => {
  const message = "The image library could not be opened. ".repeat(5);
  const rejection = { errors: Array.from({ length: 3 }, (_, index) => ({ message: `${index} ${message}` })) };
  const output = formatImportError(rejection);
  assert.ok(output.length <= 600);
  assert.ok(output.endsWith("…"));
});

test("every nested wrapper and root arrays apply the same privacy filtering", () => {
  const sensitive = [
    "https://example.invalid/image.png?signature=synthetic-private-value",
    "Authorization Bearer synthetic-private-value", "Cookie synthetic-private-value",
    "credentials synthetic-private-value", "access_token synthetic-private-value",
  ];
  for (const message of sensitive) {
    for (const wrapper of [value => ({ error: value }), value => ({ errors: [value] }), value => ({ issues: [value] }), value => ({ cause: value }), value => [value]]) {
      const result = formatImportError(wrapper({ code: "FAILED", message, url: message, data: message }));
      assert.equal(result, "code: FAILED; message: [Sensitive details omitted]");
      assert.ok(!result.includes("synthetic-private-value"));
    }
    assert.equal(formatImportError({ error: message }), "[Sensitive details omitted]");
  }
});

test("empty and unreadable rejections identify only their safe value type", () => {
  for (const [input, kind] of [[{}, "object"], [[], "array"], [null, "null"], [undefined, "undefined"], [false, "boolean"], ["", "string"], [Symbol("synthetic-private-value"), "symbol"], [() => {}, "function"], [NaN, "number"], [1n, "bigint"]]) {
    assert.equal(formatImportError(input), `No readable error details were provided (${kind} rejection).`);
  }
  const revocable = Proxy.revocable({}, {}); revocable.revoke();
  assert.equal(formatImportError(revocable.proxy), "No readable error details were provided (object rejection).");
});

test("nested getter failures do not prevent sibling diagnostic fields from being shown", () => {
  const rejection = { cause: { message: "Library unavailable" } };
  Object.defineProperty(rejection, "error", { get() { throw new Error("synthetic-private-value"); } });
  assert.equal(formatImportError(rejection), "message: Library unavailable");
});

test("the picker UI now shows a nested validation rejection near the button", async () => {
  const h = setup({ pick: async () => { throw { error: { issues: [{ code: "invalid_type", path: ["typeHint"], message: "Unknown category" }] } }; } });
  await h.start(); h.run();
  assert.equal(h.status(), "Owlbear image picker failed: code: invalid_type; message: Unknown category; parameter: typeHint");
  assert.equal(h.images.length, 0);
  assert.equal(h.button("▧ Existing image").props.disabled, false);
  assert.deepEqual(h.logs, []);
});
