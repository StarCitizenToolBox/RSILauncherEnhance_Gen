const fs = require("fs");
const path = require("path");
const vm = require("vm");
const prettier = require("prettier");

const { parseArgs, readText, writeText } = require("./common");

const BOOSTED_TRANSFER_OPTIONS = [
  { label: "Max", value: 100 },
  { label: "75", value: 75 },
  { label: "50", value: 50 },
  { label: "25", value: 25 },
  { label: "10", value: 10 },
];
const STOCK_TRANSFER_VALUES = [25, 20, 15, 10, 5];

function findMatchingDelimiter(
  content,
  startIndex,
  openCharacter,
  closeCharacter,
) {
  if (content[startIndex] !== openCharacter) {
    throw new Error(`expected ${openCharacter} at offset ${startIndex}`);
  }

  let depth = 1;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = startIndex + 1; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === openCharacter) depth += 1;
    if (character === closeCharacter) depth -= 1;
    if (depth === 0) return index;
  }

  throw new Error(
    `unterminated ${openCharacter}${closeCharacter} block at offset ${startIndex}`,
  );
}

function evaluateObjectLiteral(literal, sourceName) {
  const value = vm.runInNewContext(`(${literal})`, Object.create(null), {
    filename: sourceName,
    timeout: 1000,
  });
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${sourceName} must contain a JavaScript object`);
  }
  return value;
}

function objectLiteralFromMapSource(source, variableName, sourceName) {
  const assignment = new RegExp(
    `\\b(?:const|let|var)\\s+${variableName}\\s*=\\s*\\{`,
  ).exec(source);
  const exportDefault = /\bexport\s+default\s*\{/.exec(source);
  const objectStart = assignment
    ? source.indexOf("{", assignment.index)
    : exportDefault
      ? source.indexOf("{", exportDefault.index)
      : -1;

  if (objectStart !== -1) {
    const objectEnd = findMatchingDelimiter(source, objectStart, "{", "}");
    return source.slice(objectStart, objectEnd + 1);
  }

  const trimmed = source.trim().replace(/;+$/, "").trim();
  return `{${trimmed}}`;
}

function loadTranslationMap(filePath, variableName) {
  const source = readText(filePath).replace(/^\uFEFF/, "");
  const literal = objectLiteralFromMapSource(source, variableName, filePath);
  return evaluateObjectLiteral(literal, filePath);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneValue(child)]),
    );
  }
  return value;
}

function fillMissingValues(target, fallback) {
  let added = 0;
  for (const [key, fallbackValue] of Object.entries(fallback)) {
    if (!Object.prototype.hasOwnProperty.call(target, key)) {
      target[key] = cloneValue(fallbackValue);
      added += 1;
    } else if (
      target[key] !== null &&
      fallbackValue !== null &&
      !Array.isArray(target[key]) &&
      !Array.isArray(fallbackValue) &&
      typeof target[key] === "object" &&
      typeof fallbackValue === "object"
    ) {
      added += fillMissingValues(target[key], fallbackValue);
    }
  }
  return added;
}

function ensureGamePageNavigationKeys(map, translatedValue) {
  if (!map.gamePage || typeof map.gamePage !== "object") map.gamePage = {};
  for (const key of [
    "game_page_nav_title",
    "game_page_nav_title_one",
    "game_page_nav_title_other",
  ]) {
    if (!map.gamePage[key]) map.gamePage[key] = translatedValue;
  }
}

function extractEnglishResources(content) {
  const languageMatch = /\blng\s*:\s*["']en["']/.exec(content);
  if (!languageMatch)
    throw new Error('missing i18n initialization anchor: lng: "en"');

  const resourcesMatch = /\bresources\s*:\s*\{/.exec(
    content.slice(languageMatch.index),
  );
  if (!resourcesMatch) throw new Error("missing i18n resources object");
  const resourcesStart = languageMatch.index + resourcesMatch.index;
  const resourcesOpenBrace = content.indexOf("{", resourcesStart);
  const englishMatch = /\ben\s*:\s*\{/.exec(
    content.slice(resourcesOpenBrace + 1),
  );
  if (!englishMatch) throw new Error("missing English i18n resource map");
  const englishOpenBrace = content.indexOf(
    "{",
    resourcesOpenBrace + 1 + englishMatch.index,
  );
  const englishCloseBrace = findMatchingDelimiter(
    content,
    englishOpenBrace,
    "{",
    "}",
  );

  return {
    english: evaluateObjectLiteral(
      content.slice(englishOpenBrace, englishCloseBrace + 1),
      "launcher English resources",
    ),
    resourcesOpenBrace,
  };
}

function insertBundleConstants(content, constantsSource) {
  const wrapperMarker = "(() => {";
  const wrapperIndex = content.indexOf(wrapperMarker);
  if (wrapperIndex === -1) throw new Error("launcher bundle wrapper not found");

  const wrapperBodyStart = wrapperIndex + wrapperMarker.length;
  const bodyPrefix = content.slice(wrapperBodyStart);
  const strictMatch = /^\s*(["'])use strict\1;/.exec(bodyPrefix);
  const insertionIndex = strictMatch
    ? wrapperBodyStart + strictMatch[0].length
    : wrapperBodyStart;
  return `${content.slice(0, insertionIndex)}\n${constantsSource}\n${content.slice(insertionIndex)}`;
}

function patchI18nResources(content) {
  const resourcesPattern = /\bresources\s*:\s*\{/;
  if (!resourcesPattern.test(content))
    throw new Error("i18n resources object not found during patching");
  return content.replace(
    resourcesPattern,
    "resources: {\nzh_CN: SC_TOOLBOX_LOCALIZATION_ZHCN_MAP,\nzh_TW: SC_TOOLBOX_LOCALIZATION_ZHTW_MAP,",
  );
}

function patchI18nLanguage(content) {
  const languagePattern = /\blng\s*:\s*["']en["']/;
  if (!languagePattern.test(content))
    throw new Error('i18n initialization anchor lng: "en" not found');
  return content.replace(
    languagePattern,
    "lng: SC_TOOLBOX_ENABLED_LOCALIZATION",
  );
}

function patchTransferOptions(content) {
  const maxOptionMatch =
    /\{\s*label\s*:\s*["']Max["']\s*,\s*value\s*:\s*25\s*\}/.exec(content);
  if (!maxOptionMatch)
    throw new Error("stock concurrent-transfer options not found");

  const arrayStart = content.lastIndexOf("[", maxOptionMatch.index);
  if (arrayStart === -1)
    throw new Error("concurrent-transfer array start not found");
  const arrayEnd = findMatchingDelimiter(content, arrayStart, "[", "]");
  const stockOptions = vm.runInNewContext(
    content.slice(arrayStart, arrayEnd + 1),
    Object.create(null),
    {
      timeout: 1000,
    },
  );
  const stockValues = stockOptions.map((option) => option.value);
  if (
    stockOptions.length !== STOCK_TRANSFER_VALUES.length ||
    stockValues.some((value, index) => value !== STOCK_TRANSFER_VALUES[index])
  ) {
    throw new Error(
      `unexpected concurrent-transfer options: ${JSON.stringify(stockValues)}`,
    );
  }

  const replacement = `SC_TOOLBOX_ENABLE_DOWNLOADER_BOOST ? ${JSON.stringify(
    BOOSTED_TRANSFER_OPTIONS,
  )} : ${content.slice(arrayStart, arrayEnd + 1)}`;
  return `${content.slice(0, arrayStart)}${replacement}${content.slice(arrayEnd + 1)}`;
}

function findMethodDefinition(content, methodName) {
  const methodPattern = new RegExp(
    `(^|\\n)([ \\t]*)(?:async\\s+)?${methodName}\\s*\\(([^)]*)\\)\\s*\\{`,
    "m",
  );
  const match = methodPattern.exec(content);
  if (!match)
    throw new Error(`missing language method definition: ${methodName}`);
  const openBrace = content.indexOf("{", match.index + match[0].length - 1);
  const closeBrace = findMatchingDelimiter(content, openBrace, "{", "}");
  return {
    body: content.slice(openBrace + 1, closeBrace),
    closeBrace,
    indentation: match[2],
    openBrace,
    parameters: match[3]
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function replaceMethodBody(content, methodName, replacementBody) {
  const method = findMethodDefinition(content, methodName);
  return `${content.slice(0, method.openBrace + 1)}\n${replacementBody}\n${method.indentation}${content.slice(
    method.closeBrace,
  )}`;
}

function patchLanguageMethods(content) {
  for (const methodName of ["updateCurrentLanguage", "updatei18nLanguage"]) {
    const method = findMethodDefinition(content, methodName);
    content = replaceMethodBody(
      content,
      methodName,
      `${method.indentation}    // disable by SC_TOOLBOX_ENABLED_LOCALIZATION`,
    );
  }

  const collectionMethod = findMethodDefinition(
    content,
    "updateLanguageCollection",
  );
  const parameter = collectionMethod.parameters[0];
  if (!parameter)
    throw new Error(
      "updateLanguageCollection is missing its collection parameter",
    );
  const actionsDeclaration =
    /(?:const|let|var)\s+\{[^;]*\bactions\s*:\s*([A-Za-z_$][\w$]*)[^;]*\}\s*=\s*[^;]+;/.exec(
      collectionMethod.body,
    );
  if (!actionsDeclaration) {
    throw new Error("updateLanguageCollection actions declaration not found");
  }
  const actionsVariable = actionsDeclaration[1];
  return replaceMethodBody(
    content,
    "updateLanguageCollection",
    [
      `${collectionMethod.indentation}    ${actionsDeclaration[0].trim()}`,
      `${collectionMethod.indentation}    ${actionsVariable}.setLanguageCollection(${parameter});`,
      `${collectionMethod.indentation}    // disabled by SCToolbox`,
    ].join("\n"),
  );
}

