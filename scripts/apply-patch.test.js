const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  extractEnglishResources,
  fillMissingValues,
  loadTranslationMap,
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

test("keeps the current launcher guide and notification terms localized", () => {
  const zhCn = loadTranslationMap(
    path.join(__dirname, "..", "source", "zh_CN_map.js"),
    "SC_TOOLBOX_LOCALIZATION_ZHCN_MAP",
  );
  const zhTw = loadTranslationMap(
    path.join(__dirname, "..", "source", "zh_TW_map.js"),
    "SC_TOOLBOX_LOCALIZATION_ZHTW_MAP",
  );

  assert.equal(zhCn.accountPanel.account_panel_presence_dnd, "勿扰");
  assert.equal(zhCn.guide.guide_hub_find_title, "寻找一位向导");
  assert.equal(
    zhCn.guide.guide_request_accepted_toast,
    "{{name}} 接受了你的指导请求！",
  );
  assert.equal(zhCn.guide.guide_availability_available, "提供指导");
  assert.equal(zhCn.guide.guide_availability_unavailable, "暂不提供指导");
  assert.equal(
    zhCn.guide.guide_chat_private_message_notice,
    "这是一个由向导系统发起的私信会话",
  );
  assert.equal(zhCn.guide.guide_chat_duration_label, "时长");
  assert.equal(
    zhCn.settingsPage.settings_notifications_display_desktop_description,
    "以标准系统桌面通知的形式显示",
  );

  assert.equal(zhTw.accountPanel.account_panel_presence_dnd, "勿擾");
  assert.equal(zhTw.guide.guide_hub_find_title, "尋找一位嚮導");
  assert.equal(
    zhTw.guide.guide_request_accepted_toast,
    "{{name}} 接受了您的指導請求！",
  );
  assert.equal(zhTw.guide.guide_availability_available, "提供指導");
  assert.equal(zhTw.guide.guide_availability_unavailable, "暫不提供指導");
  assert.equal(
    zhTw.guide.guide_chat_private_message_notice,
    "這是一個由嚮導系統發起的私人訊息對話",
  );
  assert.equal(zhTw.guide.guide_chat_duration_label, "時長");
  assert.equal(
    zhTw.settingsPage.settings_notifications_display_desktop_description,
    "以標準系統桌面通知的形式顯示",
  );
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
