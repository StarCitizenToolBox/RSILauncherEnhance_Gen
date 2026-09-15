---
name: rsi-launcher-enhance
description: Use when updating RSILauncherEnhance_Gen, source/app.asar, source/zh_CN_map.js, source/zh_TW_map.js, or generating RSI Launcher Enhance patches from beautified main.js.
---

# RSI Launcher Enhance Patch Workflow

Use this skill when the user asks to update RSI Launcher Enhance patches, `RSILauncherEnhance_Gen`, `source/app.asar`, `source/zh_CN_map.js`, or `source/zh_TW_map.js`.

## Goal

Do not patch compressed JS with broad syntax analysis. First extract and beautify the launcher bundle, then edit the readable `work/main.js` directly using the historical patch as reference.

The final patch must remain beautified/readable JS. Do not fall back to patching `work/raw_main.js` or emitting a minified/raw bundle, even if that is easier to make syntactically valid.

Use the repository scripts as the workflow boundary. Do not install or uninstall extra formatter dependencies, do not modify `package.json` or `package-lock.json`, and do not create persistent helper scripts outside `work/`. If a temporary helper script is needed inside `work/`, remove it before finishing.

## Commands

Run from `P:/StarCitizen/RSILauncherEnhance_Gen`.

Run the complete automatic workflow, starting from the official RSI launcher download:

```powershell
npm install
npm run generate
```

Prepare readable JS:

```powershell
npm install
npm run prepare-agent
```

Finalize after editing:

```powershell
npm run finalize-agent -- --input work/main.js --output ../RSILauncherEnhance/main.js
npm run verify-final
```

## Files

- `work/raw_main.js`: compressed JS extracted from `source/app.asar`; do not edit.
- `work/main.js`: Prettier-formatted JS; edit this file.
- `work/meta.json`: extracted asar path, actual launcher UI bundle path (which can be
  `index.<hash>.js` or `main.<hash>.js`), and version hash.
- `source/zh_CN_map.js`: Simplified Chinese localization map.
- `source/zh_TW_map.js`: Traditional Chinese localization map.
- `../RSILauncherEnhance/main.js`: historical patched output and final destination.

## Translation Map Handling

Translation contributors may not be professional developers. Do not assume `source/zh_CN_map.js` and `source/zh_TW_map.js` are perfectly standard JavaScript map files.

Before inserting a map, inspect it and normalize only as much as needed. Try to preserve translator content and comments.

Common acceptable inputs include:

- A plain object literal: `{ ... }`
- A const assignment: `const SC_TOOLBOX_LOCALIZATION_ZHCN_MAP = { ... };`
- An exported object: `export default { ... }`
- Extra trailing semicolons, blank lines, or comments
- Minor formatting differences, quoted or unquoted object keys

If a map is malformed, first repair obvious non-semantic issues such as a missing wrapper const, trailing prose outside the object, or inconsistent semicolons. If the object boundaries are ambiguous or key/value content is unclear, stop and ask the user instead of guessing translated text.

Compare each Chinese map against the English launcher resources in `work/main.js`. If Chinese maps are missing fields that exist in English, automatically fill the missing fields using the existing translation semantics and nearby context. Prefer consistent wording already present in the same map, same namespace, or sibling keys. Do not leave missing keys when the meaning is clear, because missing localization fields can cause abnormal display in the launcher.

If a missing field's meaning cannot be inferred from the English key/value and existing Chinese terminology, ask the user instead of inventing a translation.

When inserting into `work/main.js`, the final embedded variables must be valid JavaScript:

```js
const SC_TOOLBOX_LOCALIZATION_ZHCN_MAP = { ... };
const SC_TOOLBOX_LOCALIZATION_ZHTW_MAP = { ... };
```

## Patch Checklist

Apply these changes to `work/main.js`:

1. Add constants near the top-level launcher bundle start:

```js
const SC_TOOLBOX_ENABLED_LOCALIZATION = "en";
const SC_TOOLBOX_ENABLE_DOWNLOADER_BOOST = false;
```

