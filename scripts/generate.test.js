const assert = require("node:assert/strict");
const test = require("node:test");

const {
  discoverLauncherDownload,
  installerFileNameFromUrl,
  launcherVersionFromUrl,
} = require("./generate");

const INSTALLER_URL =
  "https://install.robertsspaceindustries.com/rel/2/RSI%20Launcher-Setup-2.15.2.exe";

test("discovers the official launcher link from the RSI download page", () => {
  const html = `<div data-rsi-component-props='{ "downloadLink": "${INSTALLER_URL}" }'></div>`;
  assert.equal(discoverLauncherDownload(html), INSTALLER_URL);
});

test("accepts HTML-encoded component properties", () => {
  const html = `{&quot;downloadLink&quot;:&quot;${INSTALLER_URL}&quot;}`;
  assert.equal(discoverLauncherDownload(html), INSTALLER_URL);
});

test("derives a safe installer name and launcher version", () => {
  assert.equal(
    installerFileNameFromUrl(INSTALLER_URL),
    "RSI Launcher-Setup-2.15.2.exe",
  );
  assert.equal(launcherVersionFromUrl(INSTALLER_URL), "2.15.2");
});

test("rejects unknown installer naming", () => {
  assert.throws(
    () => launcherVersionFromUrl("https://example.com/launcher.exe"),
    /cannot determine RSI Launcher version/,
  );
});
