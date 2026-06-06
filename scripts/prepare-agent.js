const fs = require("fs");
const path = require("path");
const asar = require("@electron/asar");
const prettier = require("prettier");

const {
  parseArgs,
  normalizeAsarPath,
  findLauncherMainPath,
  writeText,
  mainHashFromPath,
} = require("./common");

function extractFile(asarPath, mainPath) {
  const windowsPath = mainPath.normalized.replace(/\//g, "\\");
  const attempts = [mainPath.rawPath, mainPath.normalized, windowsPath, `/${mainPath.normalized}`];
  let lastError;
  for (const attempt of attempts) {
    try {
      return asar.extractFile(asarPath, attempt);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const asarPath = args.asar || path.join("source", "app.asar");
  const workDir = args.workdir || "work";
  const rawOutput = path.join(workDir, "raw_main.js");
  const prettyOutput = path.join(workDir, "main.js");
  const metaOutput = path.join(workDir, "meta.json");

  const packagePaths = asar.listPackage(asarPath);
  const mainPath = findLauncherMainPath(packagePaths);
  const rawMain = extractFile(asarPath, mainPath).toString("utf8");
  const prettyMain = await prettier.format(rawMain, {
    parser: "babel",
    printWidth: 120,
    tabWidth: 4,
    useTabs: false,
    trailingComma: "all",
    bracketSpacing: true,
    semi: true,
    singleQuote: false,
  });

  fs.mkdirSync(workDir, { recursive: true });
  writeText(rawOutput, rawMain);
  writeText(prettyOutput, prettyMain);
  writeText(
    metaOutput,
    `${JSON.stringify(
      {
        asarPath,
        mainPath: normalizeAsarPath(mainPath.normalized),
        versionHash: mainHashFromPath(mainPath.normalized),
        rawBytes: Buffer.byteLength(rawMain),
        prettyBytes: Buffer.byteLength(prettyMain),
      },
      null,
      2,
    )}\n`,
  );

  console.log(`main script: ${mainPath.normalized}`);
  console.log(`version hash: ${mainHashFromPath(mainPath.normalized)}`);
  console.log(`raw output: ${rawOutput}`);
  console.log(`beautified output: ${prettyOutput}`);
  console.log(`meta output: ${metaOutput}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