async function applyPatch(options) {
  const input = options.input;
  const output = options.output;
  let content = readText(input);
  if (content.includes("SC_TOOLBOX_ENABLED_LOCALIZATION")) {
    throw new Error(`${input} already contains an RSI Launcher Enhance patch`);
  }

  const { english } = extractEnglishResources(content);
  const zhCn = loadTranslationMap(
    options.zhCnMap,
    "SC_TOOLBOX_LOCALIZATION_ZHCN_MAP",
  );
  const zhTw = loadTranslationMap(
    options.zhTwMap,
    "SC_TOOLBOX_LOCALIZATION_ZHTW_MAP",
  );
  ensureGamePageNavigationKeys(zhCn, "游戏");
  ensureGamePageNavigationKeys(zhTw, "遊戲");
  const zhCnFallbacks = fillMissingValues(zhCn, english);
  const zhTwFallbacks = fillMissingValues(zhTw, english);

  const constantsSource = [
    'const SC_TOOLBOX_ENABLED_LOCALIZATION = "en";',
    "const SC_TOOLBOX_ENABLE_DOWNLOADER_BOOST = false;",
    `const SC_TOOLBOX_LOCALIZATION_ZHCN_MAP = ${JSON.stringify(zhCn)};`,
    `const SC_TOOLBOX_LOCALIZATION_ZHTW_MAP = ${JSON.stringify(zhTw)};`,
  ].join("\n");
  content = insertBundleConstants(content, constantsSource);
  content = patchI18nResources(content);
  content = patchI18nLanguage(content);
  content = patchTransferOptions(content);
  content = patchLanguageMethods(content);
  content = await prettier.format(content, {
    parser: "babel",
    printWidth: 120,
    tabWidth: 4,
    useTabs: false,
    trailingComma: "all",
    bracketSpacing: true,
    semi: true,
    singleQuote: false,
  });
  writeText(output, content);

  return { zhCnFallbacks, zhTwFallbacks };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args.input || path.join("work", "main.js");
  const output = args.output || input;
  const result = await applyPatch({
    input,
    output,
    zhCnMap: args["zh-cn-map"] || path.join("source", "zh_CN_map.js"),
    zhTwMap: args["zh-tw-map"] || path.join("source", "zh_TW_map.js"),
  });
  console.log(`patched input: ${input}`);
  console.log(`patched output: ${output}`);
  console.log(
    `Simplified Chinese English fallbacks added: ${result.zhCnFallbacks}`,
  );
  console.log(
    `Traditional Chinese English fallbacks added: ${result.zhTwFallbacks}`,
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  applyPatch,
  extractEnglishResources,
  fillMissingValues,
  findMatchingDelimiter,
  loadTranslationMap,
  objectLiteralFromMapSource,
  patchLanguageMethods,
  patchTransferOptions,
};
