// messageListener.js (ESM)
"use strict";

import { getStoredOptions } from "./helper.js";
import { setStoredOption } from "./options.js";
import {
  requestDuplicateTabsFromPanel,
  closeDuplicateTabs,
  closeDuplicateGroup,
} from "./worker.js";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const { action, data } = message || {};

      switch (action) {
        case "setStoredOption": {
          await setStoredOption(data.name, data.value, data.refresh);
          if (data.refresh) {
            await requestDuplicateTabsFromPanel(data.windowId ?? undefined);
          }
          sendResponse?.({ ok: true });
          break;
        }

        case "getStoredOptions": {
          const storedOptions = await getStoredOptions();
          sendResponse?.({ ok: true, data: storedOptions });
          break;
        }

        case "getDuplicateTabs": {
          await requestDuplicateTabsFromPanel(data.windowId);
          sendResponse?.({ ok: true });
          break;
        }

        case "closeDuplicateTabs": {
          await closeDuplicateTabs(data.windowId);
          await requestDuplicateTabsFromPanel(data.windowId);
          sendResponse?.({ ok: true });
          break;
        }

        case "closeDuplicateGroup": {
          await closeDuplicateGroup(data.groupId, data.windowId);
          await requestDuplicateTabsFromPanel(data.windowId);
          sendResponse?.({ ok: true });
          break;
        }

        default: {
          sendResponse?.({ ok: true });
          break;
        }
      }
    } catch (err) {
      console.error("messageListener error:", err);
      sendResponse?.({ ok: false, error: String(err) });
    }
  })();

  // allow async sendResponse
  return true;
});
	