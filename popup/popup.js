"use strict";

import { getActiveWindowId, sendMessage, getStoredOptions, areSameArrays } from "../helper.js";
import {
  requestDuplicateTabsFromPanel,
  closeDuplicateGroup,
  closeDuplicateTabs
} from "../worker.js";


let activeWindowId = chrome.windows.WINDOW_ID_NONE;
let lastDuplicateTabs = {};
let closePopup = false;
let environment = "";

/* Show/Hide the AutoClose option */
const changeAutoCloseOptionState = (state, resize) => {
	$("#onRemainingTabGroup").toggleClass("hidden", state !== "A");
	if (resize) resizeDuplicateTabsPanel();
};

const toggleShrunkMode = (checked) => {
	$(".list-group-form").toggleClass("shrunk", checked);
};

const toggleExpendOptions = (resize) => {
	$("#optionHeader").toggleClass("collapsed");
	if (resize) resizeDuplicateTabsPanel();
};

const toggleExpendGroup = (eventId, isTitleClickEvent, pinned, resize) => {
	if (isTitleClickEvent) {
		const groupId = eventId.replace("Title", "Group");
		$(`#${groupId}`).toggleClass("collapsed");
		resizeDuplicateTabsPanel();
	} else {
		const groupId = eventId.replace("Pinned", "Group");
		$(".pinned").last().removeClass("last-list-group");
		$(`#${groupId}`)
			.toggleClass("collapsed", !pinned)
			.toggleClass("pinned", pinned);
		if (resize) resizeDuplicateTabsPanel();
		$(".pinned").last().addClass("last-list-group");
	}
};

// put these near the top of popup.js (or just above setDuplicateTabsTable)
const _tabSortComparator = (a, b) => {
  // within a group: pinned → newest → active → index → title → id
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  const lcA = a.lastComplete ?? 0, lcB = b.lastComplete ?? 0;
  if (lcA !== lcB) return lcB - lcA;
  if (a.active !== b.active) return a.active ? -1 : 1;
  if (a.windowId === b.windowId && a.index != null && b.index != null && a.index !== b.index) {
    return a.index - b.index;
  }
  const t = (a.title || "").localeCompare(b.title || "");
  if (t) return t;
  return (a.id || 0) - (b.id || 0);
};

const _scoreTab = (t) => [
  t.windowId === activeWindowId ? 1 : 0,     // active window first
  t.pinned ? 1 : 0,                           // pinned first
  t.lastComplete ?? 0,                        // newest first
  t.active ? 1 : 0,                           // active tab next
  -(t.index ?? 1e9),                          // lower index better
];

const _cmpDescLex = (A, B) => {               // compare score arrays desc
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const a = A[i] ?? 0, b = B[i] ?? 0;
    if (a !== b) return b - a;
  }
  return 0;
};

const setDuplicateTabsTable = (duplicateTabs) => {
  if (areSameArrays(duplicateTabs, lastDuplicateTabs)) return;
  lastDuplicateTabs = duplicateTabs ? Array.from(duplicateTabs) : null;

  const $body = $("#duplicateTabsTableBody");
  $body.empty();

  if (!(duplicateTabs && duplicateTabs.length)) {
    $body.append(
      `<td class='td-tab-text'><em>${chrome.i18n.getMessage("noDuplicateTabs")}.</em></td>`
    );
    $("#closeDuplicateTabsBtn").addClass("disabled").prop("disabled", true);
    resizeDuplicateTabsPanel(true);
    return;
  }

  // 1) group by groupId
  const groups = new Map();
  duplicateTabs.forEach((t) => {
    if (!groups.has(t.groupId)) groups.set(t.groupId, []);
    groups.get(t.groupId).push(t);
  });

  // 2) compute a score per group (best tab in group) and sort groups
  const groupList = Array.from(groups.entries()).map(([groupId, tabs]) => {
    const best = tabs.reduce((acc, cur) => (_cmpDescLex(_scoreTab(cur), _scoreTab(acc)) < 0 ? cur : acc), tabs[0]);
    return { groupId, tabs, key: _scoreTab(best) };
  });
  groupList.sort((g1, g2) => _cmpDescLex(g1.key, g2.key));

  // 3) render groups with a single right-side button (rowspan), alt shading, and X on the left
  let groupIndex = 0;
  let html = "";

  const tdCloseOne =
    "<td class='td-close-button'><button type='button' class='close' aria-label='Close'><span aria-hidden='true'>&times;</span></button></td>";

  groupList.forEach(({ groupId, tabs }) => {
    const rows = tabs.slice().sort(_tabSortComparator);
    const shadeClass = (groupIndex % 2 === 0) ? "group-even" : "group-odd";
    const rowSpan = rows.length;

    rows.forEach((t, i) => {
		const containerStyle = t.containerColor
		? `style='text-decoration:underline; text-decoration-color:${t.containerColor};'`
		: "";
		const title = t.windowId === activeWindowId ? t.title : `<em>${t.title}</em>`;
		const tdTabIcon = `<td class='td-tab-icon'><img src='${t.icon}' alt=''></td>`;
		const tdTabTitle = `<td class='td-tab-title' ${containerStyle}>${title}</td>`;

		// only first row gets the group button on the far right (rowspan = group size)
		const tdGroupBtn = (i === 0)
		? `<td class='td-close-group' rowspan='${rowSpan}'>
			<button type='button'
					class='btn btn-xs btn-link td-group-btn text-danger'
					title='removeDuplicatesKeepLatest'
					aria-label='removeDuplicatesKeepLatest'>
				<span class='fa fa-eraser'></span>
				<span class="badge badge-light ml-1">${rows.length - 1}</span>
			</button>
			</td>`
		: "";


		html +=
		`<tr class='${shadeClass}' tabId='${t.id}' windowId='${t.windowId}' groupId='${groupId}'>` +
			tdCloseOne + tdTabIcon + tdTabTitle + tdGroupBtn +
		`</tr>`;
    });

    groupIndex++;
  });

  $body.append(html);
  $("#closeDuplicateTabsBtn").removeClass("disabled").prop("disabled", false);
  

  // newest groups are at top; keep the scroll parked at top
  document.getElementById("duplicateTabsTableContainer").scrollTop = 0;
  localizeAttrs(document.getElementById("duplicateTabsTableBody"));

  resizeDuplicateTabsPanel(true);
};

