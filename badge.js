"use strict";

// robust runtime detection
const IS_FIREFOX = typeof browser !== "undefined" && !!browser.browserAction;
const IS_CHROME  = typeof chrome !== "undefined" && !!chrome.action;

console.log(`badge.js: IS_FIREFOX=${IS_FIREFOX}, IS_CHROME=${IS_CHROME}`);


// ICON (works both)
function setBadgeIcon() {
  const path = options.autoCloseTab
    ? "images/auto_close_16.png"
    : "images/manual_close_16.png";

  if (IS_CHROME) {
    chrome.action.setIcon({ path });
  } else if (IS_FIREFOX) {
    browser.browserAction.setIcon({ path });
    // optional text color in FF
    browser.browserAction.setBadgeTextColor({ color: "white" }).catch(() => {});
  }
}

// TEXT
function setWindowBadgeText(windowId, text) {
  const txt = text == null ? "" : String(text);
  if (IS_FIREFOX) {
    browser.browserAction.setBadgeText({ text: txt, windowId });
  } else if (IS_CHROME) {
    // Chrome doesn't support per-window text; use tab-specific path instead.
    chrome.action.setBadgeText({ text: txt });
  }
}

async function setTabBadgeText(tabId, text) {
  const txt = text == null ? "" : String(text);
  if (IS_CHROME) {
    chrome.action.setBadgeText({ tabId, text: txt });
  } else if (IS_FIREFOX) {
    // FF browserAction doesn't support tabId for MV2; omit tabId.
    browser.browserAction.setBadgeText({ text: txt });
  }
}

// BACKGROUND COLOR
function setWindowBadgeBackgroundColor(windowId, color) {
  const col = color || "#777";
  if (IS_FIREFOX) {
    browser.browserAction.setBadgeBackgroundColor({ color: col, windowId });
  } else if (IS_CHROME) {
    chrome.action.setBadgeBackgroundColor({ color: col });
  }
}

function setTabBadgeBackgroundColor(tabId, color) {
  const col = color || "#777";
  if (IS_CHROME) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: col });
  } else if (IS_FIREFOX) {
    browser.browserAction.setBadgeBackgroundColor({ color: col });
  }
}


const setBadge = async (windowId, activeTabId) => {
	let nbDuplicateTabs = tabsInfo.getNbDuplicateTabs(windowId);
	if (nbDuplicateTabs === "0" && !options.showBadgeIfNoDuplicateTabs)
		nbDuplicateTabs = "";
	const backgroundColor =
		nbDuplicateTabs !== "0"
			? options.badgeColorDuplicateTabs
			: options.badgeColorNoDuplicateTabs;
	if (IS_FIREFOX) {
		setWindowBadgeText(windowId, nbDuplicateTabs);
		setWindowBadgeBackgroundColor(windowId, backgroundColor);
	} else {
		// eslint-disable-next-line no-param-reassign
		activeTabId = activeTabId || (await getActiveTabId(windowId));
		if (activeTabId) {
			setTabBadgeText(activeTabId, nbDuplicateTabs);
			setTabBadgeBackgroundColor(activeTabId, backgroundColor);
		}
	}
};

const getNbDuplicateTabs = (duplicateTabsGroups) => {
	let nbDuplicateTabs = 0;
	if (duplicateTabsGroups.size !== 0) {
		duplicateTabsGroups.forEach(
			(duplicateTabs) => (nbDuplicateTabs += duplicateTabs.size - 1),
		);
	}
	return nbDuplicateTabs;
};

const updateBadgeValue = (nbDuplicateTabs, windowId) => {
	tabsInfo.setNbDuplicateTabs(windowId, nbDuplicateTabs);
	setBadge(windowId);
};

// eslint-disable-next-line no-unused-vars
const updateBadgesValue = async (duplicateTabsGroups, windowId) => {
	const nbDuplicateTabs = getNbDuplicateTabs(duplicateTabsGroups);
	if (options.searchInAllWindows) {
		const windows = await getWindows();
		windows.forEach((window) => updateBadgeValue(nbDuplicateTabs, window.id));
	} else {
		updateBadgeValue(nbDuplicateTabs, windowId);
	}
};

// eslint-disable-next-line no-unused-vars
const updateBadgeStyle = async () => {
	const windows = await getWindows();
	windows.forEach((window) => setBadge(window.id));
};
