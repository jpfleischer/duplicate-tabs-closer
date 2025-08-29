"use strict";

const isUrlWhiteListed = (url) => {
	const matches = options.whiteList.filter((pattern) => pattern.test(url));
	return matches.length !== 0;
};

const matchTitle = (tab1, tab2) => {
	if (options.compareWithTitle) {
		if (
			isTabComplete(tab1) &&
			isTabComplete(tab2) &&
			tab1.title === tab2.title
		) {
			return true;
		}
	}
	return false;
};

const getHttpsTabId = (observedTab, observedTabUrl, openTab) => {
	if (options.keepTabWithHttps) {
		const regex = /^https:\/\//i;
		const match1 = regex.test(observedTabUrl);
		const match2 = regex.test(openTab.url);
		if (match1) {
			return match2 ? null : observedTab.id;
		} else {
			return match2 ? openTab.id : null;
		}
	}
	return null;
};

const getPinnedTabId = (tab1, tab2) => {
	if (options.keepPinnedTab) {
		if (tab1.pinned) {
			return tab2.pinned ? null : tab1.id;
		} else {
			return tab2.pinned ? tab2.id : null;
		}
	}
	return null;
};

const getLastUpdatedTabId = (observedTab, openTab) => {
	const observedTabLastUpdate = tabsInfo.getLastComplete(observedTab.id);
	const openTabLastUpdate = tabsInfo.getLastComplete(openTab.id);
	if (options.keepNewerTab) {
		if (observedTabLastUpdate === null) return observedTab.id;
		if (openTabLastUpdate === null) return openTab.id;
		return observedTabLastUpdate > openTabLastUpdate
			? observedTab.id
			: openTab.id;
	} else {
		if (observedTabLastUpdate === null) return openTab.id;
		if (openTabLastUpdate === null) return observedTab.id;
		return observedTabLastUpdate < openTabLastUpdate
			? observedTab.id
			: openTab.id;
	}
};

