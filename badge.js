// badge.js (ESM)
"use strict";
import { options } from "./options.js";
import { tabsInfo } from "./tabsInfo.js";
import { getActiveTabId, getWindows } from "./helper.js";

const IS_FIREFOX = typeof browser !== "undefined" && !!browser.browserAction;
const IS_CHROME  = typeof chrome  !== "undefined" && !!chrome.action;

export function setBadgeIcon() {
  const path = options.autoCloseTab
    ? "images/auto_close_16.png"
    : "images/manual_close_16.png";

  if (IS_CHROME) {
    chrome.action.setIcon({ path });
  } else if (IS_FIREFOX) {
    browser.browserAction.setIcon({ path });
    browser.browserAction.setBadgeTextColor?.({ color: "white" }).catch?.(() => {});
  }
}

function setWindowBadgeText(windowId, text) {
  const txt = text == null ? "" : String(text);
  if (IS_FIREFOX) browser.browserAction.setBadgeText({ text: txt, windowId });
  else if (IS_CHROME) chrome.action.setBadgeText({ text: txt });
}

async function setTabBadgeText(tabId, text) {
  const txt = text == null ? "" : String(text);
  if (IS_CHROME) chrome.action.setBadgeText({ tabId, text: txt });
  else if (IS_FIREFOX) browser.browserAction.setBadgeText({ text: txt });
}

function setWindowBadgeBackgroundColor(windowId, color) {
  const col = color || "#777";
  if (IS_FIREFOX) browser.browserAction.setBadgeBackgroundColor({ color: col, windowId });
  else if (IS_CHROME) chrome.action.setBadgeBackgroundColor({ color: col });
}

function setTabBadgeBackgroundColor(tabId, color) {
  const col = color || "#777";
  if (IS_CHROME) chrome.action.setBadgeBackgroundColor({ tabId, color: col });
  else if (IS_FIREFOX) browser.browserAction.setBadgeBackgroundColor({ color: col });
}

export const setBadge = async (windowId, activeTabId) => {
  let nb = tabsInfo.getNbDuplicateTabs(windowId);
  if (nb === "0" && !options.showBadgeIfNoDuplicateTabs) nb = "";

  const bg = nb !== "0" ? options.badgeColorDuplicateTabs : options.badgeColorNoDuplicateTabs;

  if (IS_FIREFOX) {
    setWindowBadgeText(windowId, nb);
    setWindowBadgeBackgroundColor(windowId, bg);
  } else {
    activeTabId = activeTabId || (await getActiveTabId(windowId));
    if (activeTabId) {
      await setTabBadgeText(activeTabId, nb);
      setTabBadgeBackgroundColor(activeTabId, bg);
    }
  }
};

const getNbDuplicateTabs = (groups) => {
  let nb = 0;
  if (groups.size !== 0) groups.forEach((g) => (nb += g.size - 1));
  return nb;
};

const updateBadgeValue = (nb, windowId) => {
  tabsInfo.setNbDuplicateTabs(windowId, nb);
  setBadge(windowId);
};

export const updateBadgesValue = async (groups, windowId) => {
  const nb = getNbDuplicateTabs(groups);
  if (options.searchInAllWindows) {
    const windows = await getWindows();
    windows.forEach((w) => updateBadgeValue(nb, w.id));
  } else {
    updateBadgeValue(nb, windowId);
  }
};

export const updateBadgeStyle = async () => {
  const windows = await getWindows();
  windows.forEach((w) => setBadge(w.id));
};
