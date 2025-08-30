// helper.js (ESM)
"use strict";

export const wait = (timeout) =>
  new Promise((resolve) => setTimeout(resolve, timeout));

export const debounce = (func, delay) => {
  const stored = new Map();
  return (...args) => {
    const windowId = args[0] || 1;
    const later = () => {
      const laterArgs = stored.get(windowId);
      if (laterArgs) {
        func(laterArgs);
        setTimeout(later, delay);
        stored.set(windowId, null);
      } else {
        stored.delete(windowId);
      }
    };

    if (!stored.has(windowId)) {
      func(args[1] || args[0]);
      setTimeout(later, delay);
      stored.set(windowId, null);
    } else {
      stored.set(windowId, args[1] || args[0] || 1);
    }
  };
};

export const isTabComplete = (tab) => tab.status === "complete";
export const isTabLoading  = (tab) => tab.status === "loading";

export const getTab = (tabId) =>
  new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError)
        console.error("getTab error:", chrome.runtime.lastError.message);
      resolve(chrome.runtime.lastError ? null : tab);
    });
  });

export const getTabs = (queryInfo) =>
  new Promise((resolve) => {
    queryInfo.windowType = "normal";
    chrome.tabs.query(queryInfo, (tabs) => {
      if (chrome.runtime.lastError)
        console.error("getTabs error:", chrome.runtime.lastError.message);
      resolve(chrome.runtime.lastError ? null : tabs);
    });
  });

export const getWindows = () =>
  new Promise((resolve) => {
    chrome.windows.getAll(null, (windows) => {
      if (chrome.runtime.lastError)
        console.error("getWindows error:", chrome.runtime.lastError.message);
      resolve(chrome.runtime.lastError ? null : windows);
    });
  });

export const updateWindow = (windowId, updateProperties) =>
  new Promise((resolve, reject) => {
    chrome.windows.update(windowId, updateProperties, () => {
      if (chrome.runtime.lastError) {
        console.error("updateWindow error:", chrome.runtime.lastError.message);
        reject();
      } else resolve();
    });
  });

const getActiveTab = async (windowId) => {
  const tabs = await getTabs({ windowId, active: true });
  return tabs ? tabs[0] : null;
};

export const getActiveTabId = async (windowId) => {
  const activeTab = await getActiveTab(windowId);
  return activeTab ? activeTab.id : null;
};

export const reloadTab = (tabId) =>
  new Promise((resolve, reject) => {
    chrome.tabs.reload(tabId, () => {
      if (chrome.runtime.lastError) {
        console.error("reloadTab error:", chrome.runtime.lastError.message);
        reject();
      } else resolve();
    });
  });

export const getActiveWindowId = () =>
  new Promise((resolve) => {
    chrome.windows.getLastFocused(null, (window) => {
      if (chrome.runtime.lastError)
        console.error("getActiveWindowId error:", chrome.runtime.lastError.message);
      resolve(chrome.runtime.lastError ? null : window.id);
    });
  });

export const updateTab = (tabId, updateProperties) =>
  new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateProperties, () => {
      if (chrome.runtime.lastError) {
        console.error("updateTab error:", tabId, updateProperties, chrome.runtime.lastError.message);
        reject();
      } else resolve();
    });
  });

export const activateWindow = (windowId) => updateWindow(windowId, { focused: true });
export const activateTab    = (tabId)    => updateTab(tabId, { active: true });

export const focusTab = (tabId, windowId) =>
  Promise.all([activateTab(tabId), activateWindow(windowId)]);

export const moveTab = (tabId, moveProperties) =>
  new Promise((resolve, reject) => {
    chrome.tabs.move(tabId, moveProperties, () => {
      if (chrome.runtime.lastError) {
        console.error("moveTab error:", chrome.runtime.lastError.message);
        reject();
      } else resolve();
    });
  });

export const removeTab = (tabId) =>
  new Promise((resolve, reject) => {
    chrome.tabs.remove(tabId, () => {
      if (chrome.runtime.lastError) {
        console.error("removeTab error:", chrome.runtime.lastError.message);
        reject();
      } else resolve();
    });
  });

export const setIcon = (details) =>
  new Promise((resolve) => {
    chrome.action.setIcon(details, () => {
      if (chrome.runtime.lastError)
        console.error("setIcon error:", chrome.runtime.lastError.message);
      resolve();
    });
  });

export const getStoredOptions = () =>
  Promise.all([
    new Promise((resolve) => {
      chrome.storage.local.get(null, (localOptions) => {
        if (chrome.runtime.lastError)
          console.error("getStoredOptions error on local:", chrome.runtime.lastError.message);
        resolve(localOptions);
      });
    }),
    !chrome.storage.managed
      ? null
      : new Promise((resolve) => {
          chrome.storage.managed.get(null, (managedOptions) => {
            if (chrome.runtime.lastError) {
              if (chrome.runtime.lastError.message === "Managed storage manifest not found") {
                console.warn("managed options manifest not found (expected)");
              } else {
                console.error("getStoredOptions error on managed:", chrome.runtime.lastError.message);
              }
            }
            resolve(managedOptions);
          });
        }),
  ]).then(([localOptions, managedOptions]) => ({
    storedOptions: Object.assign({}, localOptions || {}, managedOptions || {}),
    lockedKeys: Object.keys(managedOptions || {}),
  }));

export const clearStoredOptions = () =>
  new Promise((resolve) => {
    chrome.storage.local.clear(() => {
      if (chrome.runtime.lastError)
        console.error("clearStoredOptions error:", chrome.runtime.lastError.message);
      resolve();
    });
  });

export const saveStoredOptions = async (options, overwrite) => {
  if (overwrite) await clearStoredOptions();
  return new Promise((resolve) => {
    chrome.storage.local.set(options, () => {
      if (chrome.runtime.lastError)
        console.error("saveStoredOptions error:", chrome.runtime.lastError.message);
      resolve(Object.assign({}, options));
    });
  });
};

export const getPlatformInfo = () =>
  new Promise((resolve) => {
    chrome.runtime.getPlatformInfo((info) => {
      if (chrome.runtime.lastError)
        console.error("getPlatformInfo error:", chrome.runtime.lastError.message);
      resolve(info);
    });
  });

export const getFirefoxMajorVersion = async () => {
  const browserInfo = await browser.runtime.getBrowserInfo();
  return parseInt(browserInfo.version.split(".")[0], 10);
};

export const sendMessage = (action, data) =>
  new Promise((resolve, reject) => {
    const NO_RESPONSE = "The message port closed before a response was received.";
    chrome.runtime.sendMessage({ action, data }, (response) => {
      if (chrome.runtime.lastError) {
        if (chrome.runtime.lastError.message === NO_RESPONSE) resolve();
        else reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });

export const areSameArrays = (a, b) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
};
