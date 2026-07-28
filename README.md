# RSILauncherEnhance_Gen

Node generator workspace for `RSILauncherEnhance/main.js`.

The workflow intentionally avoids patching compressed JS with broad syntax analysis. The default
command downloads and extracts the launcher, formats its UI bundle with Prettier, applies a
deterministic readable patch, and verifies the result. The preparation/finalization commands remain
available for manual agent-assisted updates when a future launcher changes the patch anchors.

## Inputs

- `source/app.asar`: official RSI Launcher asar. This file is ignored by git.
- `source/zh_CN_map.js`: Simplified Chinese localization map.
- `source/zh_TW_map.js`: Traditional Chinese localization map.

The generator keeps launcher UI bundle locations as restricted constants and supports the current
layout plus both historical layouts:

- `app/launcher/static/js/index.*.js`
- `app/static/js/main.*.js`
- `app/launcher/static/js/main.*.js`

## Fully automatic workflow

Install dependencies once, then run:

```powershell
npm install
npm run generate
```

Node.js 22.12 or newer is required by the current ASAR tooling.

`generate` performs the complete deterministic workflow:

1. Reads the current installer URL from the official RSI download page.
2. Downloads the installer to `work/download/` using a `.part` file and verifies
   its byte length before making it visible as a completed download.
3. Uses the bundled 7-Zip executable to extract `resources/app.asar`.
4. Extracts and formats only the supported launcher UI bundle.
5. Applies the localization and downloader-boost patch, fills newly introduced
   untranslated fields with the English fallback, and disables built-in language switching.
6. Runs the final validator and writes `../RSILauncherEnhance/main.js`.

The downloaded installer is cached. Use `npm run generate -- --force` to download
it again, or `--installer-url <https-url>` to generate for a specific official installer.

## Workflow

Install dependencies once:

```powershell
npm install
```

Extract and beautify the launcher bundle:

```powershell
npm run prepare-agent
```

This creates:

- `work/raw_main.js`: compressed bundle extracted from `source/app.asar`.
- `work/main.js`: beautified JS for agent edits.
- `work/meta.json`: source path and launcher hash.

Then ask an opencode agent to apply the `rsi-launcher-enhance` skill to `work/main.js`.

Finalize and verify:

```powershell
npm run finalize-agent -- --input work/main.js --output ../RSILauncherEnhance/main.js
```

Verify the final output without writing another file:

```powershell
npm run verify-final
```

The final output remains beautified JS, matching the previous WebStorm/manual patch style.