const resizeDuplicateTabsPanel = (refresh) => {
  if (refresh) highlightBottomScrollShadow();
};

const saveActiveWindowId = async () => {
	activeWindowId = await getActiveWindowId();
};

const requestCloseDuplicateTabs = () =>
	sendMessage("closeDuplicateTabs", { windowId: activeWindowId });

const saveOption = (name, value, refresh) =>
	sendMessage("setStoredOption", {
		name: name,
		value: value,
		refresh: refresh,
	});

const requestGetDuplicateTabs = () =>
	sendMessage("getDuplicateTabs", { windowId: activeWindowId });

const setPanelOptions = async () => {
	const response = await sendMessage("getStoredOptions");
	const storedOptions = response.data.storedOptions;
	const lockedKeys = response.data.lockedKeys;
	let collapseOptions = false;
	for (const storedOption in storedOptions) {
		const value = storedOptions[storedOption].value;
		const isLockedKey = lockedKeys.includes(storedOption);
		if (storedOption === "environment") {
			environment = value;
			if (value === "chrome") $(".containerItem").toggleClass("hidden", true);
		} else {
			// checkbox
			if (typeof value === "boolean") {
				$(`#${storedOption}`).prop("checked", value);
				if (
					storedOption.endsWith("Pinned") &&
					storedOption !== "customizationPinned"
				) {
					toggleExpendGroup(storedOption, false, value, false);
					// eslint-disable-next-line max-depth
					if (value) collapseOptions = false;
				} else if (storedOption === "shrunkMode") toggleShrunkMode(value);
				else if (storedOption === "closePopup") closePopup = value;
			}
			// combobox
			else {
				$(`#${storedOption} option[value='${value}']`).prop("selected", true);
				if (storedOption === "onDuplicateTabDetected")
					changeAutoCloseOptionState(value, false);
			}
			if (isLockedKey) $(`#${storedOption}`).prop("disabled", true);
		}
	}
	// if (collapseOptions) toggleExpendOptions(false);
};

const handleMessage = (message) => {
	if (message.action === "updateDuplicateTabsTable")
		setDuplicateTabsTable(message.data.duplicateTabs);
};

chrome.runtime.onMessage.addListener(handleMessage);

let highlightBottomScrollShadowTimer = null;
const highlightBottomScrollShadow = () => {
	clearTimeout(highlightBottomScrollShadowTimer);
	$("#duplicateTabsTableContainer").toggleClass(
		"table-scrollable-shadow",
		true,
	);
	highlightBottomScrollShadowTimer = setTimeout(
		() =>
			$("#duplicateTabsTableContainer").toggleClass(
				"table-scrollable-shadow",
				false,
			),
		400,
	);
};

