const fs = require("fs");
const path = require("path");

const OLD_MAIN_JS_PREFIX = "app/static/js/main.";
const NEW_MAIN_JS_PREFIX = "app/launcher/static/js/main.";
const MAIN_JS_SUFFIX = ".js";
const MAIN_JS_PREFIXES = [OLD_MAIN_JS_PREFIX, NEW_MAIN_JS_PREFIX];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) {
      throw new Error(`unknown argument: ${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key.slice(2)] = true;
      continue;
    }
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

function normalizeAsarPath(value) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function findLauncherMainPath(paths) {
  const candidates = [];
  for (const rawPath of paths) {
    const normalized = normalizeAsarPath(rawPath);
    const priority = MAIN_JS_PREFIXES.findIndex(
      (prefix) => normalized.startsWith(prefix) && normalized.endsWith(MAIN_JS_SUFFIX),
    );
    if (priority !== -1) {
      candidates.push({ rawPath, normalized, priority });
    }
  }

  if (candidates.length === 0) {
    throw new Error(`main script not found; supported prefixes: ${MAIN_JS_PREFIXES.join(", ")}`);
  }

  candidates.sort((a, b) => a.priority - b.priority || a.normalized.localeCompare(b.normalized));
  return candidates[0];
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function mainHashFromPath(mainPath) {
  const fileName = path.posix.basename(normalizeAsarPath(mainPath));
  const match = /^main\.([^.]+)\.js$/.exec(fileName);
  return match ? match[1] : "unknown";
}

module.exports = {
  parseArgs,
  normalizeAsarPath,
  findLauncherMainPath,
  readText,
  writeText,
  mainHashFromPath,
};
