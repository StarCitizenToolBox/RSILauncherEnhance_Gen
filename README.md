# RSILauncherEnhance_Gen

Node generator workspace for `RSILauncherEnhance/main.js`.

The workflow intentionally avoids patching compressed JS with broad syntax analysis. It extracts the launcher bundle from `source/app.asar`, formats it with Prettier, then lets an opencode agent edit the readable `work/main.js` using the `rsi-launcher-enhance` skill.

## Inputs

- `source/app.asar`: official RSI Launcher asar. This file is ignored by git.
- `source/zh_CN_map.js`: Simplified Chinese localization map.
- `source/zh_TW_map.js`: Traditional Chinese localization map.

The generator keeps launcher main script locations as constants and supports both known layouts:

- `app/static/js/main.*.js`
- `app/launcher/static/js/main.*.js`

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
