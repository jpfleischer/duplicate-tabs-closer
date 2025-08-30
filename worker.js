// worker.js (top of file)
import {
  options,
  setStoredOption,
  isPanelOptionOpen,
  environment
} from "./options.js";

import { tabsInfo } from "./tabsInfo.js";

import {
  isBlankURL,
  isChromeURL,
  getMatchPatternURL,
  getMatchingURL
} from "./urlUtils.js";

import {
  isTabComplete,
  getTabs,
  getActiveWindowId,
  getWindows,
  removeTab,
  reloadTab,
  moveTab,
  activateTab,
  focusTab,
  wait,
  debounce,
  getStoredOptions
} from "./helper.js";

import { setBadge, updateBadgesValue } from "./badge.js";


// If you already have an environment module, import it. Otherwise you can derive the flags locally.


"use strict";

const isUrlWhiteListed = (url) => options.whiteList.some((pattern) => pattern.test(url));

const matchTitle = (tab1, tab2) =>
  options.compareWithTitle && isTabComplete(tab1) && isTabComplete(tab2) && tab1.title === tab2.title;

const getHttpsTabId = (observedTab, observedTabUrl, openTab) => {
  if (!options.keepTabWithHttps) return null;
  const https = /^https:\/\//i;
  const m1 = https.test(observedTabUrl);
  const m2 = https.test(openTab.url);
  if (m1) return m2 ? null : observedTab.id;
  return m2 ? openTab.id : null;
};

const getPinnedTabId = (tab1, tab2) => {
  if (!options.keepPinnedTab) return null;
  if (tab1.pinned) return tab2.pinned ? null : tab1.id;
  return tab2.pinned ? tab2.id : null;
};

const getLastUpdatedTabId = (observedTab, openTab) => {
  const a = tabsInfo.getLastComplete(observedTab.id);
  const b = tabsInfo.getLastComplete(openTab.id);
  if (options.keepNewerTab) {
    if (a === null) return observedTab.id;
    if (b === null) return openTab.id;
    return a > b ? observedTab.id : openTab.id;
  } else {
    if (a === null) return openTab.id;
    if (b === null) return observedTab.id;
    return a < b ? observedTab.id : openTab.id;
  }
};

const pickLatestTab = (tabs, activeWindowId) => {
  let best = null;
  for (const t of tabs) {
    const cand = {
      tab: t,
      last: tabsInfo.getLastComplete(t.id) ?? 0,
      activeWin: t.windowId === activeWindowId,
      active: !!t.active,
      index: t.index ?? 9e9,
      id: t.id,
    };
    if (!best) { best = cand; continue; }
    if (cand.last !== best.last) { best = cand.last > best.last ? cand : best; continue; }
    if (cand.activeWin !== best.activeWin) { best = cand.activeWin ? cand : best; continue; }
    if (cand.active !== best.active) { best = cand.active ? cand : best; continue; }
    if (cand.index !== best.index) { best = cand.index < best.index ? cand : best; continue; }
    if (cand.id !== best.id) { best = cand.id > best.id ? cand : best; continue; }
  }
  return best?.tab || null;
};

export const closeDuplicateGroup = async (groupId, windowIdHint) => {
  const { duplicateTabsGroups, activeWindowId } = await searchForDuplicateTabs(windowIdHint, false);
  const group = duplicateTabsGroups.get(groupId);
  if (!group || group.size < 2) return;
  const list = Array.from(group);
  const keep = pickLatestTab(list, activeWindowId);
  if (!keep) return;

  const toCloseIds = list.filter(t => t.id !== keep.id).map(t => t.id);
  if (!toCloseIds.length) return;

  try {
    toCloseIds.forEach(id => tabsInfo.ignoreTab(id, true));
    await chrome.tabs.remove(toCloseIds);
  } catch (e) {
    toCloseIds.forEach(id => tabsInfo.ignoreTab(id, false));
    throw e;
  } finally {
    refreshDuplicateTabsInfo(keep.windowId);
  }
};

const getFocusedTab = (observedTab, openTab, activeWindowId, retainedTabId) => {
  if (retainedTabId === observedTab.id) {
    return openTab.windowId === activeWindowId &&
      (openTab.active || observedTab.windowId !== activeWindowId)
      ? openTab.id
      : observedTab.id;
  } else {
    return observedTab.windowId === activeWindowId &&
      (observedTab.active || openTab.windowId !== activeWindowId)
      ? observedTab.id
      : openTab.id;
  }
};

const getCloseInfo = ({ observedTab, observedTabUrl, openTab, activeWindowId }) => {
  const keptByPin   = getPinnedTabId(observedTab, openTab);
  const keptByHttps = keptByPin ?? getHttpsTabId(observedTab, observedTabUrl, openTab);
  const retainedTabId = keptByHttps ?? getLastUpdatedTabId(observedTab, openTab);

  const finalKeepId = activeWindowId
    ? getFocusedTab(observedTab, openTab, activeWindowId, retainedTabId)
    : retainedTabId;

  if (finalKeepId === observedTab.id) {
    return [
      openTab.id,
      { observedTabClosed: false, active: openTab.active, tabIndex: openTab.index, tabId: observedTab.id, windowId: observedTab.windowId, reloadTab: false },
    ];
  } else {
    return [
      observedTab.id,
      { observedTabClosed: true,  active: observedTab.active, tabIndex: observedTab.index, tabId: openTab.id, windowId: openTab.windowId, reloadTab: !!options.keepReloadOlderTab },
    ];
  }
};

