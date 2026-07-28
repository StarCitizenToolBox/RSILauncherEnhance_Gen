const assert = require("node:assert/strict");
const test = require("node:test");

const { findLauncherMainPath, mainHashFromPath } = require("./common");

test("prefers the launcher index bundle used by RSI Launcher 2.15.2", () => {
  const selected = findLauncherMainPath([
    "\\app\\overlay\\static\\js\\index.1e614767.js",
    "\\app\\launcher\\static\\js\\main.legacy123.js",
    "\\app\\launcher\\static\\js\\index.deadbeef.js",
    "\\app\\loader\\static\\js\\index.65760705.js",
  ]);

  assert.equal(selected.normalized, "app/launcher/static/js/index.deadbeef.js");
});

test("keeps both historical main bundle layouts as fallbacks", () => {
  assert.equal(
    findLauncherMainPath(["/app/launcher/static/js/main.f3ea829e.js"])
      .normalized,
    "app/launcher/static/js/main.f3ea829e.js",
  );
  assert.equal(
    findLauncherMainPath(["/app/static/js/main.abcdef12.js"]).normalized,
    "app/static/js/main.abcdef12.js",
  );
});

test("does not select unrelated index bundles", () => {
  assert.throws(
    () =>
      findLauncherMainPath([
        "/app/loader/static/js/index.65760705.js",
        "/app/overlay/static/js/index.1e614767.js",
        "/app/guide-system/static/js/index.ad6b74a0.js",
      ]),
    /main script not found/,
  );
});

test("extracts hashes from index and main bundle names", () => {
  assert.equal(
    mainHashFromPath("app/launcher/static/js/index.deadbeef.js"),
    "deadbeef",
  );
  assert.equal(
    mainHashFromPath("app/launcher/static/js/main.f3ea829e.js"),
    "f3ea829e",
  );
  assert.equal(mainHashFromPath("app/launcher/static/js/vendor.js"), "unknown");
});