2. If the launcher bundle has a `defaultLanguage` config, replace
   `defaultLanguage.code` with `SC_TOOLBOX_ENABLED_LOCALIZATION`. Current `index.*.js`
   bundles no longer have that config, so the i18n `lng` replacement in step 5 is
   the required language initialization patch.

3. Insert `SC_TOOLBOX_LOCALIZATION_ZHCN_MAP` and `SC_TOOLBOX_LOCALIZATION_ZHTW_MAP` from `source/zh_CN_map.js` and `source/zh_TW_map.js` before the i18n resources object.

Before inserting the maps, make sure both Chinese maps include these `gamePage` keys even if the English source lacks one or two of them. The launcher localization library can render incorrectly when these variants are missing:

```js
game_page_nav_title: "游戏",
game_page_nav_title_one: "游戏",
game_page_nav_title_other: "游戏",
```

For Traditional Chinese, use the Traditional Chinese equivalent value, usually `"遊戲"`.

4. Add the resources entries:

```js
zh_CN: SC_TOOLBOX_LOCALIZATION_ZHCN_MAP,
zh_TW: SC_TOOLBOX_LOCALIZATION_ZHTW_MAP,
```

5. Change i18n initialization from literal English to `SC_TOOLBOX_ENABLED_LOCALIZATION`.

6. Add downloader boost options by wrapping the concurrent-transfer options array with `SC_TOOLBOX_ENABLE_DOWNLOADER_BOOST ? [...] : originalOptions`.

7. Fully disable built-in language switching paths with comments containing `disable by SC_TOOLBOX_ENABLED_LOCALIZATION` or `disabled by SCToolbox`:

- `updateCurrentLanguage(...)`
- `updatei18nLanguage(...)`
- `updateLanguageCollection(...)`

`updateCurrentLanguage(...)` and `updatei18nLanguage(...)` must become no-op/empty methods. Do not leave any lookup, `throw new Error("Did not find language in the collection")`, `setCurrentLanguage(...)`, or `seti18nLanguage(...)` call inside them.

For `updateLanguageCollection(...)`, preserve only `setLanguageCollection(...)` if needed, and disable all later fallback logic. Do not leave any `throw new Error("Did not find default language")`, `setCurrentLanguage(...)`, or `seti18nLanguage(...)` fallback inside it.

## Verification

After edits, run `npm run finalize-agent`. It must pass before considering the patch generated.

After finalizing, run `npm run verify-final` to check `../RSILauncherEnhance/main.js` without writing a second copy.

`finalize-agent` performs an embedded `vm.Script` syntax check, but also run an independent
Node parser check on both the readable bundle and the delivered output:

```powershell
node --check work/main.js
node --check ../RSILauncherEnhance/main.js
```

For the automatic workflow, use the readable path recorded in `work/generated/meta.json` (normally
`work/generated/main.js`) instead of `work/main.js`.

Before finalizing, recursively compare `resources.en` from the unpatched `work/raw_main.js` against
both source maps. Report every missing resource path and its English value as newly introduced
launcher text. The `apply-patch` output reports the number of English fallbacks added for each map;
any non-zero count must be reviewed rather than silently accepted. When the meaning is clear,
add a translation to the corresponding source map and regenerate; do not treat an English
fallback as completed Chinese localization. After finalizing, repeat the comparison against the embedded `SC_TOOLBOX_LOCALIZATION_ZHCN_MAP` and
`SC_TOOLBOX_LOCALIZATION_ZHTW_MAP` in the final output; the missing count must be zero for both
maps. If a new field cannot be translated from context, stop and ask the user instead of inventing
wording.

`finalize-agent` intentionally rejects raw/minified output. If it fails because the output does not look beautified, return to `work/main.js` and fix the readable patch instead of using `work/raw_main.js`.

If verification fails, inspect `work/main.js` and fix the missing checklist item. Do not bypass verification.