export const searchForDuplicateTabsToClose = async (observedTab, queryComplete, loadingUrl) => {
  const observedTabUrl = loadingUrl || observedTab.url;
  const observedWindowsId = observedTab.windowId;

  if (isUrlWhiteListed(observedTabUrl)) {
    if (isTabComplete(observedTab)) refreshDuplicateTabsInfo(observedWindowsId);
    return;
  }

  const queryInfo = {
    status: queryComplete ? "complete" : null,
    url: getMatchPatternURL(observedTabUrl),
    windowId: options.searchInAllWindows ? null : observedWindowsId,
  };

  if (environment.isFirefox) {
    queryInfo.cookieStoreId = options.searchPerContainer ? observedTab.cookieStoreId : null;
  }

  const openTabs = await getTabs(queryInfo);
  const matchingObservedTabUrl = getMatchingURL(observedTabUrl);
  let match = false;

  for (const openTab of openTabs) {
    if (
      openTab.id === observedTab.id ||
      tabsInfo.isIgnoredTab(openTab.id) ||
      (isBlankURL(openTab.url) && !isTabComplete(openTab))
    ) continue;

    if (getMatchingURL(openTab.url) === matchingObservedTabUrl || matchTitle(openTab, observedTab)) {
      match = true;
      const [tabToCloseId, remainingTabInfo] = getCloseInfo({
        observedTab,
        observedTabUrl,
        openTab,
      });
      closeDuplicateTab(tabToCloseId, remainingTabInfo);
      if (remainingTabInfo.observedTabClosed) break;
    }
  }

  if (!match) {
    if (tabsInfo.hasDuplicateTabs(observedWindowsId)) {
      refreshDuplicateTabsInfo(observedWindowsId);
    } else if (environment.isChrome && observedTab.active) {
      setBadge(observedTab.windowId, observedTab.id);
    }
  }
};

const closeDuplicateTab = async (tabToCloseId, remainingTabInfo) => {
  try {
    tabsInfo.ignoreTab(tabToCloseId, true);
    await removeTab(tabToCloseId);
  } catch {
    tabsInfo.ignoreTab(tabToCloseId, false);
    return;
  }

  if (tabsInfo.hasTab(tabToCloseId)) {
    await wait(10);
    if (tabsInfo.hasTab(tabToCloseId)) {
      tabsInfo.ignoreTab(tabToCloseId, false);
      refreshDuplicateTabsInfo(remainingTabInfo.windowId);
      return;
    }
  }
  handleRemainingTab(remainingTabInfo.windowId, remainingTabInfo);
};

const _handleRemainingTab = async (details) => {
  if (!tabsInfo.hasTab(details.tabId)) return;

  if (options.defaultTabBehavior && details.observedTabClosed) {
    if (details.tabIndex > 0) moveTab(details.tabId, { index: details.tabIndex });
    if (details.active) activateTab(details.tabId);
  } else if (options.activateKeptTab) {
    focusTab(details.tabId, details.windowId);
  }

  if (details.reloadTab) {
    tabsInfo.ignoreTab(details.tabId, true);
    await reloadTab(details.tabId);
    tabsInfo.ignoreTab(details.tabId, false);
  }
};

const handleRemainingTab = debounce(_handleRemainingTab, 500);

const handleObservedTab = (details) => {
  const observedTab = details.tab;
  const retainedTabs = details.retainedTabs;
  const duplicateTabsGroups = details.duplicateTabsGroups;

  let matchingTabURL = getMatchingURL(observedTab.url);
  let matchingTabTitle =
    options.compareWithTitle && isTabComplete(observedTab)
      ? `title=${observedTab.title}`
      : null;

  if (options.searchPerContainer) {
    matchingTabURL += observedTab.cookieStoreId;
    if (matchingTabTitle) matchingTabTitle += observedTab.cookieStoreId;
  }

  let matchingKey = matchingTabURL;
  let retainedTab = retainedTabs.get(matchingKey);
  if (!retainedTab) {
    if (isTabComplete(observedTab)) retainedTabs.set(matchingKey, observedTab);
    if (matchingTabTitle) {
      matchingKey = matchingTabTitle;
      retainedTab = retainedTabs.get(matchingKey);
      if (!retainedTab) retainedTabs.set(matchingKey, observedTab);
    }
  }

  if (retainedTab) {
    if (details.closeTab) {
      const [tabToCloseId] = getCloseInfo({
        observedTab,
        openTab: retainedTab,
        activeWindowId: details.activeWindowId,
      });
      if (tabToCloseId === observedTab.id) {
        chrome.tabs.remove(observedTab.id);
      } else {
        chrome.tabs.remove(retainedTab.id);
        retainedTabs.set(matchingKey, observedTab);
      }
    } else {
      const group = duplicateTabsGroups.get(matchingKey);
      duplicateTabsGroups.set(
        matchingKey,
        group ? group.add(observedTab) : new Set([retainedTab, observedTab]),
      );
    }
  }
};

