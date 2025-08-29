"use strict";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const { action, data } = message || {};

      switch (action) {
        case "setStoredOption": {
          await setStoredOption(data.name, data.value, data.refresh);
          // If the option requires live refresh, push latest list
          if (data.refresh) {
            await requestDuplicateTabsFromPanel(data.windowId ?? undefined);
          }
          sendResponse && sendResponse({ ok: true });
          break;
        }

        case "getStoredOptions": {
          const storedOptions = await getStoredOptions();
          sendResponse && sendResponse({ data: storedOptions, ok: true });
          break;
        }

        case "getDuplicateTabs": {
          await requestDuplicateTabsFromPanel(data.windowId);
          sendResponse && sendResponse({ ok: true });
          break;
        }

        case "closeDuplicateTabs": {
          await closeDuplicateTabs(data.windowId);
          // Explicitly refresh the panel list after closing
          await requestDuplicateTabsFromPanel(data.windowId);
          sendResponse && sendResponse({ ok: true });
          break;
        }

        case "closeDuplicateGroup": {
          // Close all in group except latest
          await closeDuplicateGroup(data.groupId, data.windowId);
          // Explicitly refresh the panel list so sorting/UI update immediately
          await requestDuplicateTabsFromPanel(data.windowId);
          sendResponse && sendResponse({ ok: true });
          break;
        }

        default: {
          sendResponse && sendResponse({ ok: true });
          break;
        }
      }
    } catch (err) {
      console.error("messageListener error:", err);
      sendResponse && sendResponse({ ok: false, error: String(err) });
    }
  })();

  // Keep the port open for the awaited work above
  return true;
});