// eslint-disable-next-line max-lines-per-function
const loadListenerEvents = () => {
	/* Save checkbox settings */
	$("input[type='checkbox']").on("change", function () {
		if (this.id.endsWith("Pinned"))
			toggleExpendGroup(this.id, false, this.checked, true);
		else if (this.id === "shrunkMode") toggleShrunkMode(this.checked);
		const refresh = this.className.includes("checkbox-filter");
		saveOption(this.id, this.checked, refresh);
	});

	/* Save combobox settings */
	$(".list-group select").on("change", function (event) {
		event.stopPropagation();
		const refresh = this.id === "scope";
		saveOption(this.id, this.value, refresh);
		if (this.id === "onDuplicateTabDetected")
			changeAutoCloseOptionState(this.value, true);
	});

	/* Open Option tab */
	$(".fa-cog").on("click", (event) => {
		event.stopPropagation();
		chrome.runtime.openOptionsPage();
	});

	/* Active selected tab */
	$("#duplicateTabsTable").on("click", ".td-tab-title", function () {
		const tabId = parseInt($(this).parent().attr("tabId"), 10);
		const windowId = parseInt($(this).parent().attr("windowId"), 10);
		focusTab(tabId, windowId);
	});

	/* Close selected tab */
	$("#duplicateTabsTable").on("click", ".td-close-button", function () {
		const tabId = parseInt($(this).parent().attr("tabId"), 10);
		removeTab(tabId);
	});

	/* Close all */
	$("#closeDuplicateTabsBtn").on("click", function () {
		if (!$(this).hasClass("disabled")) requestCloseDuplicateTabs();
		if (closePopup) window.close();
	});

	/* Toggle options panel */
	$("#optionsTitle").on("click", () => {
		toggleExpendOptions(true);
	});

	/* Toggle subitem panels */
	$(".list-group-item-title").on("click", function () {
		toggleExpendGroup(this.id, true);
	});

	/* Close entire group except the latest */
	$("#duplicateTabsTable").on("click", ".td-group-btn", function () {
	const $tr = $(this).closest("tr");
	const groupId = $tr.attr("groupId");
	const windowId = parseInt($tr.attr("windowId"), 10);
	if (!groupId) return;

	// disable to avoid double clicks
	$(this).prop("disabled", true);
	sendMessage("closeDuplicateGroup", { groupId, windowId })
		.then(() => requestGetDuplicateTabs())
		.finally(() => $(this).prop("disabled", false));

	if (closePopup) window.close();
	});


};

const localizePopup = () => {
	const node = document.documentElement;
	const attribute = "i18n-content";
	const elements = node.querySelectorAll(`[${attribute}]`);
	elements.forEach((element) => {
		const value = element.getAttribute(attribute);
		element.textContent = chrome.i18n.getMessage(value);
	});

	const tooltipAttribute = "title";
	const tooltipElements = node.querySelectorAll(`[${tooltipAttribute}]`);
	tooltipElements.forEach((el) => {
	const key = el.getAttribute(tooltipAttribute);
	el.setAttribute(tooltipAttribute, chrome.i18n.getMessage(key));
	});

};

// add near localizePopup()
const localizeAttrs = (root = document) => {
  // i18n-content (existing)
  const attr = "i18n-content";
  root.querySelectorAll(`[${attr}]`).forEach(el => {
    const key = el.getAttribute(attr);
    const val = chrome.i18n.getMessage(key);
    if (val) el.textContent = val;
  });

  // title
  root.querySelectorAll("[title]").forEach(el => {
    const key = el.getAttribute("title");
    const val = chrome.i18n.getMessage(key);
    if (val) el.setAttribute("title", val);
  });

  // aria-label
  root.querySelectorAll("[aria-label]").forEach(el => {
    const key = el.getAttribute("aria-label");
    const val = chrome.i18n.getMessage(key);
    if (val) el.setAttribute("aria-label", val);
  });
};


const startObserver = () => {
	const firefoxOverflowClass = "list-group-item-overflow-firefox";
	const chromeOverflowClass = "list-group-item-overflow-chrome";
	const overflowClass =
		environment == "firefox" ? firefoxOverflowClass : chromeOverflowClass;
	const observer = new ResizeObserver((entries) => {
		for (const entry of entries) {
			const overflow =
				`${entry.contentRect.bottom + 1}px` ===
				$("#optionsBody").css("max-height");
			$("#optionsBody").toggleClass(overflowClass, overflow);
		}
	});
	const optionsBody = document.querySelector("#optionsBody");
	observer.observe(optionsBody);
};

const initialize = async () => {
	await Promise.all([setPanelOptions(), saveActiveWindowId()]);
	requestGetDuplicateTabs();
	localizePopup();
	startObserver();
	loadListenerEvents();
};

document.addEventListener("DOMContentLoaded", initialize);