export const searchForDuplicateTabs = async (windowId, closeTabs) => {
  const queryInfo = { windowType: "normal" };
  if (!options.searchInAllWindows) queryInfo.windowId = windowId;

  const [activeWindowId, openTabs] = await Promise.all([
    getActiveWindowId(),
    getTabs(queryInfo),
  ]);

  const duplicateTabsGroups = new Map();
  const retainedTabs = new Map();

  for (const openTab of openTabs) {
    if ((isBlankURL(openTab.url) && !isTabComplete(openTab)) || tabsInfo.isIgnoredTab(openTab.id))
      continue;

    handleObservedTab({
      tab: openTab,
      retainedTabs,
      activeWindowId,
      closeTab: closeTabs,
      duplicateTabsGroups,
    });
  }

  if (!closeTabs) return { duplicateTabsGroups, activeWindowId };
};

export const closeDuplicateTabs = (windowId) => searchForDuplicateTabs(windowId, true);

export const toggleAutoClose = async () => {
  const { storedOptions } = await getStoredOptions();
  let value = storedOptions["onDuplicateTabDetected"].value;
  value = (value === "A") ? "N" : "A";
  await setStoredOption("onDuplicateTabDetected", value, false);
};

const setDuplicateTabPanel = async (duplicateTab, outSet, groupId) => {
  let containerColor = "";
  try {
    if (
      environment.isFirefox && !duplicateTab.incognito && duplicateTab.cookieStoreId &&
      duplicateTab.cookieStoreId !== "firefox-default" && browser?.contextualIdentities?.get
    ) {
      const ctx = await browser.contextualIdentities.get(duplicateTab.cookieStoreId);
      if (ctx?.color) containerColor = ctx.color;
    }
  } catch (_) {}

  outSet.add({
    id: duplicateTab.id,
    url: duplicateTab.url,
    title: duplicateTab.title || duplicateTab.url,
    windowId: duplicateTab.windowId,
    index: duplicateTab.index,
    pinned: !!duplicateTab.pinned,
    active: !!duplicateTab.active,
    lastComplete: tabsInfo.getLastComplete(duplicateTab.id) ?? 0,
    groupId,
    containerColor,
    icon: duplicateTab.favIconUrl || "../images/default-favicon.png",
  });
};

export const getPanelDuplicateTabs = async (duplicateTabsGroups) => {
  if (duplicateTabsGroups.size === 0) return null;
  const collected = new Set();

  for (const [groupId, group] of duplicateTabsGroups) {
    await Promise.all(Array.from(group, (t) => setDuplicateTabPanel(t, collected, groupId)));
  }

  const items = Array.from(collected);
  const activeWindowId = await getActiveWindowId();

  items.sort((a, b) => {
    const awA = a.windowId === activeWindowId, awB = b.windowId === activeWindowId;
    if (awA !== awB) return awB - awA;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const lcA = a.lastComplete ?? 0, lcB = b.lastComplete ?? 0;
    if (lcA !== lcB) return lcB - lcA;
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.windowId === b.windowId && a.index != null && b.index != null && a.index !== b.index)
      return a.index - b.index;
    const t = (a.title || "").localeCompare(b.title || "");
    if (t) return t;
    return (a.id || 0) - (b.id || 0);
  });

  return items;
};

export const requestDuplicateTabsFromPanel = async (windowId) => {
  const searchResult = await searchForDuplicateTabs(windowId, false);
  sendDuplicateTabs(searchResult.duplicateTabsGroups);
};

const sendDuplicateTabs = async (duplicateTabsGroups) => {
  const duplicateTabs = await getPanelDuplicateTabs(duplicateTabsGroups);
  chrome.runtime.sendMessage({
    action: "updateDuplicateTabsTable",
    data: { duplicateTabs },
  });
};

const _refreshDuplicateTabsInfo = async (windowId) => {
  const searchResult = await searchForDuplicateTabs(windowId, false);
  updateBadgesValue(searchResult.duplicateTabsGroups, windowId);
  if (isPanelOptionOpen() && (options.searchInAllWindows || windowId === searchResult.activeWindowId)) {
    sendDuplicateTabs(searchResult.duplicateTabsGroups);
  }
};

export const refreshDuplicateTabsInfo = debounce(_refreshDuplicateTabsInfo, 300);

export const refreshGlobalDuplicateTabsInfo = async () => {
  if (options.searchInAllWindows) {
    refreshDuplicateTabsInfo();
  } else {
    const windows = await getWindows();
    windows.forEach((w) => refreshDuplicateTabsInfo(w.id));
  }
};
