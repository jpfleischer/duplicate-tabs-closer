// options.js (ESM)
"use strict";

import { getStoredOptions, saveStoredOptions, getPlatformInfo } from "./helper.js";

const defaultOptions = {
  shrunkMode: { value: false },
  onDuplicateTabDetected: { value: "N" },
  onRemainingTab: { value: "A" },
  keepTabBasedOnAge: { value: "O" },
  keepTabWithHttps: { value: true },
  keepPinnedTab: { value: true },
  keepTabWithHistory: { value: false },
  scope: { value: "C" },
  ignoreHashPart: { value: false },
  ignoreSearchPart: { value: false },
  ignorePathPart: { value: false },
  ignore3w: { value: false },
  caseInsensitive: { value: false },
  compareWithTitle: { value: false },
  onDuplicateTabDetectedPinned: { value: true },
  tabPriorityPinned: { value: true },
  matchingRulesPinned: { value: true },
  scopePinned: { value: true },
  customizationPinned: { value: true },
  whiteList: { value: "" },
  blackList: { value: "" },
  badgeColorDuplicateTabs: { value: "#f22121" },
  badgeColorNoDuplicateTabs: { value: "#1e90ff" },
  showBadgeIfNoDuplicateTabs: { value: true },
  closePopup: { value: false },
  environment: { value: "firefox" },
};

export const options = {}; // derived runtime options

export const environment = {
  isAndroid: false,
  isFirefox: false,
  isChrome:  false,
};

const whiteListToPattern = (whiteList) => {
  const out = new Set();
  const lines = whiteList.split("\n").map((l) => l.trim());
  for (const line of lines) {
    let pat = "^";
    for (let i = 0; i < line.length; i += 1) {
      const ch = line.charAt(i);
      pat = ch === "*" ? `${pat}.*` : pat + ch;
    }
    out.add(new RegExp(`${pat}$`));
  }
  return Array.from(out);
};

const setOptions = (storedOptions) => {
  options.autoCloseTab        = storedOptions.onDuplicateTabDetected.value === "A";
  options.defaultTabBehavior  = storedOptions.onRemainingTab.value === "B";
  options.activateKeptTab     = storedOptions.onRemainingTab.value === "A";
  options.keepNewerTab        = storedOptions.keepTabBasedOnAge.value === "N";
  options.keepReloadOlderTab  = storedOptions.keepTabBasedOnAge.value === "R";
  options.keepTabWithHttps    = storedOptions.keepTabWithHttps.value;
  options.keepPinnedTab       = storedOptions.keepPinnedTab.value;
  options.ignoreHashPart      = storedOptions.ignoreHashPart.value;
  options.ignoreSearchPart    = storedOptions.ignoreSearchPart.value;
  options.ignorePathPart      = storedOptions.ignorePathPart.value;
  options.compareWithTitle    = storedOptions.compareWithTitle.value;
  options.ignore3w            = storedOptions.ignore3w.value;
  options.caseInsensitive     = storedOptions.caseInsensitive.value;
  options.searchInAllWindows  = storedOptions.scope.value === "A"  || storedOptions.scope.value === "CA";
  options.searchPerContainer  = storedOptions.scope.value === "CC" || storedOptions.scope.value === "CA";
  options.whiteList           = whiteListToPattern(storedOptions.whiteList.value);
  options.badgeColorDuplicateTabs = storedOptions.badgeColorDuplicateTabs.value;
  options.badgeColorNoDuplicateTabs = storedOptions.badgeColorNoDuplicateTabs.value;
  options.showBadgeIfNoDuplicateTabs = storedOptions.showBadgeIfNoDuplicateTabs.value;
};

const setEnvironment = (storedOptions) => {
  const env = storedOptions.environment.value;
  environment.isAndroid = env === "android";
  environment.isFirefox = env === "firefox";
  environment.isChrome  = env === "chrome";
};

const getEnvironment = async () => {
  const info = await getPlatformInfo();
  return info.os === "android" ? "android" :
         (typeof InstallTrigger !== "undefined" ? "firefox" : "chrome");
};

const setupDefaultOptions = async () => {
  const env = await getEnvironment();
  const opts = Object.assign({}, defaultOptions);
  opts.environment.value = env;
  return opts;
};

const getNotInReferenceKeys = (referenceKeys, keys) => {
  const setKeys = new Set(keys);
  return Array.from(referenceKeys).filter((k) => !setKeys.has(k));
};

export const initializeOptions = async () => {
  const { storedOptions: stored0 } = await getStoredOptions();
  let storedOptions = stored0;

  if (!storedOptions || Object.keys(storedOptions).length === 0) {
    const initial = await setupDefaultOptions();
    storedOptions = await saveStoredOptions(initial);
  } else {
    const storedKeys  = Object.keys(storedOptions).sort();
    const defaultKeys = Object.keys(defaultOptions).sort();
    if (JSON.stringify(storedKeys) !== JSON.stringify(defaultKeys)) {
      const obsolete = getNotInReferenceKeys(storedKeys, defaultKeys);
      obsolete.forEach((k) => delete storedOptions[k]);
      const missing  = getNotInReferenceKeys(defaultKeys, storedKeys);
      missing.forEach((k) => (storedOptions[k] = { value: defaultOptions[k].value }));
      storedOptions.environment.value = await getEnvironment();
      storedOptions = await saveStoredOptions(storedOptions, true);
    }
  }
  setOptions(storedOptions);
  setEnvironment(storedOptions);
};

export const setStoredOption = async (name, value, refresh) => {
  const { storedOptions } = await getStoredOptions();
  storedOptions[name].value = value;
  await saveStoredOptions(storedOptions);
  setOptions(storedOptions);

  // avoid static circular imports by using dynamic imports on demand
  if (refresh) {
    const { refreshGlobalDuplicateTabsInfo } = await import("./worker.js");
    await refreshGlobalDuplicateTabsInfo();
  } else if (name === "onDuplicateTabDetected") {
    const { setBadgeIcon } = await import("./badge.js");
    setBadgeIcon();
  } else if (name === "showBadgeIfNoDuplicateTabs" ||
             name === "badgeColorNoDuplicateTabs" ||
             name === "badgeColorDuplicateTabs") {
    const { updateBadgeStyle } = await import("./badge.js");
    await updateBadgeStyle();
  }
};

// MV3 service workers can’t enumerate views—return false by default.
// You can wire this up via messages from popup/options if you wish.
export const isPanelOptionOpen = () => false;
