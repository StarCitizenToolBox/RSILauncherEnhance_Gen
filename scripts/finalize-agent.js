const path = require("path");
const vm = require("vm");

const { parseArgs, readText, writeText } = require("./common");

const REQUIRED_SNIPPETS = [
  "SC_TOOLBOX_ENABLED_LOCALIZATION",
  "SC_TOOLBOX_ENABLE_DOWNLOADER_BOOST",
  "SC_TOOLBOX_LOCALIZATION_ZHCN_MAP",
  "SC_TOOLBOX_LOCALIZATION_ZHTW_MAP",
  "zh_CN",
  "zh_TW",
  "setLanguageCollection",
];

function countMatches(content, pattern) {
  return (content.match(pattern) || []).length;
}

function assertBeautified(content) {
  const lines = content.split(/\r?\n/);
  if (lines.length < 5000) {
    throw new Error(
      `patched main.js does not look beautified; expected at least 5000 lines, found ${lines.length}`,
    );
  }
  const unexpectedLongLine = lines.find((line) => {
    if (line.length <= 100000) return false;
    let literal = line.trim();
    literal = literal.replace(/^[A-Za-z_$][\w$]*\s*:\s*/, "");
    const quote = literal[0];
    if (quote !== '"' && quote !== "'") return true;
    return !(
      literal.endsWith(`${quote},`) ||
      literal.endsWith(`${quote};`) ||
      literal.endsWith(quote)
    );
  });
  if (unexpectedLongLine) {
    throw new Error(
      `patched main.js still contains a minified/raw line; unexpected line length is ${unexpectedLongLine.length}`,
    );
  }
}

function assertSyntax(content, fileName) {
  try {
    new vm.Script(content, { filename: fileName });
  } catch (error) {
    throw new Error(
      `patched main.js has invalid JavaScript syntax: ${error.message}`,
    );
  }
}

function methodBody(content, methodName) {
  const methodPattern = new RegExp(
    `(?:^|\\n)[ \\t]*(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*\\{`,
    "m",
  );
  const methodMatch = methodPattern.exec(content);
  if (!methodMatch) {
    throw new Error(`missing language method: ${methodName}`);
  }
  const openBrace = content.indexOf(
    "{",
    methodMatch.index + methodMatch[0].length - 1,
  );
  if (openBrace === -1) {
    throw new Error(`missing language method body: ${methodName}`);
  }

  let depth = 1;
  let index = openBrace + 1;
  let quote = null;
  while (index < content.length) {
    const ch = content[index];
    if (quote) {
      if (ch === "\\") {
        index += 2;
        continue;
      }
      if (ch === quote) quote = null;
      index += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      index += 1;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) return content.slice(openBrace + 1, index);
    index += 1;
  }
  throw new Error(`unterminated language method body: ${methodName}`);
}

function assertLanguageSwitchDisabled(content) {
  for (const methodName of ["updateCurrentLanguage", "updatei18nLanguage"]) {
    const body = methodBody(content, methodName);
    if (body.includes("Did not find language in the collection")) {
      throw new Error(
        `${methodName} still throws when language is not in collection`,
      );
    }
    if (
      /\bsetCurrentLanguage\s*\(/.test(body) ||
      /\bseti18nLanguage\s*\(/.test(body)
    ) {
      throw new Error(`${methodName} still changes launcher language`);
    }
  }

  const collectionBody = methodBody(content, "updateLanguageCollection");
  if (collectionBody.includes("Did not find default language")) {
    throw new Error(
      "updateLanguageCollection still throws when default language is not in collection",
    );
  }
  if (
    /\bsetCurrentLanguage\s*\(/.test(collectionBody) ||
    /\bseti18nLanguage\s*\(/.test(collectionBody)
  ) {
    throw new Error(
      "updateLanguageCollection still falls back to built-in language switching",
    );
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args.input || path.join("work", "main.js");
  const output =
    args.output || path.join("..", "RSILauncherEnhance", "main.js");
  const checkOnly = Object.prototype.hasOwnProperty.call(args, "check-only");
  const content = readText(input);

  assertBeautified(content);
  assertSyntax(content, input);
  assertLanguageSwitchDisabled(content);

  const missing = REQUIRED_SNIPPETS.filter(
    (snippet) => !content.includes(snippet),
  );
  if (missing.length > 0) {
    throw new Error(
      `patched main.js is missing required snippets: ${missing.join(", ")}`,
    );
  }

  const disabledCount = countMatches(
    content,
    /disable(?:d)? by (?:SC_TOOLBOX_ENABLED_LOCALIZATION|SCToolbox)/g,
  );
  if (disabledCount < 3) {
    throw new Error(
      `expected at least 3 language disable comments, found ${disabledCount}`,
    );
  }

  if (/lng\s*:\s*["']en["']/.test(content)) {
    throw new Error("i18n init still appears to use literal en");
  }

  if (!/lng\s*:\s*SC_TOOLBOX_ENABLED_LOCALIZATION/.test(content)) {
    throw new Error(
      "i18n init is not wired to SC_TOOLBOX_ENABLED_LOCALIZATION",
    );
  }

  if (
    /defaultLanguage\s*:/.test(content) &&
    !/defaultLanguage\s*:\s*\{\s*code\s*:\s*SC_TOOLBOX_ENABLED_LOCALIZATION/.test(
      content,
    )
  ) {
    throw new Error(
      "defaultLanguage.code is not wired to SC_TOOLBOX_ENABLED_LOCALIZATION",
    );
  }

  if (!checkOnly) {
    writeText(output, content);
  }
  console.log(`verified input: ${input}`);
  console.log(`language disable comments: ${disabledCount}`);
  if (checkOnly) {
    console.log("check only: true");
  } else {
    console.log(`output: ${output}`);
  }
}

main();
