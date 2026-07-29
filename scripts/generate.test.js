const assert = require("node:assert/strict");
const test = require("node:test");

const {
  discoverLauncherDownload,
  discoverLauncherDownloadBaseUrl,
  installerFileNameFromUrl,
  installerUrlFromLatestMetadata,
  launcherVersionFromUrl,
  resolveInstallerUrl,
} = require("./generate");

const DOWNLOAD_PAGE = "https://robertsspaceindustries.com/en/download";
const DOWNLOAD_BASE_URL = "https://install.robertsspaceindustries.com/rel/2";
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

test("discovers the launcher download base URL from the current RSI page", () => {
  const html =
    `{&quot;launcherDownloadBaseUrl&quot;:` +
    `&quot;https:\\/\\/install.robertsspaceindustries.com\\/rel\\/2&quot;}`;
  assert.equal(discoverLauncherDownloadBaseUrl(html), DOWNLOAD_BASE_URL);
});

test("derives the installer URL from current launcher metadata", () => {
  assert.equal(
    installerUrlFromLatestMetadata(DOWNLOAD_BASE_URL, {
      version: "2.15.2",
      files: [{ url: "RSI Launcher-Setup-2.15.2.exe" }],
      path: "RSI Launcher-Setup-2.15.2.exe",
    }),
    INSTALLER_URL,
  );
});

test("resolves the current launcher through latest.json", async () => {
  const requestedUrls = [];
  const fetcher = async (url) => {
    requestedUrls.push(url);
    if (url === DOWNLOAD_PAGE) {
      return new Response(`{"launcherDownloadBaseUrl":"${DOWNLOAD_BASE_URL}"}`);
    }
    return Response.json({
      version: "2.15.2",
      path: "RSI Launcher-Setup-2.15.2.exe",
    });
  };

  assert.equal(
    await resolveInstallerUrl(DOWNLOAD_PAGE, undefined, fetcher),
    INSTALLER_URL,
  );
  assert.deepEqual(requestedUrls, [
    DOWNLOAD_PAGE,
    `${DOWNLOAD_BASE_URL}/latest.json`,
  ]);
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
