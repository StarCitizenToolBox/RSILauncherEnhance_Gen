const crypto = require("crypto");
const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");
const { spawnSync } = require("child_process");
const { path7za } = require("7zip-bin");

const { parseArgs, writeText } = require("./common");

const DEFAULT_DOWNLOAD_PAGE = "https://robertsspaceindustries.com/en/download";
const NETWORK_ATTEMPTS = 3;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithRetry(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= NETWORK_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.status < 500 || attempt === NETWORK_ATTEMPTS)
        return response;
      await response.body?.cancel();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    console.warn(
      `network attempt ${attempt}/${NETWORK_ATTEMPTS} failed for ${url}: ${lastError.message}`,
    );
    await wait(attempt * 1000);
  }
  throw lastError;
}

function discoverLauncherDownload(pageContent) {
  const normalized = pageContent.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const match = /"downloadLink"\s*:\s*"((?:\\.|[^"])*)"/.exec(normalized);
  if (!match)
    throw new Error("official RSI download page does not contain downloadLink");
  return JSON.parse(`"${match[1]}"`);
}

function launcherVersionFromUrl(installerUrl) {
  const fileName = decodeURIComponent(
    new URL(installerUrl).pathname.split("/").pop() || "",
  );
  const match = /RSI Launcher-Setup-([0-9.]+)\.exe$/i.exec(fileName);
  if (!match)
    throw new Error(
      `cannot determine RSI Launcher version from ${installerUrl}`,
    );
  return match[1];
}

function installerFileNameFromUrl(installerUrl) {
  const fileName = decodeURIComponent(
    new URL(installerUrl).pathname.split("/").pop() || "",
  );
  if (!/^[A-Za-z0-9 ._-]+\.exe$/i.test(fileName)) {
    throw new Error(`unsafe launcher installer file name: ${fileName}`);
  }
  return fileName;
}

async function resolveInstallerUrl(downloadPage, explicitInstallerUrl) {
  if (explicitInstallerUrl) return explicitInstallerUrl;
  const response = await fetchWithRetry(downloadPage, {
    headers: { "user-agent": "RSILauncherEnhance_Gen/0.1" },
  });
  if (!response.ok) {
    throw new Error(
      `failed to read official RSI download page: HTTP ${response.status}`,
    );
  }
  return discoverLauncherDownload(await response.text());
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
}