// pick the "latest" tab by lastComplete, with sensible tie-breakers
const pickLatestTab = (tabs, activeWindowId) => {
  let best = null;
  for (const t of tabs) {
    const cand = {
      tab: t,
      last: tabsInfo.getLastComplete(t.id) ?? 0,
      activeWin: t.windowId === activeWindowId,
      active: !!t.active,
      index: t.index ?? 9e9,
      id: t.id
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

// close everything in the group except the chosen "latest"
const closeDuplicateGroup = async (groupId, windowIdHint) => {
  // Recompute groups to be accurate at click time
  const { duplicateTabsGroups, activeWindowId } = await searchForDuplicateTabs(windowIdHint, false);
  const group = duplicateTabsGroups.get(groupId);
  if (!group || group.size < 2) return; // nothing to do
  const toArray = Array.from(group);
  const keep = pickLatestTab(toArray, activeWindowId);
  if (!keep) return;

  const toCloseIds = toArray.filter(t => t.id !== keep.id).map(t => t.id);
  if (toCloseIds.length) {
    try {
      // ignore the closed tabs to avoid flicker and races
      toCloseIds.forEach(id => tabsInfo.ignoreTab(id, true));
      await chrome.tabs.remove(toCloseIds);
    } catch (e) {
      // best-effort: unignore on failure
      toCloseIds.forEach(id => tabsInfo.ignoreTab(id, false));
      throw e;
    } finally {
      // refresh badges/panel
      refreshDuplicateTabsInfo(keep.windowId);
    }
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

const getCloseInfo = (details) => {
	const observedTab = details.observedTab;
	const observedTabUrl = details.observedTabUrl || observedTab.url;
	const openTab = details.openTab;
	const activeWindowId = details.activeWindowId;
	let retainedTabId = getPinnedTabId(observedTab, openTab);
	if (!retainedTabId) {
		retainedTabId = getHttpsTabId(observedTab, observedTabUrl, openTab);
		if (!retainedTabId) {
			retainedTabId = getLastUpdatedTabId(observedTab, openTab);
			if (activeWindowId) {
				retainedTabId = getFocusedTab(
					observedTab,
					openTab,
					activeWindowId,
					retainedTabId,
				);
			}
		}
	}
	if (retainedTabId == observedTab.id) {
		const keepInfo = {
			observedTabClosed: false,
			active: openTab.active,
			tabIndex: openTab.index,
			tabId: observedTab.id,
			windowId: observedTab.windowId,
			reloadTab: false,
		};
		return [openTab.id, keepInfo];
	} else {
		const keepInfo = {
			observedTabClosed: true,
			active: observedTab.active,
			tabIndex: observedTab.index,
			tabId: openTab.id,
			windowId: openTab.windowId,
			reloadTab: options.keepReloadOlderTab ? true : false,
		};
		return [observedTab.id, keepInfo];
	}
};

// eslint-disable-next-line no-unused-vars
const searchForDuplicateTabsToClose = async (
	observedTab,
	queryComplete,
	loadingUrl,
) => {
	const observedTabUrl = loadingUrl || observedTab.url;
	const observedWindowsId = observedTab.windowId;
	if (isUrlWhiteListed(observedTabUrl)) {
		if (isTabComplete(observedTab)) refreshDuplicateTabsInfo(observedWindowsId);
		return;
	}
	const queryInfo = {};
	queryInfo.status = queryComplete ? "complete" : null;
	queryInfo.url = getMatchPatternURL(observedTabUrl);
	queryInfo.windowId = options.searchInAllWindows ? null : observedWindowsId;
	if (environment.isFirefox)
		queryInfo.cookieStoreId = options.searchPerContainer
			? observedTab.cookieStoreId
			: null;
	const openTabs = await getTabs(queryInfo);
	const matchingObservedTabUrl = getMatchingURL(observedTabUrl);
	let match = false;
	for (const openTab of openTabs) {
		if (
			openTab.id === observedTab.id ||
			tabsInfo.isIgnoredTab(openTab.id) ||
			(isBlankURL(openTab.url) && !isTabComplete(openTab))
		)
			continue;
		if (
			getMatchingURL(openTab.url) === matchingObservedTabUrl ||
			matchTitle(openTab, observedTab)
		) {
			match = true;
			const [tabToCloseId, remainingTabInfo] = getCloseInfo({
				observedTab: observedTab,
				observedTabUrl: observedTabUrl,
				openTab: openTab,
			});
			closeDuplicateTab(tabToCloseId, remainingTabInfo);
			if (remainingTabInfo.observedTabClosed) break;
		}
	}
	if (!match) {
		if (tabsInfo.hasDuplicateTabs(observedWindowsId))
			refreshDuplicateTabsInfo(observedWindowsId);
		else if (environment.isChrome && observedTab.active)
			setBadge(observedTab.windowId, observedTab.id);
	}
};

const closeDuplicateTab = async (tabToCloseId, remainingTabInfo) => {
	try {
		tabsInfo.ignoreTab(tabToCloseId, true);
		await removeTab(tabToCloseId);
	} catch (ex) {
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
		if (details.tabIndex > 0)
			moveTab(details.tabId, { index: details.tabIndex });
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
			if (!retainedTab) {
				retainedTabs.set(matchingKey, observedTab);
			}
		}
	}
	if (retainedTab) {
		if (details.closeTab) {
			const [tabToCloseId] = getCloseInfo({
				observedTab: observedTab,
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
			const tabs = duplicateTabsGroups.get(matchingKey);
			duplicateTabsGroups.set(
				matchingKey,
				tabs ? tabs.add(observedTab) : new Set([retainedTab, observedTab]),
			);
		}
	}
};

// eslint-disable-next-line no-unused-vars
const searchForDuplicateTabs = async (windowId, closeTabs) => {
	const queryInfo = { windowType: "normal" };
	if (!options.searchInAllWindows) queryInfo.windowId = windowId;
	const [activeWindowId, openTabs] = await Promise.all([
		getActiveWindowId(),
		getTabs(queryInfo),
	]);
	const duplicateTabsGroups = new Map();
	const retainedTabs = new Map();
	for (const openTab of openTabs) {
		if (
			(isBlankURL(openTab.url) && !isTabComplete(openTab)) ||
			tabsInfo.isIgnoredTab(openTab.id)
		)
			continue;
		const details = {
			tab: openTab,
			retainedTabs: retainedTabs,
			activeWindowId: activeWindowId,
			closeTab: closeTabs,
			duplicateTabsGroups: duplicateTabsGroups,
		};
		handleObservedTab(details);
	}
	if (!closeTabs) {
		return {
			duplicateTabsGroups: duplicateTabsGroups,
			activeWindowId: activeWindowId,
		};
	}
};

// eslint-disable-next-line no-unused-vars
const closeDuplicateTabs = (windowId) => searchForDuplicateTabs(windowId, true);

const toggleAutoClose = async () => {
	const { storedOptions } = await getStoredOptions();
	let value = storedOptions["onDuplicateTabDetected"].value;
	if (value === "A") {
		value = "N";
	} else {
		value = "A";
	}
	await setStoredOption("onDuplicateTabDetected", value, false);
};

const setDuplicateTabPanel = async (duplicateTab, duplicateTabs, groupId) => {
  let containerColor = "";
  try {
    if (
      environment.isFirefox &&
      !duplicateTab.incognito &&
      duplicateTab.cookieStoreId &&
      duplicateTab.cookieStoreId !== "firefox-default" &&
      browser?.contextualIdentities?.get
    ) {
      const ctx = await browser.contextualIdentities.get(duplicateTab.cookieStoreId);
      if (ctx?.color) containerColor = ctx.color;
    }
  } catch (_) {}

  duplicateTabs.add({
    id: duplicateTab.id,
    url: duplicateTab.url,
    title: duplicateTab.title || duplicateTab.url,
    windowId: duplicateTab.windowId,
    index: duplicateTab.index,
    pinned: !!duplicateTab.pinned,
    active: !!duplicateTab.active,
    lastComplete: tabsInfo.getLastComplete(duplicateTab.id) ?? 0,
    groupId, // ← important: send group key to the panel
    containerColor,
    icon: duplicateTab.favIconUrl || "../images/default-favicon.png",
  });
};


const getPanelDuplicateTabs = async (duplicateTabsGroups) => {
  if (duplicateTabsGroups.size === 0) return null;

  // Build flat list + enrich (already adds lastComplete, pinned, index, active, groupId)
  const collected = new Set();
  for (const [groupId, group] of duplicateTabsGroups) {
    await Promise.all(Array.from(group, (t) => setDuplicateTabPanel(t, collected, groupId)));
  }
  const items = Array.from(collected);

  // Sort: active window → pinned → NEWEST first → active tab → tab index → title → id
  const activeWindowId = await getActiveWindowId();

  items.sort((a, b) => {
    // 1) Active window first
    const awA = a.windowId === activeWindowId, awB = b.windowId === activeWindowId;
    if (awA !== awB) return awB - awA;

    // 2) Pinned first
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;

    // 3) Newest (lastComplete) first; default 0 if missing
    const lcA = a.lastComplete ?? 0, lcB = b.lastComplete ?? 0;
    if (lcA !== lcB) return lcB - lcA;

    // 4) Active tab before inactive (nice tie-breaker)
    if (a.active !== b.active) return a.active ? -1 : 1;

    // 5) Then by tab strip order within same window (index asc)
    if (a.windowId === b.windowId && a.index != null && b.index != null && a.index !== b.index) {
      return a.index - b.index;
    }

    // 6) Title then id as stable fallbacks
    const t = (a.title || "").localeCompare(b.title || "");
    if (t) return t;
    return (a.id || 0) - (b.id || 0);
  });

  return items;
};


// eslint-disable-next-line no-unused-vars
const requestDuplicateTabsFromPanel = async (windowId) => {
	const searchResult = await searchForDuplicateTabs(windowId, false);
	sendDuplicateTabs(searchResult.duplicateTabsGroups);
};

const sendDuplicateTabs = async (duplicateTabsGroups) => {
	const duplicateTabs = await getPanelDuplicateTabs(duplicateTabsGroups);
	chrome.runtime.sendMessage({
		action: "updateDuplicateTabsTable",
		data: { duplicateTabs: duplicateTabs },
	});
};

const _refreshDuplicateTabsInfo = async (windowId) => {
	const searchResult = await searchForDuplicateTabs(windowId, false);
	updateBadgesValue(searchResult.duplicateTabsGroups, windowId);
	if (
		isPanelOptionOpen() &&
		(options.searchInAllWindows || windowId === searchResult.activeWindowId)
	) {
		sendDuplicateTabs(searchResult.duplicateTabsGroups);
	}
};

const refreshDuplicateTabsInfo = debounce(_refreshDuplicateTabsInfo, 300);

// eslint-disable-next-line no-unused-vars
const refreshGlobalDuplicateTabsInfo = async () => {
	if (options.searchInAllWindows) {
		refreshDuplicateTabsInfo();
	} else {
		const windows = await getWindows();
		windows.forEach((window) => refreshDuplicateTabsInfo(window.id));
	}
};
