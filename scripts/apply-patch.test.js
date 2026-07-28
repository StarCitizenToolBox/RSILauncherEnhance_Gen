const assert = require("node:assert/strict");
const test = require("node:test");

const {
  extractEnglishResources,
  fillMissingValues,
  patchLanguageMethods,
  patchTransferOptions,
} = require("./apply-patch");

test("extracts the English object tied to the i18n initialization", () => {
  const content = `
    service.init({
      lng: "en",
      fallbackLng: "en",
      resources: {
        en: { settings: { title: "Settings" } },
      },
    });
  `;
  assert.deepEqual(
    JSON.parse(JSON.stringify(extractEnglishResources(content).english)),
    { settings: { title: "Settings" } },
  );
});

test("fills only missing translation fields", () => {
  const translated = { settings: { title: "设置" } };
  const added = fillMissingValues(translated, {
    settings: { title: "Settings", subtitle: "Application settings" },
    tray: { quit: "Quit" },
  });
  assert.equal(added, 2);
  assert.deepEqual(translated, {
    settings: { title: "设置", subtitle: "Application settings" },
    tray: { quit: "Quit" },
  });
});

test("wraps only the known stock transfer options", () => {
  const content = `
    let options = [
      { label: "Max", value: 25 },
      { label: "20", value: 20 },
      { label: "15", value: 15 },
      { label: "10", value: 10 },
      { label: "5", value: 5 },
    ];
  `;
  const patched = patchTransferOptions(content);
  assert.match(patched, /SC_TOOLBOX_ENABLE_DOWNLOADER_BOOST/);
  assert.match(patched, /"value":100/);
  assert.match(patched, /label: "20", value: 20/);
});

test("turns launcher language updates into deterministic no-ops", () => {
  const content = `
    class Languages {
      updateCurrentLanguage(language) {
        actions.setCurrentLanguage(language);
      }
      updatei18nLanguage(language) {
        this.seti18nLanguage(language.code);
      }
      updateLanguageCollection(collection) {
        const { actions: storeActions, currentLanguage } = store.getState().language;
        storeActions.setLanguageCollection(collection);
        storeActions.setCurrentLanguage(currentLanguage);
      }
    }
  `;
  const patched = patchLanguageMethods(content);
  assert.doesNotMatch(patched, /setCurrentLanguage/);
  assert.doesNotMatch(patched, /this\.seti18nLanguage/);
  assert.match(patched, /storeActions\.setLanguageCollection\(collection\)/);
  assert.match(patched, /disable by SC_TOOLBOX_ENABLED_LOCALIZATION/);
  assert.match(patched, /disabled by SCToolbox/);
});