async function remoteContentLength(url) {
  const response = await fetchWithRetry(url, {
    method: "HEAD",
    headers: { "user-agent": "RSILauncherEnhance_Gen/0.1" },
  });
  if (!response.ok)
    throw new Error(`launcher installer HEAD failed: HTTP ${response.status}`);
  const value = Number(response.headers.get("content-length"));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function downloadInstaller(url, destination, force) {
  const expectedBytes = await remoteContentLength(url);
  if (!force) {
    try {
      const existing = await fsPromises.stat(destination);
      if (expectedBytes === null || existing.size === expectedBytes) {
        console.log(`reusing launcher installer: ${destination}`);
        return { bytes: existing.size, reused: true };
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  await fsPromises.mkdir(path.dirname(destination), { recursive: true });
  const partialPath = `${destination}.part`;
  await fsPromises.rm(partialPath, { force: true });
  const response = await fetchWithRetry(url, {
    headers: { "user-agent": "RSILauncherEnhance_Gen/0.1" },
  });
  if (!response.ok || !response.body) {
    throw new Error(
      `launcher installer download failed: HTTP ${response.status}`,
    );
  }

  let downloadedBytes = 0;
  let nextProgressBytes = 32 * 1024 * 1024;
  const progress = new Transform({
    transform(chunk, encoding, callback) {
      downloadedBytes += chunk.length;
      if (downloadedBytes >= nextProgressBytes) {
        console.log(
          `downloaded ${Math.round(downloadedBytes / 1024 / 1024)} MiB`,
        );
        nextProgressBytes += 32 * 1024 * 1024;
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      progress,
      fs.createWriteStream(partialPath),
    );
    if (expectedBytes !== null && downloadedBytes !== expectedBytes) {
      throw new Error(
        `launcher installer length mismatch: expected ${expectedBytes}, received ${downloadedBytes}`,
      );
    }
    await fsPromises.rm(destination, { force: true });
    await fsPromises.rename(partialPath, destination);
  } catch (error) {
    await fsPromises.rm(partialPath, { force: true });
    throw error;
  }
  return { bytes: downloadedBytes, reused: false };
}

function runCommand(command, args, cwd, allowFailure = false) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (allowFailure) return false;
    throw new Error(
      `${path.basename(command)} exited with status ${result.status}`,
    );
  }
  return true;
}

function assertChildPath(parent, child) {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  if (!resolvedChild.startsWith(`${resolvedParent}${path.sep}`)) {
    throw new Error(
      `refusing to clean path outside ${resolvedParent}: ${resolvedChild}`,
    );
  }
}

async function extractAppAsar(installerPath, extractionRoot, destination) {
  const workRoot = path.dirname(extractionRoot);
  assertChildPath(workRoot, extractionRoot);
  await fsPromises.rm(extractionRoot, { recursive: true, force: true });
  const installerRoot = path.join(extractionRoot, "installer");
  const payloadRoot = path.join(extractionRoot, "payload");
  await fsPromises.mkdir(installerRoot, { recursive: true });
  await fsPromises.mkdir(payloadRoot, { recursive: true });

  const extractedAsar = path.join(payloadRoot, "resources", "app.asar");
  runCommand(
    path7za,
    ["x", "-y", `-o${payloadRoot}`, installerPath, "resources\\app.asar"],
    undefined,
    true,
  );
  try {
    await fsPromises.access(extractedAsar);
  } catch {
    runCommand(path7za, [
      "x",
      "-y",
      `-o${installerRoot}`,
      installerPath,
      "$PLUGINSDIR\\app-64.7z",
    ]);
    const nestedArchive = path.join(installerRoot, "$PLUGINSDIR", "app-64.7z");
    runCommand(path7za, [
      "x",
      "-y",
      `-o${payloadRoot}`,
      nestedArchive,
      "resources\\app.asar",
    ]);
  }
  const extractedStat = await fsPromises.stat(extractedAsar);
  if (extractedStat.size === 0) throw new Error("extracted app.asar is empty");

  await fsPromises.mkdir(path.dirname(destination), { recursive: true });
  const partialDestination = `${destination}.part`;
  await fsPromises.copyFile(extractedAsar, partialDestination);
  await fsPromises.rm(destination, { force: true });
  await fsPromises.rename(partialDestination, destination);
  await fsPromises.rm(extractionRoot, { recursive: true, force: true });
  return extractedStat.size;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repositoryRoot = path.resolve(__dirname, "..");
  const downloadPage = args["download-page"] || DEFAULT_DOWNLOAD_PAGE;
  const installerUrl = await resolveInstallerUrl(
    downloadPage,
    args["installer-url"],
  );
  const installerProtocol = new URL(installerUrl).protocol;
  if (installerProtocol !== "https:")
    throw new Error(`launcher installer must use HTTPS: ${installerUrl}`);

  const launcherVersion = launcherVersionFromUrl(installerUrl);
  const workDir = path.resolve(
    repositoryRoot,
    args.workdir || path.join("work", "generated"),
  );
  const downloadDir = path.resolve(
    repositoryRoot,
    args["download-dir"] || path.join("work", "download"),
  );
  const installerPath = path.join(
    downloadDir,
    installerFileNameFromUrl(installerUrl),
  );
  const appAsarPath = path.resolve(
    repositoryRoot,
    args.asar || path.join("source", "app.asar"),
  );
  const finalOutput = path.resolve(
    repositoryRoot,
    args.output || path.join("..", "RSILauncherEnhance", "main.js"),
  );

  console.log(`launcher version: ${launcherVersion}`);
  console.log(`launcher installer: ${installerUrl}`);
  const download = await downloadInstaller(
    installerUrl,
    installerPath,
    Boolean(args.force),
  );
  const installerSha256 = await sha256File(installerPath);
  console.log(`installer SHA-256: ${installerSha256}`);

  const extractionRoot = path.join(downloadDir, `extract-${launcherVersion}`);
  const asarBytes = await extractAppAsar(
    installerPath,
    extractionRoot,
    appAsarPath,
  );
  console.log(`app.asar: ${appAsarPath} (${asarBytes} bytes)`);

  runCommand(
    process.execPath,
    ["scripts/prepare-agent.js", "--asar", appAsarPath, "--workdir", workDir],
    repositoryRoot,
  );
  const readableBundle = path.join(workDir, "main.js");
  runCommand(
    process.execPath,
    [
      "scripts/apply-patch.js",
      "--input",
      readableBundle,
      "--output",
      readableBundle,
    ],
    repositoryRoot,
  );
  runCommand(
    process.execPath,
    [
      "scripts/finalize-agent.js",
      "--input",
      readableBundle,
      "--output",
      finalOutput,
    ],
    repositoryRoot,
  );
  runCommand(
    process.execPath,
    ["scripts/finalize-agent.js", "--input", finalOutput, "--check-only"],
    repositoryRoot,
  );

  writeText(
    path.join(workDir, "automation.json"),
    `${JSON.stringify(
      {
        launcherVersion,
        installerUrl,
        installerPath,
        installerBytes: download.bytes,
        installerReused: download.reused,
        installerSha256,
        appAsarPath,
        appAsarBytes: asarBytes,
        finalOutput,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`generated enhancement: ${finalOutput}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  discoverLauncherDownload,
  installerFileNameFromUrl,
  launcherVersionFromUrl,
};
