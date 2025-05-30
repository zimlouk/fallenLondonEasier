// ==UserScript==
// @name         Fallen London Item Tracker
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  Track multiple Fallen London items with target goals, shows styled category in tooltip. Updates via API intercept & /possessions page.
// @author       xeoplise (enhanced by AI)
// @match        https://www.fallenlondon.com/*
// @icon         https://images.fallenlondon.com/favicon-fl.png
// @downloadURL  https://raw.githubusercontent.com/zimlouk/fallenLondonEasier/main/fallenLondonItemTracker.user.js
// @updateURL    https://raw.githubusercontent.com/zimlouk/fallenLondonEasier/main/fallenLondonItemTracker.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api.fallenlondon.com
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  // =========================================================================
  // === CONFIGURATION & CONSTANTS ===
  // =========================================================================

  // --- Behavior ---
  const WAIT_TIMEOUT_MS = 10000; // Max time to wait for elements on /possessions
  const RETRY_INTERVAL_MS = 500; // How often to retry finding elements
  const ENHANCE_DEBOUNCE_DELAY = 300; // Delay (ms) before re-enhancing /possessions after DOM changes

  // --- Selectors & Keys ---
  const API_USE_URL = "https://api.fallenlondon.com/api/storylet/usequality";
  const DISPLAY_ELEMENT_ID = "fl-item-tracker-sidebar"; // ID for the tracker sidebar
  const CONTAINER_CLASS = "fl-tracker-item-container"; // Class for individual item containers in sidebar
  const TRACKED_ITEM_IDS_KEY = "fl_tracker_tracked_ids_v4";
  const TOOLTIP_CLASS = "fl-tracker-tooltip"; // Class for tooltips in sidebar
  const VISIBLE_CLASS = "fl-tracker-tooltip-visible"; // Class for visible tooltips
  const USE_BUTTON_CLASS = "fl-tracker-use-button"; // Class for 'Use' button in tooltip
  const ADD_BUTTON_CLASS = "fl-tracker-add-button"; // Class for '+' button on /possessions items
  const POPUP_OVERLAY_ID = "fl-tracker-popup-overlay"; // ID for the target input popup overlay
  const POPUP_BOX_CLASS = "fl-tracker-popup-box"; // Class for the target input popup box
  const STORAGE_KEY_PREFIX = "fl_tracker_v4_item_"; // Prefix for storing individual item data
  const STORAGE_SUFFIX_TARGET = "target"; // Suffix for storing item target value
  const STORAGE_SUFFIX_CATEGORY = "category"; // Suffix for storing item category
  const API_CHOOSEBRANCH_PATTERN = /\/api\/storylet\/choosebranch$/;
  const API_SELL_PATTERN = /\/api\/exchange\/sell$/;
  const API_BUY_PATTERN = /\/api\/exchange\/buy$/; // 新增：购买 API 模式
  const INTERCEPT_PATTERNS = [
    API_CHOOSEBRANCH_PATTERN,
    API_SELL_PATTERN,
    API_BUY_PATTERN,
  ]; // 需要拦截的 URL 模式数组

  // List of known category/rarity words (lowercase) for identification
  const KNOWN_CATEGORIES = [
    "ubiquitous",
    "commonplace",
    "uncommon",
    "scarce",
    "rare",
    "coveted",
    "legendary",
  ];

  // --- State Variables ---
  let possessionsObserver = null; // MutationObserver for /possessions page
  let enhanceDebounceTimer = null; // Timer for debouncing /possessions enhancement
  let findIntervalId = null; // Interval ID for finding items on /possessions
  let isSidebarListenerSetup = false; // Flag to ensure sidebar listeners are set up only once

  // =========================================================================
  // === STYLES ===
  // =========================================================================

  GM_addStyle(`
        /* --- Sidebar Container --- */
        #${DISPLAY_ELEMENT_ID} {
            position: fixed;
            top: 50px; /* Avoid user menu */
            right: 0;
            height: calc(100vh - 50px); /* Adjust height for top offset */
            width: 75px; /* Sidebar width */
            font-size: 13px; /* Slightly smaller base font */
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            z-index: 10000;
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            align-items: center;
            gap: 10px;
            padding: 15px 5px;
            box-sizing: border-box;
            background-color: rgba(20, 20, 20, 0.85); /* Darker background */
            border-left: 1px solid #444;
            overflow: visible !important;
        }

        /* --- Tracked Item Container (in Sidebar) --- */
        .${CONTAINER_CLASS} {
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
            background-color: rgba(40, 40, 40, 0.9); /* Slightly darker */
            padding: 6px;
            border-radius: 4px;
            border: 1px solid #555;
            pointer-events: auto; /* Enable interaction */
            cursor: pointer;
            width: 60px; /* Fixed width */
            flex-shrink: 0;
            text-align: center;
            overflow: visible !important; /* Allow tooltip to overflow */
        }

        /* --- Item Icon & Quantity (in Sidebar) --- */
        #${DISPLAY_ELEMENT_ID} img.tracker-icon {
            width: 32px;
            height: 32px;
            vertical-align: middle;
            border-radius: 3px;
            flex-shrink: 0;
            margin-bottom: 5px;
            display: block; /* Ensure block display */
        }
        #${DISPLAY_ELEMENT_ID} .tracker-icon.placeholder { /* Style for placeholder if icon fails */
            width: 32px; height: 32px; background: #333; color: #888;
            display: flex; align-items: center; justify-content: center;
            border-radius: 3px; margin-bottom: 5px; font-size: 18px;
        }
        #${DISPLAY_ELEMENT_ID} .tracker-quantity {
            color: #AEEA00; /* Bright green */
            font-weight: bold;
            font-size: 12px;
            line-height: 1.2; /* Adjust line height */
            word-wrap: break-word; /* Wrap long numbers if needed */
        }

        /* --- Tooltip (in Sidebar) --- */
        .${TOOLTIP_CLASS} {
            display: none;
            position: absolute;
            top: 50%;
            right: calc(100% + 8px); /* Position to the left */
            left: auto;
            transform: translateY(-50%);
            background-color: rgba(10, 10, 10, 0.97); /* Even darker */
            color: #E0E0E0;
            border: 1px solid #666;
            border-radius: 5px;
            padding: 10px 12px;
            width: max-content; /* Adjust width to content */
            max-width: 300px; /* Limit max width */
            font-size: 13px;
            z-index: 10001; /* Above item container */
            text-align: left;
            white-space: normal;
            box-shadow: -3px 3px 8px rgba(0, 0, 0, 0.5);
            pointer-events: auto; /* Enable interaction */
            cursor: default;
        }
        .${TOOLTIP_CLASS}.${VISIBLE_CLASS} {
            display: block;
        }
        .${TOOLTIP_CLASS} .tooltip-name {
            font-weight: bold;
            color: #FFF;
            font-size: 14px;
            margin-bottom: 6px;
            display: block;
        }
        .tooltip-desc-line {
            display: block;
            margin-bottom: 8px;
            line-height: 1.4;
        }
        .tooltip-category {
            font-weight: bold !important;
            font-style: italic !important;
            margin-right: 0.4em;
            color: #DDD;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.7);
        }
        .tooltip-description {
            color: #BBB;
            font-weight: normal;
            font-style: normal;
        }
        .${TOOLTIP_CLASS} .${USE_BUTTON_CLASS} { /* 'Use' button in tooltip */
            background-color: #555; color: #FFF; border: 1px solid #777;
            padding: 4px 10px; border-radius: 3px; cursor: pointer;
            font-size: 12px; display: block; margin-top: 8px;
            text-align: center; width: 100%; box-sizing: border-box;
        }
        .${TOOLTIP_CLASS} .${USE_BUTTON_CLASS}:hover:not([disabled]) {
            background-color: #666; border-color: #888;
        }
        .${TOOLTIP_CLASS} .${USE_BUTTON_CLASS}[disabled] {
            background-color: #444; color: #888; cursor: not-allowed; border-color: #555;
        }
        .${TOOLTIP_CLASS} .tooltip-status { /* Status messages in tooltip */
            font-size: 11px; margin-top: 5px; padding: 3px; text-align: center;
            border-radius: 3px; display: block; min-height: 1em;
        }
        .${TOOLTIP_CLASS} .tooltip-status.success { background-color: rgba(50, 120, 50, 0.7); color: #C8E6C9; }
        .${TOOLTIP_CLASS} .tooltip-status.error { background-color: rgba(120, 50, 50, 0.7); color: #FFCDD2; }
                /* --- Tooltip Header (Name + Untrack Button) --- */
        .${TOOLTIP_CLASS} .tooltip-header {
            display: flex;
            justify-content: space-between; /* Pushes name left, button right */
            align-items: center; /* Vertically align items */
            margin-bottom: 8px; /* Space below header */
            gap: 8px; /* Space between name and button */
        }
        .${TOOLTIP_CLASS} .tooltip-name {
            font-weight: bold;
            color: #FFF;
            font-size: 14px;
            margin-bottom: 0; /* Remove bottom margin as header handles spacing */
            flex-grow: 1; /* Allow name to take available space */
        }
        .${TOOLTIP_CLASS} .fl-tracker-untrack-btn {
            display: inline-flex; /* Use flex for centering */
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            background-color: #553333; /* Dark red */
            color: #fcc;
            border: 1px solid #885555;
            border-radius: 3px; /* Slightly rounded */
            font-size: 14px;
            font-weight: bold;
            line-height: 16px; /* Adjust for vertical centering */
            text-align: center;
            cursor: pointer;
            padding: 0;
            flex-shrink: 0; /* Prevent button from shrinking */
            transition: background-color 0.15s ease, border-color 0.15s ease;
        }
        .${TOOLTIP_CLASS} .fl-tracker-untrack-btn:hover {
            background-color: #774444;
            border-color: #aa7777;
            color: #fff;
        }

        /* Adjust description line margin if header provides enough space */
        .tooltip-desc-line {
            margin-top: 4px; /* Add a little space above description */
        }

        /* --- Add/Track Button (on /possessions) --- */
        .icon[data-quality-id] { position: relative; } /* Ensure parent is positioned */
        .${ADD_BUTTON_CLASS} {
            position: absolute;
            top: -5px; right: -5px;
            width: 18px; height: 18px;
            background-color: #282520 !important; color: #fff !important;
            border: 1px solid #4d4a45 !important;
            border-radius: 11px; /* Circular */
            font-family: "Roboto Slab", Georgia, Times, serif;
            font-size: 12px; font-weight: normal; line-height: 17px;
            text-align: center; cursor: pointer;
            z-index: 5; opacity: 0.85; /* Slightly less opaque */
            transition: opacity 0.2s, transform 0.2s, background-color 0.2s;
            box-shadow: 0 1px 2px rgba(0,0,0,0.3);
            display: flex; align-items: center; justify-content: center;
        }
        .${ADD_BUTTON_CLASS}:hover {
            opacity: 1; transform: scale(1.1); background-color: #383430 !important;
        }
        .${ADD_BUTTON_CLASS}.selected {
            background-color: #ffd75e !important; /* Gold when tracked */
            color: #3a2e1d !important;
            border-color: #d4b343 !important;
            line-height: 16px; /* Adjust line-height for checkmark */
        }

        /* --- Target Input Popup Styles --- */
        #${POPUP_OVERLAY_ID} {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background-color: rgba(0, 0, 0, 0.75);
            z-index: 10002; /* Above sidebar tooltip */
            display: flex; align-items: center; justify-content: center;
        }
        .${POPUP_BOX_CLASS} {
            background-color: #111; border: 1px solid #555;
            padding: 20px 25px; color: #ccc;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            min-width: 300px; max-width: 400px;
            box-shadow: 0 0 15px rgba(0,0,0,0.5);
            border-radius: 0; /* Sharp corners */
            text-align: left;
        }
        .${POPUP_BOX_CLASS} h3 {
            margin-top: 0; margin-bottom: 15px; color: #eee; font-size: 16px;
            border-bottom: 1px solid #444; padding-bottom: 8px;
        }
        .${POPUP_BOX_CLASS} label {
            display: block; margin-bottom: 5px; font-size: 14px; color: #bbb;
        }
        .${POPUP_BOX_CLASS} input[type="number"] {
            width: 100%; padding: 8px 10px; margin-bottom: 15px;
            background-color: #222; border: 1px solid #555; color: #eee;
            font-size: 14px; box-sizing: border-box; border-radius: 0;
        }
        .${POPUP_BOX_CLASS} input[type=number]::-webkit-outer-spin-button,
        .${POPUP_BOX_CLASS} input[type=number]::-webkit-inner-spin-button {
            -webkit-appearance: none; margin: 0;
        }
        .${POPUP_BOX_CLASS} input[type=number] { -moz-appearance: textfield; }

        .fl-tracker-popup-buttons {
            display: flex; justify-content: space-between; gap: 10px;
            margin-top: 15px; flex-wrap: wrap;
        }
        /* Base style for ALL popup buttons, mimicking game's primary style */
        .fl-tracker-popup-buttons button {
            padding: 10px 20px; flex-grow: 1; margin: 0; text-align: center; min-width: 80px;
            background-color: rgb(66, 104, 107); border: 1px solid rgb(45, 82, 86);
            color: rgb(185, 225, 228); font-family: "Roboto Slab", Georgia, Times, serif;
            font-weight: 700; font-size: 13px; letter-spacing: 0.65px; text-transform: uppercase;
            box-shadow: rgba(0, 0, 0, 0.5) 0px 1px 2px 0px; border-radius: 0;
            cursor: pointer; user-select: none; appearance: none; -webkit-appearance: none; -moz-appearance: none;
            transition: background-color 0.15s ease, border-color 0.15s ease;
        }
        /* Base Hover style */
        .fl-tracker-popup-buttons button:hover {
            background-color: rgb(76, 114, 117); border-color: rgb(55, 92, 96);
        }
        /* Primary Button (Set/Update) - Uses the base style */
        /* Danger Button (Untrack) - Override colors */
        .fl-tracker-popup-buttons button.danger {
            background-color: rgb(107, 66, 66); border-color: rgb(86, 45, 45); color: rgb(228, 185, 185);
        }
        .fl-tracker-popup-buttons button.danger:hover {
            background-color: rgb(127, 76, 76); border-color: rgb(106, 55, 55);
        }

        /* --- Loading/Error States --- */
        #${DISPLAY_ELEMENT_ID}.loading .${CONTAINER_CLASS}, .${CONTAINER_CLASS}.loading { opacity: 0.7; cursor: wait; }
        #${DISPLAY_ELEMENT_ID}.error .${CONTAINER_CLASS}, .${CONTAINER_CLASS}.error { border-color: #A00; }

        /* --- Imitation Styles --- */
        #fl-item-tracker-sidebar {
            position: fixed;
            top: 65px;
            right: 0;
            width: 54px;
            min-width: 28px;
            z-index: 10000;
            display: flex;
            flex-direction: column;
            align-items: flex-end; /* Align content (arrow) to the right */
            background: linear-gradient(to right,rgb(189, 178, 158) 85%,rgb(182, 173, 144) 100%);
            box-shadow: -2px 0 8px rgba(90,80,50,0.07);
            padding: 0;
            box-sizing: border-box; /* IMPORTANT: Keep border-box */
            font-family: "Roboto Slab", Georgia, Times, serif;
            border-top: 2px solid rgb(137, 125, 103);
            border-bottom: 2px solid rgb(137, 125, 103);
            border-left: 2px solid rgb(137, 125, 103);
        }
        #fl-item-tracker-sidebar.fl-tracker-collapsed {
            width: 28px !important;
            min-width: 28px;
            background: transparent !important;
            border: none !important; /* <<< ADD THIS to remove all borders */
            box-shadow: none !important;
            padding: 0;
        }

        /* --- Arrow / Toggle Button --- */
        #fl-item-tracker-sidebar .fl-tracker-arrow {
            width: 100%;
            height: 25px; /* Make it shorter */
            background: #d0c6b4; /* Base color slightly darker than items */
            color: #8d7500; /* Use text color from quantity */
            font-size: 16px; /* Smaller font size */
            border: none; /* Remove border */
            border-bottom: 1px solid #b9a365; /* Add bottom border */
            border-radius: 0;
            display: flex;
            align-items: center;
            justify-content: center; /* Center the content */
            cursor: pointer;
            box-shadow: none; /* Remove shadow */
            transition: background-color 0.16s, color 0.16s;
            margin-bottom: 8px;
            padding: 0; /* Remove padding */
            box-sizing: border-box;
            text-align: center;
        }
        #fl-item-tracker-sidebar .fl-tracker-arrow:hover {
            background: #e0d8c7; /* Lighter hover */
            color: #a38a00;
        }

        /* Style when collapsed */
        #fl-item-tracker-sidebar.fl-tracker-collapsed .fl-tracker-arrow {
             background: #c0b6a5; /* Slightly different background when collapsed */
             border-bottom-color: #a89d7c;
        }


        #fl-item-tracker-sidebar .fl-tracker-content {
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 100%;
            gap: 8px;                      /* item间距 */
        }
        #fl-item-tracker-sidebar.fl-tracker-collapsed .fl-tracker-content {
            display: none !important;
        }
        #fl-item-tracker-sidebar .fl-tracker-item-container {
            /* Layout (Keep existing necessary layout styles) */
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 46px; /* Keep your desired width */
            min-height: 48px; /* Keep your desired min-height */
            flex-shrink: 0;
            text-align: center;
            overflow: visible !important; /* Keep for tooltip */
            box-sizing: border-box;

            /* Native Style Imitation (Apply new styles) */
            background-color: rgb(237, 227, 210);
            background-image: url(https://images.fallenlondon.com/static/bg-paper.png);
            background-position: 0 0; /* Optional: Explicitly set */
            background-repeat: repeat; /* Optional: Explicitly set */
            border: none; /* Remove previous border */
            border-radius: 0; /* Sharp corners */
            padding: 5px 4px; /* Adjusted padding (Top/Bottom 5px, Left/Right 4px) */
            box-shadow: 0 2px 3px rgba(145, 133, 110, 0.6); /* Native shadow color with alpha */
            color: rgb(40, 37, 32); /* Base text color */

            /* Ensure pointer events for interaction */
            pointer-events: auto;
            cursor: pointer;
        }
        #fl-item-tracker-sidebar img.tracker-icon {
            width: 32px;                      /* Increased size */
            height: 32px;                     /* Increased size */
            border-radius: 0;                 /* Keep sharp corners */
            margin-bottom: 4px;               /* Adjust margin slightly for new size/border */
            border: 2px solid rgb(56, 56, 56);/* Apply native border */
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); /* Apply native shadow */
            box-sizing: border-box;           /* Include border in size calculation */
            display: block;                   /* Keep as block */
            vertical-align: middle;           /* Align vertically */
            flex-shrink: 0; /* Keep this */
        }
        #fl-item-tracker-sidebar .tracker-quantity {
            font-size: clamp(11px, 1.5vw, 13px);
            color: #8d7500;
            font-weight: bold;
            margin-top: 2px;
            text-shadow: 0 1px 0 #f8e6b7;
            font-family: "Roboto Slab", Georgia, Times, serif;
            word-break: break-all;
            text-align: center;
            max-width: 42px;
            line-height: 1.2;
            /* background: #ded5c5; */ /* REMOVED development note */
            border-radius: 0;
            padding: 1px 2px;
            box-sizing: border-box;
            overflow-wrap: anywhere;
            white-space: normal;
        }
        #fl-item-tracker-sidebar .fl-tracker-placeholder {
            color: #8d7500; /* Match quantity text color */
            font-style: italic;
            font-size: 11px; /* Smaller font */
            text-align: center;
            padding: 10px 5px; /* Add padding */
            width: 100%; /* Take full width of content area */
            box-sizing: border-box;
            word-wrap: break-word; /* Allow wrapping */
            overflow-wrap: break-word; /* Cross-browser wrapping */
            white-space: normal; /* Ensure wrapping is allowed */
            line-height: 1.3;
            display: block; /* Make it a block */
        }
    `);

  // =========================================================================
  // === HELPER FUNCTIONS ===
  // =========================================================================

  /** Returns the storage key prefix for a given item ID. */
  function getStorageKeyPrefix(itemId) {
    return `${STORAGE_KEY_PREFIX}${itemId}_`;
  }

  /** Gets the list of tracked item IDs from storage. */
  function getTrackedItemIds() {
    const storedValue = GM_getValue(TRACKED_ITEM_IDS_KEY, "[]");
    try {
      const ids = JSON.parse(storedValue);
      return Array.isArray(ids)
        ? ids.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id))
        : [];
    } catch (e) {
      console.error(
        "FL Tracker: Error parsing tracked IDs, returning empty list.",
        e
      );
      return [];
    }
  }

  /** Saves the list of tracked item IDs to storage. */
  function setTrackedItemIds(ids) {
    if (!Array.isArray(ids)) return;
    const uniqueIds = [
      ...new Set(ids.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id))),
    ];
    GM_setValue(TRACKED_ITEM_IDS_KEY, JSON.stringify(uniqueIds));
  }

  /** Gets the target value for a specific item ID. */
  function getItemTarget(itemId) {
    const storedTarget = GM_getValue(
      getStorageKeyPrefix(itemId) + STORAGE_SUFFIX_TARGET,
      null
    );
    if (storedTarget === null || storedTarget === "") return null;
    const targetNum = parseInt(storedTarget, 10);
    return !isNaN(targetNum) && targetNum >= 0 ? targetNum : null;
  }

  /** Sets or removes the target value for a specific item ID and updates its display. */
  function setItemTarget(itemId, targetValue) {
    const prefix = getStorageKeyPrefix(itemId);
    let targetToStore = ""; // Default to empty string (remove target)
    if (
      targetValue !== null &&
      targetValue !== "" &&
      targetValue !== undefined
    ) {
      const targetNum = parseInt(targetValue, 10);
      if (!isNaN(targetNum) && targetNum >= 0) {
        targetToStore = targetNum.toString();
        // console.log(`FL Tracker: Setting target for item ${itemId} to ${targetNum}`); // Removed log
      } else {
        console.warn(
          `FL Tracker: Invalid target value "${targetValue}" for item ${itemId}. Removing target.`
        );
      }
    } else {
      // console.log(`FL Tracker: Removing target for item ${itemId}`); // Removed log
    }
    GM_setValue(prefix + STORAGE_SUFFIX_TARGET, targetToStore);

    // Update the display immediately after setting/removing target
    const currentQuantity = GM_getValue(prefix + "quantity", "?");
    updateTrackedItemDisplay(itemId, currentQuantity);
  }

  /** Stores essential item data (name, quantity, icon, etc.) to GM storage. */
  function storeItemData(itemData) {
    if (!itemData || !itemData.id) return;
    const prefix = getStorageKeyPrefix(itemData.id);
    GM_setValue(prefix + "name", itemData.name);
    GM_setValue(prefix + "quantity", itemData.quantity);
    GM_setValue(prefix + "icon", itemData.icon);
    GM_setValue(prefix + STORAGE_SUFFIX_CATEGORY, itemData.category || "");
    GM_setValue(prefix + "description", itemData.description || "");
    GM_setValue(prefix + "is_usable", itemData.isUsable);
  }

  /** Attempts to find the JWT authentication token in browser storage. */
  function findAuthToken() {
    console.log("FL Tracker: Attempting to find JWT...");
    const jwtRegex = /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]*$/;
    for (const storage of [localStorage, sessionStorage]) {
      try {
        for (const key of Object.keys(storage)) {
          const value = storage.getItem(key);
          if (
            value &&
            typeof value === "string" &&
            value.startsWith("ey") &&
            value.includes(".") &&
            jwtRegex.test(value)
          ) {
            console.log(
              `FL Tracker: Found potential JWT in ${
                storage === localStorage ? "localStorage" : "sessionStorage"
              }.`
            );
            return value;
          }
        }
      } catch (e) {
        console.warn(
          `FL Tracker: Error accessing ${
            storage === localStorage ? "localStorage" : "sessionStorage"
          }`,
          e
        );
      }
    }
    console.error("FL Tracker: Could not automatically find JWT.");
    return null;
  }

  /** Displays a status message within a tooltip. */
  function showStatusMessage(tooltipElement, message, type = null) {
    if (!tooltipElement) return;
    let statusDiv = tooltipElement.querySelector(".tooltip-status");
    if (!statusDiv) {
      statusDiv = document.createElement("div");
      statusDiv.className = "tooltip-status";
      // Insert after the main content but before buttons if possible
      const button = tooltipElement.querySelector(`.${USE_BUTTON_CLASS}`);
      const descLine = tooltipElement.querySelector(".tooltip-desc-line");
      if (button) button.insertAdjacentElement("beforebegin", statusDiv);
      else if (descLine) descLine.insertAdjacentElement("afterend", statusDiv);
      else tooltipElement.appendChild(statusDiv); // Fallback
      statusDiv.style.marginTop = "8px"; // Add margin if newly created
    }

    statusDiv.textContent = message;
    statusDiv.className = "tooltip-status"; // Reset classes
    if (type === "success") statusDiv.classList.add("success");
    else if (type === "error") statusDiv.classList.add("error");
    statusDiv.style.display = message ? "block" : "none";
  }

  /** Waits for an element matching the selector to appear in the DOM. */
  function waitForElement(
    selector,
    callback,
    timeout = WAIT_TIMEOUT_MS,
    interval = RETRY_INTERVAL_MS
  ) {
    const startTime = Date.now();
    const timer = setInterval(() => {
      const element = document.querySelector(selector);
      if (element) {
        clearInterval(timer);
        // console.log(`FL Tracker: Element "${selector}" found.`); // Removed log
        callback(element);
      } else if (Date.now() - startTime > timeout) {
        clearInterval(timer);
        console.warn(`FL Tracker: Timeout waiting for element "${selector}".`);
        callback(null); // Indicate timeout
      }
    }, interval);
  }

  // =========================================================================
  // === UI FUNCTIONS (SIDEBAR & POPUP) ===
  // =========================================================================

  /** Sets up delegated event listeners for the sidebar display bar. */
  function setupSidebarListeners(displayBar) {
    if (isSidebarListenerSetup) return;
    console.log("FL Tracker: Setting up sidebar listeners.");

    // --- SINGLE CORRECTED LISTENER ---
    displayBar.addEventListener("click", (event) => {
      const target = event.target;
      const container = target.closest(`.${CONTAINER_CLASS}`); // Check clicks within item containers first

      if (container) {
        // Click was inside an item container or its tooltip
        const itemId = parseInt(container.dataset.itemId || "0", 10);
        const tooltip = container.querySelector(`.${TOOLTIP_CLASS}`);
        if (!itemId || !tooltip) return;

        // Handle 'Use' button click
        const useButton = target.closest(`.${USE_BUTTON_CLASS}`);
        if (useButton) {
          event.stopPropagation();
          useTrackedItem(itemId, useButton);
          return;
        }

        // Handle Untrack button click
        const untrackButton = target.closest(".fl-tracker-untrack-btn");
        if (untrackButton) {
          event.preventDefault();
          event.stopPropagation();
          // console.log(`FL Tracker: Untrack button clicked for item ${itemId}`); // Removed log
          untrackItem(itemId);
          return;
        }

        // Handle click inside tooltip content (allow interaction)
        if (tooltip.contains(target)) {
          event.stopPropagation();
          return;
        }

        // Handle click on container itself (toggle tooltip)
        event.stopPropagation();
        // console.log(`FL Tracker: Toggling tooltip for item ${itemId}`); // Removed log
        const isCurrentlyVisible = tooltip.classList.contains(VISIBLE_CLASS);

        // Hide other tooltips
        document
          .querySelectorAll(
            `#${DISPLAY_ELEMENT_ID} .${TOOLTIP_CLASS}.${VISIBLE_CLASS}`
          )
          .forEach((visibleTooltip) => {
            if (visibleTooltip !== tooltip) {
              visibleTooltip.classList.remove(VISIBLE_CLASS);
              showStatusMessage(visibleTooltip, "", null);
            }
          });

        // Toggle current tooltip
        if (!isCurrentlyVisible) {
          tooltip.classList.add(VISIBLE_CLASS);
          showStatusMessage(tooltip, "", null);
        } else {
          tooltip.classList.remove(VISIBLE_CLASS);
        }
        return; // Handled
      }

      // Handle click on the arrow toggle itself (outside any item container)
      const arrowButton = target.closest(".fl-tracker-arrow");
      if (arrowButton) {
        // The arrow's own listener handles the toggle class/symbol
        // We might not need to do anything extra here unless saving state
        // console.log("FL Tracker: Arrow toggle clicked."); // Removed log
        // Example: Save state
        // const isCollapsed = displayBar.classList.contains("fl-tracker-collapsed");
        // GM_setValue("fl_tracker_collapsed", isCollapsed);
      }
    });
    // --- END OF SINGLE CORRECTED LISTENER ---

    // Listener on the document to close tooltips when clicking outside
    document.addEventListener(
      "click",
      (event) => {
        const displayBarElement = document.getElementById(DISPLAY_ELEMENT_ID);
        if (!displayBarElement) return;
        const visibleTooltip = displayBarElement.querySelector(
          `.${TOOLTIP_CLASS}.${VISIBLE_CLASS}`
        );
        if (!visibleTooltip) return;

        // Check if click was inside the sidebar OR the visible tooltip
        const clickedInsideSidebar = displayBarElement.contains(event.target);
        const clickedInsideVisibleTooltip = visibleTooltip.contains(
          event.target
        );

        if (!clickedInsideSidebar && !clickedInsideVisibleTooltip) {
          // console.log("FL Tracker: Click outside sidebar/tooltip, hiding tooltip."); // Removed log
          visibleTooltip.classList.remove(VISIBLE_CLASS);
          showStatusMessage(visibleTooltip, "", null);
        }
      },
      true
    );

    isSidebarListenerSetup = true;
  }

  /** Updates the display of a single tracked item in the sidebar (quantity & button state). */
  function updateTrackedItemDisplay(itemId, newQuantity) {
    const displayBar = document.getElementById(DISPLAY_ELEMENT_ID);
    if (!displayBar) return;

    const quantitySpan = displayBar.querySelector(
      `.tracker-quantity[data-item-id="${itemId}"]`
    );
    if (quantitySpan) {
      const itemTarget = getItemTarget(itemId);
      const formattedQuantity =
        itemTarget !== null ? `${newQuantity} / ${itemTarget}` : newQuantity;
      if (quantitySpan.textContent !== formattedQuantity) {
        console.log(
          `FL Tracker: Updating display for ${itemId} to "${formattedQuantity}"` // Kept this log as it confirms background updates
        );
        quantitySpan.textContent = formattedQuantity;
      }
    } else {
      // This can happen if the item was just added/removed, displayTrackedItems will handle it.
      return;
    }
    updateUseButtonState(itemId, newQuantity);
  }

  /** Updates the enabled/disabled state and title of the 'Use' button for an item. */
  function updateUseButtonState(itemId, quantity) {
    const displayBar = document.getElementById(DISPLAY_ELEMENT_ID);
    if (!displayBar) return;
    const useButton = displayBar.querySelector(
      `.${USE_BUTTON_CLASS}[data-item-id="${itemId}"]`
    );
    if (useButton) {
      const qtyNum = parseInt(quantity, 10) || 0;
      const isDisabled = qtyNum <= 0;
      useButton.disabled = isDisabled;
      // Only update title if it changes, reduces unnecessary DOM manipulation
      const newTitle = isDisabled
        ? "Cannot use: Qty 0"
        : `Use ${GM_getValue(
            getStorageKeyPrefix(itemId) + "name",
            `Item ${itemId}`
          )}`;
      if (useButton.title !== newTitle) {
        useButton.title = newTitle;
      }
    }
  }

  /** Creates/updates the sidebar display, adding/removing items as needed. */
  function displayTrackedItems() {
    let displayBar = document.getElementById(DISPLAY_ELEMENT_ID);
    let arrow, content;

    // --- Setup Sidebar Structure if it doesn't exist ---
    if (!displayBar) {
      console.log("FL Tracker: Creating sidebar display element.");
      displayBar = document.createElement("div");
      displayBar.id = DISPLAY_ELEMENT_ID;

      // CREATE arrow and content elements FIRST
      arrow = document.createElement("div");
      arrow.className = "fl-tracker-arrow";
      arrow.title = "Toggle Tracker Sidebar";
      arrow.innerHTML = "▶"; // Default to collapsed symbol

      content = document.createElement("div");
      content.className = "fl-tracker-content";

      // APPEND them to the displayBar in the correct order
      displayBar.appendChild(arrow);
      displayBar.appendChild(content);
      document.body.appendChild(displayBar); // Add the completed bar to the body

      // ADD listener to the newly created arrow
      arrow.addEventListener("click", function (e) {
        e.stopPropagation();
        const isCollapsing = !displayBar.classList.contains(
          "fl-tracker-collapsed"
        );
        displayBar.classList.toggle("fl-tracker-collapsed", isCollapsing);
        arrow.innerHTML = isCollapsing ? "▶" : "◀";
        // Optional: Save state
        // GM_setValue("fl_tracker_collapsed", isCollapsing);
      });

      // SET initial collapsed state
      displayBar.classList.add("fl-tracker-collapsed"); // Start collapsed
      arrow.innerHTML = "▶"; // Set initial icon for collapsed state

      setupSidebarListeners(displayBar); // Setup listeners for the whole sidebar ONLY when bar created
    } else {
      // Sidebar already exists, find existing elements
      arrow = displayBar.querySelector(".fl-tracker-arrow");
      content = displayBar.querySelector(".fl-tracker-content");
      // Ensure arrow icon is correct on reload
      if (arrow) {
        arrow.innerHTML = displayBar.classList.contains("fl-tracker-collapsed")
          ? "▶"
          : "◀";
      }
    }

    // Ensure content element is valid before proceeding
    if (!content) {
      console.error("FL Tracker: Failed to find/create content container!");
      return; // Stop if content div is missing
    }

    // --- Clear and Populate Content Area ---
    content.innerHTML = ""; // Clear previous items/placeholder

    const trackedIds = getTrackedItemIds();

    if (trackedIds.length === 0) {
      // --- ADD PLACEHOLDER ---
      let placeholder = document.createElement("span");
      placeholder.className = "fl-tracker-placeholder"; // Use the CSS class
      placeholder.textContent =
        "Click '+' on an item in Possessions to track it.";
      content.appendChild(placeholder);
      // --- END PLACEHOLDER ---
    } else {
      // --- ADD TRACKED ITEMS ---
      const containers = []; // Array to hold generated containers for sorting
      trackedIds.forEach((itemId) => {
        const prefix = getStorageKeyPrefix(itemId);
        const item = {
          // Create an item object for clarity
          id: itemId,
          name: GM_getValue(prefix + "name", `Item ${itemId}`),
          quantity: GM_getValue(prefix + "quantity", "?"),
          icon: GM_getValue(prefix + "icon", ""),
          category: GM_getValue(prefix + STORAGE_SUFFIX_CATEGORY, ""),
          description: GM_getValue(
            prefix + "description",
            "No description available."
          ),
          isUsable: GM_getValue(prefix + "is_usable", false),
          target: getItemTarget(itemId),
        };

        const container = document.createElement("div");
        container.className = CONTAINER_CLASS; // Use the correct CONTAINER_CLASS for items
        container.dataset.itemId = itemId;

        // Build Tooltip HTML
        let tooltipHTML = `<div class="${TOOLTIP_CLASS}">`;
        tooltipHTML += `<div class="tooltip-header">`;
        tooltipHTML += `<span class="tooltip-name">${item.name}</span>`;
        tooltipHTML += `<button class="fl-tracker-untrack-btn" data-item-id="${item.id}" title="Untrack this item">×</button>`;
        tooltipHTML += `</div>`;
        tooltipHTML += `<span class="tooltip-desc-line">`;
        if (item.category)
          tooltipHTML += `<span class="tooltip-category">${item.category}</span>`;
        tooltipHTML += `<span class="tooltip-description">${item.description}</span>`;
        tooltipHTML += `</span>`;
        if (item.isUsable) {
          tooltipHTML += `<button class="${USE_BUTTON_CLASS}" data-item-id="${item.id}" title="Use ${item.name}">Use</button>`;
          tooltipHTML += `<div class="tooltip-status" style="display: none;"></div>`;
        }
        tooltipHTML += `</div>`; // End tooltip

        // Visible Part HTML
        let visibleHTML = item.icon
          ? `<img src="${item.icon}" alt="Icon" class="tracker-icon" loading="lazy">` // Use .tracker-icon class
          : `<span class="tracker-icon placeholder">?</span>`; // Use .tracker-icon class
        const formattedQuantity =
          item.target !== null
            ? `${item.quantity} / ${item.target}`
            : item.quantity;
        visibleHTML += `<span class="tracker-quantity" data-item-id="${item.id}">${formattedQuantity}</span>`; // Use .tracker-quantity class

        container.innerHTML = visibleHTML + tooltipHTML;
        containers.push(container); // Add to array for sorting

        // Set initial button state (will be attached later)
        updateUseButtonState(item.id, item.quantity);

        // Apply loading state if finder is active
        if (findIntervalId) container.classList.add("loading", "error");
      });

      // Reorder based on trackedIds and append to content
      const desiredOrderMap = new Map(
        trackedIds.map((id, index) => [id, index])
      );
      containers.sort((a, b) => {
        const idA = parseInt(a.dataset.itemId, 10);
        const idB = parseInt(b.dataset.itemId, 10);
        return (
          (desiredOrderMap.get(idA) ?? Infinity) -
          (desiredOrderMap.get(idB) ?? Infinity)
        );
      });
      containers.forEach((container) => content.appendChild(container));
      // --- END ADD TRACKED ITEMS ---
    }
  }

  /** Removes any existing target input popup from the DOM. */
  function removeTargetPopup() {
    const existingPopup = document.getElementById(POPUP_OVERLAY_ID);
    if (existingPopup) existingPopup.remove();
  }

  /** Shows a popup to set/update/remove the target for an item. */
  function showTargetInputPopup(itemId, itemElement) {
    removeTargetPopup(); // Ensure only one popup

    const itemData = parseItemDataFromElement(itemElement) || {
      name: `Item ${itemId}`,
    };
    const itemName = itemData.name;
    const currentTarget = getItemTarget(itemId);
    const isTracked = getTrackedItemIds().includes(itemId);

    const overlay = document.createElement("div");
    overlay.id = POPUP_OVERLAY_ID;
    overlay.className = "fl-tracker-popup-overlay";
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) removeTargetPopup();
    });

    const box = document.createElement("div");
    box.className = POPUP_BOX_CLASS;

    // Dynamically build buttons based on state
    let buttonsHTML = `<button id="fl-popup-set" class="primary">${
      isTracked ? "Update Target" : "Set Target & Track"
    }</button>`;
    if (isTracked && currentTarget !== null)
      buttonsHTML += `<button id="fl-popup-remove-target">Remove Target</button>`;
    if (isTracked)
      buttonsHTML += `<button id="fl-popup-untrack" class="danger">Untrack Item</button>`;
    buttonsHTML += `<button id="fl-popup-cancel">Cancel</button>`;

    box.innerHTML = `
            <h3>${
              isTracked ? "Update Target / Untrack" : "Set Target & Track"
            }: ${itemName}</h3>
            <label for="fl-target-input">Target Quantity (0+, blank to remove):</label>
            <input type="number" id="fl-target-input" min="0" step="1" placeholder="No target" value="${
              currentTarget !== null ? currentTarget : ""
            }">
            <div class="fl-tracker-popup-buttons">${buttonsHTML}</div>
        `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const inputField = box.querySelector("#fl-target-input");
    inputField.focus();
    inputField.select();

    // --- Button Event Listeners ---
    box.querySelector("#fl-popup-set").addEventListener("click", () => {
      setItemTarget(itemId, inputField.value);
      if (!isTracked) trackItem(itemId); // Track if setting target on untracked item
      removeTargetPopup();
    });

    const removeBtn = box.querySelector("#fl-popup-remove-target");
    if (removeBtn)
      removeBtn.addEventListener("click", () => {
        setItemTarget(itemId, null);
        removeTargetPopup();
      });

    const untrackBtn = box.querySelector("#fl-popup-untrack");
    if (untrackBtn)
      untrackBtn.addEventListener("click", () => {
        untrackItem(itemId);
        removeTargetPopup();
      });

    box
      .querySelector("#fl-popup-cancel")
      .addEventListener("click", removeTargetPopup);

    inputField.addEventListener("keypress", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        box.querySelector("#fl-popup-set").click();
      }
    });
  }

  // =========================================================================
  // === DATA PARSING & API HANDLING ===
  // =========================================================================

  /** Parses item data from a DOM element on the /possessions page. */
  function parseItemDataFromElement(itemElement) {
    if (!itemElement) return null;
    try {
        const qualityId = parseInt(
            itemElement.getAttribute("data-quality-id"),
            10
        );
        const quantityElement = itemElement.querySelector("span.js-item-value");
        const buttonDiv = itemElement.querySelector('div[role="button"]');
        const imgElement = itemElement.querySelector("img");
        const ariaLabelSource = buttonDiv || itemElement;
        // 获取 aria-label，优先从 buttonDiv 获取，失败则从 itemElement 获取，都没有则为空字符串
        const ariaLabel = ariaLabelSource?.getAttribute("aria-label") ?? "";
        // 获取图标 src，失败则为空字符串
        const imgSrc = imgElement?.getAttribute("src") ?? "";

        // 基础信息校验，如果缺少关键信息则无法解析
        if (!qualityId || !quantityElement || !ariaLabel || !imgSrc) {
            // console.warn("FL Tracker: Missing essential data for parsing:", { qualityId, quantityElement, ariaLabel, imgSrc }, itemElement);
            return null;
        }

        const itemQuantity = quantityElement.textContent.trim();
        // 处理协议相对 URL
        const currentIcon = imgSrc.startsWith("//") ? `https:${imgSrc}` : imgSrc;

        // --- 从 aria-label 解析名称 ---
        // 这个内部函数专注于从 aria-label 的第一部分提取纯名称
        function extractItemNameFromAriaLabel(label) {
            if (!label) return "";
            // 取第一个分号前的部分
            let firstPart = label.split(";")[0].trim();
            // 移除末尾的数量标识，例如 " × 22,886" 或 " x 1"
            // 正则表达式：匹配可选空格 + (× 或 x) + 可选空格 + (一个或多个数字，可能带逗号) + 可选空格 + 字符串结尾
            firstPart = firstPart.replace(/\s*[×x]\s*[\d,]+\s*$/i, "");
            return firstPart.trim();
        }
        const itemName = extractItemNameFromAriaLabel(ariaLabel) || `Item ${qualityId}`; // 如果提取失败，提供备用名称

        // --- 从 aria-label 的剩余部分解析分类、描述和可用性 ---
        let itemCategory = "";
        let itemDescription = "";
        // 默认认为物品不可用，除非找到明确的可用性提示
        let isUsable = false;
        const categoryRegex = new RegExp(
            `\\b(${KNOWN_CATEGORIES.join("|")})\\b`,
            "i"
        );
        // 按分号分割 aria-label，保留分隔符后的空格用于后续处理
        const parts = ariaLabel.split(/;\s*/);
        let descParts = []; // 用于收集描述片段
        let categoryFound = false;

        // 定义需要识别和跳过的特定提示信息（使用小写以忽略大小写比较）
        const clickToUseHintLower = "click on this item";
        const inStoryletHintLower = "you're in a storylet at the moment"; // 简化匹配

        // 从 aria-label 的第二部分开始遍历 (索引 1)
        for (let i = 1; i < parts.length; i++) {
            const part = parts[i].trim();
            if (!part) continue; // 跳过空片段

            const partLower = part.toLowerCase();

            // 检查是否是需要特殊处理的提示信息
            if (partLower.startsWith(clickToUseHintLower)) {
                isUsable = true; // 明确提示可点击
                continue; // 跳过，不加入描述
            }
            if (partLower.startsWith(inStoryletHintLower)) {
                isUsable = true; // 暗示物品本身可用，只是暂时被阻挡
                continue; // 跳过，不加入描述
            }

            // 如果不是特殊提示，尝试匹配分类（仅当尚未找到分类时）
            const categoryMatch = !categoryFound ? part.match(categoryRegex) : null;
            if (categoryMatch) {
                itemCategory = categoryMatch[0]; // 存储找到的分类
                categoryFound = true; // 标记已找到
                // 将当前片段中，分类名称 *之后* 的剩余文本作为描述的一部分
                const remainingText = part.substring(part.indexOf(itemCategory) + itemCategory.length).trim();
                // 只有当剩余文本不为空且不仅仅是标点时才添加
                if (remainingText && !/^[,.;:]+$/.test(remainingText)) {
                    descParts.push(remainingText);
                }
            } else {
                // 如果不是特殊提示，也不是新找到的分类，则认为是描述的一部分
                descParts.push(part);
            }
        }
        // 将收集到的描述片段用 "; " 连接起来
        itemDescription = descParts.join("; ").trim();

        // 返回包含所有解析信息的对象
        return {
            id: qualityId,
            name: itemName,
            quantity: itemQuantity,
            icon: currentIcon,
            category: itemCategory,
            description: itemDescription,
            isUsable: isUsable, // 使用最终确定的可用状态
        };
    } catch (error) {
        console.error(
            "FL Tracker: 解析物品元素数据时出错:",
            error,
            itemElement
        );
        return null; // 解析出错时返回 null
    }
}

  function setupRequestInterceptor() {
    if (!INTERCEPT_PATTERNS || INTERCEPT_PATTERNS.length === 0) {
      console.warn("FL Tracker: 没有定义 API 拦截 URL 模式。跳过拦截器设置。");
      return;
    }
    const { fetch: originalFetch, XMLHttpRequest: originalXHR } = window;
    const originalXhrOpen = originalXHR.prototype.open;
    const originalXhrSend = originalXHR.prototype.send;

    console.log("FL Tracker: 正在设置请求拦截器...");

    // --- 辅助函数：检查 URL 是否匹配任何拦截模式 ---
    function matchesAnyInterceptPattern(url) {
      if (!url) return null;
      for (const pattern of INTERCEPT_PATTERNS) {
        if (pattern.test(url)) {
          return pattern; // 返回匹配到的模式
        }
      }
      return null;
    }

    // --- 修补 fetch ---
    window.fetch = async function (input, init) {
      const url = typeof input === "string" ? input : input?.url;
      const method =
        init?.method?.toUpperCase() ||
        (typeof input !== "string" && input?.method?.toUpperCase()) ||
        "GET";
      const matchedPattern = matchesAnyInterceptPattern(url);
      let requestBody = null;

      // 如果是相关的 POST 请求 (sell 或 buy)，在发送前捕获请求体
      if (
        (matchedPattern === API_SELL_PATTERN ||
          matchedPattern === API_BUY_PATTERN) &&
        method === "POST" &&
        init?.body
      ) {
        try {
          // 假设 body 是 JSON 字符串或已经是字符串
          if (typeof init.body === "string") {
            requestBody = JSON.parse(init.body);
          } else if (init.body instanceof URLSearchParams) {
            // 如果是表单数据，解析它
            const params = {};
            for (const [key, value] of init.body.entries()) {
              params[key] = value;
            }
            requestBody = params;
          } else {
            // 如果需要，添加对其他 body 类型的处理 (例如 Blob, FormData)
            console.warn(
              `FL Tracker: 拦截到 fetch ${url} 请求，但请求体类型未处理:`,
              typeof init.body
            );
          }
        } catch (e) {
          console.error(
            `FL Tracker: 解析 fetch 请求 ${url} 的请求体失败`,
            e,
            init.body
          );
        }
      }

      const fetchPromise = originalFetch.apply(this, arguments);

      if (matchedPattern) {
        // console.log(`FL Tracker: 正在拦截 fetch: ${url}`); // 除非调试，否则保持注释
        fetchPromise
          .then((response) => {
            if (response.ok) {
              response
                .clone()
                .json()
                .then((data) => {
                  // 将请求体传递给处理函数
                  handleInterceptedData(url, matchedPattern, data, requestBody);
                })
                .catch((e) =>
                  console.warn(`FL Tracker: 从 fetch ${url} 解析 JSON 失败`, e)
                );
            } else {
              console.warn(
                `FL Tracker: 拦截到的 fetch ${url} 失败: ${response.status}`
              );
            }
          })
          .catch((error) =>
            console.error(`FL Tracker: 处理 fetch 拦截 ${url} 时出错`, error)
          );
      }
      return fetchPromise; // 无论如何都返回原始 promise
    };

    // --- 修补 XMLHttpRequest ---
    originalXHR.prototype.open = function (method, url) {
      this._trackedUrl = url; // 在实例上存储 URL
      this._trackedMethod = method?.toUpperCase(); // 存储方法
      return originalXhrOpen.apply(this, arguments);
    };

    originalXHR.prototype.send = function (data) {
      // 捕获发送的数据
      const xhr = this;
      const originalCallback = xhr.onreadystatechange;
      let processed = false; // 防止重复触发
      let requestBody = null;
      const matchedPattern = matchesAnyInterceptPattern(xhr._trackedUrl);

      // 如果是相关的 POST 请求 (sell 或 buy)，在发送前捕获请求体
      if (
        (matchedPattern === API_SELL_PATTERN ||
          matchedPattern === API_BUY_PATTERN) &&
        xhr._trackedMethod === "POST" &&
        data
      ) {
        try {
          // 假设 body 是 JSON 字符串或 URL 编码的字符串
          if (typeof data === "string") {
            if (data.startsWith("{") && data.endsWith("}")) {
              // 简单的 JSON 检查
              requestBody = JSON.parse(data);
            } else {
              // 假设是 URL 编码
              const params = {};
              new URLSearchParams(data).forEach((value, key) => {
                params[key] = value;
              });
              requestBody = params;
            }
          } else {
            console.warn(
              `FL Tracker: 拦截到 XHR ${xhr._trackedUrl} 请求，但请求体类型未处理:`,
              typeof data
            );
          }
        } catch (e) {
          console.error(
            `FL Tracker: 解析 XHR 请求 ${xhr._trackedUrl} 的请求体失败`,
            e,
            data
          );
        }
      }

      xhr.onreadystatechange = function () {
        if (
          xhr.readyState === 4 &&
          !processed &&
          xhr._trackedUrl &&
          matchedPattern
        ) {
          processed = true;
          // console.log(`FL Tracker: 正在拦截 XHR: ${xhr._trackedUrl} (状态: ${xhr.status})`); // 除非调试，否则保持注释
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const responseData = JSON.parse(xhr.responseText);
              // 将捕获的请求体和响应一起传递
              handleInterceptedData(
                xhr._trackedUrl,
                matchedPattern,
                responseData,
                requestBody
              );
            } catch (e) {
              console.error(
                "FL Tracker: 处理 XHR 响应时出错",
                e,
                xhr.responseText
              );
            }
          } else {
            console.warn(
              `FL Tracker: 拦截到的 XHR ${xhr._trackedUrl} 失败: ${xhr.status}`
            );
          }
        }
        // 如果存在原始回调，则调用它
        if (originalCallback) return originalCallback.apply(this, arguments);
      };
      return originalXhrSend.apply(this, arguments);
    };
    console.log("FL Tracker: 请求拦截器已激活，可用于多种模式。");
  }

  // --- 中央处理器 ---
  function handleInterceptedData(url, pattern, responseData, requestData) {
    // console.log("FL Tracker: 处理来自", url, "的拦截数据", "请求数据:", requestData, "响应数据:", responseData); // 调试日志
    if (pattern === API_CHOOSEBRANCH_PATTERN) {
      processChooseBranchData(responseData);
    } else if (pattern === API_SELL_PATTERN) {
      processSellData(responseData, requestData);
    } else if (pattern === API_BUY_PATTERN) {
      // 新增：处理 /buy 响应
      processBuyData(responseData, requestData);
    } else {
      console.warn("FL Tracker: 拦截到来自未处理模式的数据:", url);
    }
  }

  // --- /choosebranch 的处理逻辑 ---
  // 为了清晰，从 processInterceptedData 重命名
  function processChooseBranchData(responseData) {
    if (!responseData?.messages?.length) return;

    console.log("FL Tracker: 正在处理拦截到的 /choosebranch 数据...");
    const trackedIds = getTrackedItemIds(); // 假设此函数存在
    let updated = false;

    responseData.messages.forEach((message) => {
      if (message?.possession) {
        const pData = message.possession;
        const itemId = parseInt(pData.id, 10);
        // 使用 'level' 作为数量，确保它存在
        if (
          !isNaN(itemId) &&
          pData.level !== undefined &&
          pData.level !== null
        ) {
          if (trackedIds.includes(itemId)) {
            const newQty = pData.level.toString();
            const prefix = getStorageKeyPrefix(itemId); // 假设此函数存在
            if (GM_getValue(prefix + "quantity", null) !== newQty) {
              // 假设 GM_getValue 存在
              console.log(
                `FL Tracker: 通过 /choosebranch 拦截，更新物品 ${itemId} 数量为 ${newQty}`
              );
              GM_setValue(prefix + "quantity", newQty); // 假设 GM_setValue 存在
              updateTrackedItemDisplay(itemId, newQty); // 假设此函数存在
              updated = true;
            }
          }
        }
      }
    });
    if (updated)
      console.log("FL Tracker: 侧边栏显示已根据 /choosebranch 数据更新。");
  }

  // --- /exchange/sell 的处理逻辑 ---
  function processSellData(responseData, requestData) {
    // requestData 应该包含来自 POST 请求的已解析 body
    // responseData 是来自 /sell 端点的已解析 JSON 响应

    // 我们需要请求中的 availabilityId 来知道 *卖了什么*
    const availabilityId = requestData
      ? parseInt(requestData.availabilityId, 10)
      : NaN;

    if (isNaN(availabilityId)) {
      console.warn(
        "FL Tracker: 无法从 /sell 请求确定售出的物品 ID (availabilityId)。",
        requestData
      );
      return;
    }

    if (!responseData?.possessionsChanged?.length) return; // 检查响应中相关的数组

    console.log(
      `FL Tracker: 正在处理拦截到的 /sell 数据，针对物品 ${availabilityId}...`
    );
    const trackedIds = getTrackedItemIds(); // 假设此函数存在
    let updated = false;

    // 检查 *正在出售的* 物品是否被追踪
    if (trackedIds.includes(availabilityId)) {
      // 在响应的 possessionsChanged 数组中查找匹配的物品
      const changedItemData = responseData.possessionsChanged.find(
        (p) => p.id === availabilityId
      );

      if (
        changedItemData &&
        changedItemData.level !== undefined &&
        changedItemData.level !== null
      ) {
        const newQty = changedItemData.level.toString();
        const prefix = getStorageKeyPrefix(availabilityId); // 假设存在
        if (GM_getValue(prefix + "quantity", null) !== newQty) {
          // 假设存在
          console.log(
            `FL Tracker: 通过 /sell 拦截，更新物品 ${availabilityId} 数量为 ${newQty}`
          );
          GM_setValue(prefix + "quantity", newQty); // 假设存在
          updateTrackedItemDisplay(availabilityId, newQty); // 假设存在
          updated = true;
        }
      } else {
        console.warn(
          `FL Tracker: 在 /sell 响应中未找到售出物品 ${availabilityId} 的更新数量，或者 level 缺失。`,
          responseData.possessionsChanged
        );
        // 可能是物品数量变为 0，然后它没有出现在 possessionsChanged 中？
        // 或者只有货币变化出现？检查是否有任何 possession 匹配。
        // 如果找不到匹配的 ID，也许物品被完全移除了（数量 0）？
        const itemStillExists = responseData.possessionsChanged.some(
          (p) => p.id === availabilityId
        );
        if (!itemStillExists) {
          const zeroQty = "0";
          const prefix = getStorageKeyPrefix(availabilityId);
          if (GM_getValue(prefix + "quantity", null) !== zeroQty) {
            console.log(
              `FL Tracker: 通过 /sell 拦截，假定物品 ${availabilityId} 数量为 0（已移除）`
            );
            GM_setValue(prefix + "quantity", zeroQty);
            updateTrackedItemDisplay(availabilityId, zeroQty);
            updated = true;
          }
        }
      }
    }

    // 同时检查是否有 *其他* 被追踪的物品（例如货币 - Pennies）在同一响应中被更新
    responseData.possessionsChanged.forEach((pData) => {
      const itemId = parseInt(pData.id, 10);
      if (isNaN(itemId) || itemId === availabilityId) return; // 跳过刚刚售出的物品或无效 ID

      if (
        pData.level !== undefined &&
        pData.level !== null &&
        trackedIds.includes(itemId)
      ) {
        const newQty = pData.level.toString();
        const prefix = getStorageKeyPrefix(itemId);
        if (GM_getValue(prefix + "quantity", null) !== newQty) {
          console.log(
            `FL Tracker: 通过 /sell 拦截，更新相关物品 ${itemId} 数量为 ${newQty}`
          );
          GM_setValue(prefix + "quantity", newQty);
          updateTrackedItemDisplay(itemId, newQty);
          updated = true;
        }
      }
    });

    if (updated) console.log("FL Tracker: 侧边栏显示已根据 /sell 数据更新。");
  }

  // --- /exchange/buy 的处理逻辑 --- (新增)
  function processBuyData(responseData, requestData) {
    // requestData 应该包含来自 POST 请求的已解析 body
    // responseData 是来自 /buy 端点的已解析 JSON 响应

    // 我们需要请求中的 availabilityId 来知道 *买了什么*
    const availabilityId = requestData
      ? parseInt(requestData.availabilityId, 10)
      : NaN;

    if (isNaN(availabilityId)) {
      console.warn(
        "FL Tracker: 无法从 /buy 请求确定购买的物品 ID (availabilityId)。",
        requestData
      );
      return;
    }

    if (!responseData?.possessionsChanged?.length) return; // 检查响应中相关的数组

    console.log(
      `FL Tracker: 正在处理拦截到的 /buy 数据，针对物品 ${availabilityId}...`
    );
    const trackedIds = getTrackedItemIds(); // 假设此函数存在
    let updated = false;

    // 检查 *正在购买的* 物品是否被追踪
    if (trackedIds.includes(availabilityId)) {
      // 在响应的 possessionsChanged 数组中查找匹配的物品
      const changedItemData = responseData.possessionsChanged.find(
        (p) => p.id === availabilityId
      );

      if (
        changedItemData &&
        changedItemData.level !== undefined &&
        changedItemData.level !== null
      ) {
        const newQty = changedItemData.level.toString();
        const prefix = getStorageKeyPrefix(availabilityId); // 假设存在
        if (GM_getValue(prefix + "quantity", null) !== newQty) {
          // 假设存在
          console.log(
            `FL Tracker: 通过 /buy 拦截，更新物品 ${availabilityId} 数量为 ${newQty}`
          );
          GM_setValue(prefix + "quantity", newQty); // 假设存在
          updateTrackedItemDisplay(availabilityId, newQty); // 假设存在
          updated = true;
        }
      } else {
        // 在购买场景下，如果找不到物品，这通常是个错误，或者 API 结构不同
        console.warn(
          `FL Tracker: 在 /buy 响应中未找到购买的物品 ${availabilityId} 的更新数据，或者 level 缺失。`,
          responseData.possessionsChanged
        );
      }
    }

    // 同时检查是否有 *其他* 被追踪的物品（例如花费的货币 - Pennies）在同一响应中被更新
    responseData.possessionsChanged.forEach((pData) => {
      const itemId = parseInt(pData.id, 10);
      if (isNaN(itemId) || itemId === availabilityId) return; // 跳过刚刚购买的物品或无效 ID

      if (
        pData.level !== undefined &&
        pData.level !== null &&
        trackedIds.includes(itemId)
      ) {
        const newQty = pData.level.toString();
        const prefix = getStorageKeyPrefix(itemId);
        if (GM_getValue(prefix + "quantity", null) !== newQty) {
          console.log(
            `FL Tracker: 通过 /buy 拦截，更新相关物品 ${itemId} 数量为 ${newQty}`
          );
          GM_setValue(prefix + "quantity", newQty);
          updateTrackedItemDisplay(itemId, newQty);
          updated = true;
        }
      }
    });

    if (updated) console.log("FL Tracker: 侧边栏显示已根据 /buy 数据更新。");
  }

  /** Uses an item via the API. */
  function useTrackedItem(itemId, buttonElement) {
    if (!itemId) return;
    console.log(`FL Tracker: Attempting to use item ID ${itemId}.`); // Kept this log for significant action
    const token = findAuthToken();
    const tooltipElement = buttonElement?.closest(`.${TOOLTIP_CLASS}`); // Find parent tooltip

    if (!token) {
      showStatusMessage(
        tooltipElement,
        "Error: Auth Token not found.",
        "error"
      );
      return;
    }

    buttonElement.disabled = true;
    showStatusMessage(tooltipElement, "Using...", null);
    // Optionally hide tooltip while using
    // if (tooltipElement) tooltipElement.classList.remove(VISIBLE_CLASS);

    GM_xmlhttpRequest({
      method: "POST",
      url: API_USE_URL,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, */*",
        "X-Requested-With": "XMLHttpRequest", // Often needed for APIs
      },
      data: JSON.stringify({ qualityId: itemId }),
      responseType: "json", // Expect JSON response
      timeout: 15000, // 15 second timeout
      onload: function (response) {
        // console.log("FL Tracker: Use API Response Status:", response.status); // Removed log
        if (response.status >= 200 && response.status < 300) {
          console.log(
            "FL Tracker: API use successful. Page should update via intercept/reload." // Kept this confirmation log
          );
          setTimeout(() => {
            window.location.href = "/"; // Navigate to root
          }, 100); // 100ms delay
        } else {
          const errorMessage =
            response.response?.message ||
            response.statusText ||
            `HTTP ${response.status}`;
          console.error(
            "FL Tracker: Use API Error - ",
            errorMessage,
            response.response
          );
          showStatusMessage(tooltipElement, `Error: ${errorMessage}`, "error");
          if (buttonElement) buttonElement.disabled = false; // Re-enable on error
          // If tooltip was hidden, re-show it on error
          // if (tooltipElement && !tooltipElement.classList.contains(VISIBLE_CLASS)) {
          //    tooltipElement.classList.add(VISIBLE_CLASS);
          // }
        }
      },
      onerror: function (response) {
        console.error(
          "FL Tracker: Use Network Error - ",
          response.statusText,
          response.error
        );
        showStatusMessage(
          tooltipElement,
          `Network Error: ${response.error || "Failed to send"}`,
          "error"
        );
        if (buttonElement) buttonElement.disabled = false;
      },
      ontimeout: function () {
        console.error("FL Tracker: Use Request timed out.");
        showStatusMessage(tooltipElement, "Error: Request Timed Out", "error");
        if (buttonElement) buttonElement.disabled = false;
      },
    });
  }

  // =========================================================================
  // === POSSESSIONS PAGE HANDLING ===
  // =========================================================================

  /** Finds tracked items on /possessions page and stores/updates their data. */
  function findAndStoreTrackedItemsData() {
    const trackedIds = getTrackedItemIds();
    if (trackedIds.length === 0) return;
    const displayBar = document.getElementById(DISPLAY_ELEMENT_ID);

    trackedIds.forEach((id) => {
      const container = displayBar?.querySelector(
        `.${CONTAINER_CLASS}[data-item-id="${id}"]`
      );
      container?.classList.add("loading", "error");
    });

    if (findIntervalId) clearInterval(findIntervalId);
    const startTime = Date.now();

    findIntervalId = setInterval(() => {
      if (!window.location.pathname.includes("/possessions")) {
        clearInterval(findIntervalId);
        findIntervalId = null;
        return;
      }
      const allItemIcons = Array.from(
        document.querySelectorAll("li.item .icon[data-quality-id]")
      );
      if (allItemIcons.length === 0) {
        if (Date.now() - startTime > WAIT_TIMEOUT_MS / 2) {
          clearInterval(findIntervalId);
          findIntervalId = null;
        }
        return;
      }
      const foundElements = allItemIcons.filter((icon) =>
        trackedIds.includes(parseInt(icon.getAttribute("data-quality-id"), 10))
      );
      const foundIds = new Set();
      let updated = false;

      // Process found items
      foundElements.forEach((itemElement) => {
        const itemData = parseItemDataFromElement(itemElement);
        if (itemData) {
          storeItemData(itemData);
          updateTrackedItemDisplay(itemData.id, itemData.quantity); // Update display incrementally
          foundIds.add(itemData.id);
          const container = displayBar?.querySelector(
            `.${CONTAINER_CLASS}[data-item-id="${itemData.id}"]`
          );
          container?.classList.remove("loading", "error"); // Found, remove flags
          updated = true;
        }
      });

      // Handle timeout or completion
      if (
        foundIds.size === trackedIds.length ||
        Date.now() - startTime >= WAIT_TIMEOUT_MS
      ) {
        clearInterval(findIntervalId);
        findIntervalId = null;

        const missingIds = trackedIds.filter((id) => !foundIds.has(id));
        if (missingIds.length > 0) {
          console.log(
            `FL Tracker: Items not found on page (Timeout or Qty 0): [${missingIds.join(
              ", "
            )}]` // Kept log for missing items
          );
          missingIds.forEach((missingId) => {
            const prefix = getStorageKeyPrefix(missingId);
            // Only set to 0 if we previously had valid data for it
            if (
              GM_getValue(prefix + "name", null) &&
              !GM_getValue(prefix + "name", "").startsWith("Item ")
            ) {
              console.log(
                `FL Tracker: Setting quantity to 0 for missing item ID ${missingId}.` // Kept log for setting quantity to 0
              );
              GM_setValue(prefix + "quantity", "0");
              updateTrackedItemDisplay(missingId, "0");
              updated = true;
            }
            const container = displayBar?.querySelector(
              `.${CONTAINER_CLASS}[data-item-id="${missingId}"]`
            );
            container?.classList.remove("loading"); // Remove loading, keep error if applicable? Or remove both?
            container?.classList.remove("error");
          });
        }
        console.log(
          `FL Tracker: Finished /possessions item search. ${
            updated ? "Display updated." : ""
          }` // Kept log for finishing search
        );
      }
    }, RETRY_INTERVAL_MS);
  }

  /** Enhances the /possessions page by adding '+' buttons to items. */
  function enhancePossessionsPage() {
    const itemIcons = document.querySelectorAll(
      "li.item .icon[data-quality-id]:not(.fl-tracker-enhanced)"
    );
    if (itemIcons.length === 0) return;

    if (itemIcons.length > 0) {
      console.log(
        `FL Tracker: Found ${itemIcons.length} new item icons to enhance.` // Kept log
      );
    }

    itemIcons.forEach((iconElement) => {
      const itemId = parseInt(iconElement.getAttribute("data-quality-id"), 10);
      if (!itemId) return;

      iconElement.classList.add("fl-tracker-enhanced"); // Mark as enhanced

      const addButton = document.createElement("button");
      addButton.className = ADD_BUTTON_CLASS;
      addButton.dataset.itemId = itemId;
      addButton.type = "button"; // Prevent potential form submissions

      addButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showTargetInputPopup(itemId, iconElement);
      });
      iconElement.appendChild(addButton);
    });

    updateAddButtonStates(); // Ensure all buttons (new and old) have correct state
  }

  /** Updates the state (+/✓) and title of the add buttons on the /possessions page. */
  function updateAddButtonStates() {
    const trackedIds = getTrackedItemIds();
    // Query within the specific container to avoid potential stale nodes
    const addButtons = document.querySelectorAll(
      `li.item .icon[data-quality-id] .${ADD_BUTTON_CLASS}`
    );
    if (addButtons.length === 0) return;
    addButtons.forEach((button) => {
      const buttonItemId = parseInt(button.dataset.itemId || "0", 10);
      if (buttonItemId) {
        const isTracked = trackedIds.includes(buttonItemId);
        const currentText = isTracked ? "✓" : "+";
        const currentTitle = isTracked
          ? "Update target / Untrack this item"
          : "Track this item with a target";

        if (button.textContent !== currentText)
          button.textContent = currentText;
        if (button.title !== currentTitle) button.title = currentTitle;
        button.classList.toggle("selected", isTracked);
      }
    });
  }

  /** Sets up a MutationObserver to re-enhance the /possessions page when items change (e.g., filtering). */
  function setupPossessionsObserver(containerElement) {
    if (possessionsObserver) {
      // Disconnect previous if exists
      console.log("FL Tracker: Disconnecting existing Possessions observer."); // Kept log
      possessionsObserver.disconnect();
    }

    const observerCallback = function (mutationsList, observer) {
      let needsEnhance = false;
      for (const mutation of mutationsList) {
        if (
          mutation.type === "childList" &&
          (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)
        ) {
          // Check if actual item icons were added/removed
          const affectedIcons =
            Array.from(mutation.addedNodes).some(
              (n) =>
                n.nodeType === 1 &&
                (n.matches?.(".icon[data-quality-id]") ||
                  n.querySelector?.(".icon[data-quality-id]"))
            ) ||
            Array.from(mutation.removedNodes).some(
              (n) => n.nodeType === 1 && n.matches?.(".icon[data-quality-id]")
            );
          if (affectedIcons) {
            needsEnhance = true;
            break;
          }
        }
      }

      if (needsEnhance) {
        clearTimeout(enhanceDebounceTimer);
        enhanceDebounceTimer = setTimeout(() => {
          // Check if container still exists before enhancing
          const currentPane = document.querySelector("div.possessions");
          if (!currentPane) {
            console.warn(
              "FL Tracker: Possessions pane disappeared before debounced enhance."
            );
            return;
          }

          // Temporarily disconnect observer during enhancement to prevent loops
          console.log(
            "FL Tracker: Temporarily disconnecting observer for enhancement." // Kept log
          );
          observer.disconnect(); // Use the passed observer instance
          try {
            console.log(
              "FL Tracker: Re-enhancing possessions page after mutation." // Kept log
            );
            enhancePossessionsPage();
          } catch (e) {
            console.error(
              "FL Tracker: Error during debounced enhancePossessionsPage:",
              e
            );
          } finally {
            // Reconnect observer, ensure container still valid
            if (document.body.contains(currentPane)) {
              observer.observe(currentPane, { childList: true, subtree: true });
            } else {
              possessionsObserver = null;
            }
          }
        }, ENHANCE_DEBOUNCE_DELAY);
      }
    };

    possessionsObserver = new MutationObserver(observerCallback);
    possessionsObserver.observe(containerElement, {
      childList: true,
      subtree: true,
    });
    console.log("FL Tracker: Possessions observer started."); // Kept log
  }

  // --- Refactored Tracking Logic ---
  /** Adds an item to the tracked list and updates relevant UI. */
  function trackItem(itemId) {
    let trackedIds = getTrackedItemIds();
    if (!trackedIds.includes(itemId)) {
      console.log(`FL Tracker: Tracking item ID ${itemId}`); // Kept log for state change
      trackedIds.push(itemId);
      setTrackedItemIds(trackedIds);

      // Attempt to store initial data immediately
      const itemElement = document.querySelector(
        `li.item .icon[data-quality-id="${itemId}"]`
      );
      if (itemElement) {
        const itemData = parseItemDataFromElement(itemElement);
        if (itemData) storeItemData(itemData);
      } else {
        console.warn(
          `FL Tracker: Could not find element for newly tracked item ${itemId} to store initial data.`
        );
        // Ensure basic quantity exists even if other data missing
        const prefix = getStorageKeyPrefix(itemId);
        if (!GM_getValue(prefix + "quantity", undefined)) {
          GM_setValue(prefix + "quantity", "?");
        }
      }
      displayTrackedItems(); // Update sidebar to add the new item
      updateAddButtonStates(); // Update button on /possessions page
    }
  }

  /** Removes an item from the tracked list, clears its target, and updates UI. */
  function untrackItem(itemId) {
    let trackedIds = getTrackedItemIds();
    if (trackedIds.includes(itemId)) {
      console.log(`FL Tracker: Untracking item ID ${itemId}`); // Kept log for state change
      trackedIds = trackedIds.filter((id) => id !== itemId);
      setTrackedItemIds(trackedIds);
      setItemTarget(itemId, null); // Also remove target when untracking
      displayTrackedItems(); // Update sidebar to remove the item
      updateAddButtonStates(); // Update button on /possessions page
    }
  }

  // =========================================================================
  // === SPA NAVIGATION & INITIALIZATION ===
  // =========================================================================

  /** Handles changes in the page path (SPA navigation). */
  function handlePathChange() {
    const currentPath = window.location.pathname;
    console.log("FL Tracker: Path changed to:", currentPath); // Kept log for navigation

    // Clean up resources from previous page state
    if (possessionsObserver) {
      console.log(
        "FL Tracker: Disconnecting Possessions observer due to path change." // Kept log
      );
      possessionsObserver.disconnect();
      possessionsObserver = null;
    }
    clearTimeout(enhanceDebounceTimer);
    if (findIntervalId) {
      console.log("FL Tracker: Clearing active item search interval."); // Kept log
      clearInterval(findIntervalId);
      findIntervalId = null;
      // Remove any lingering loading indicators
      document
        .querySelectorAll(`#${DISPLAY_ELEMENT_ID} .${CONTAINER_CLASS}.loading`)
        .forEach((c) => c.classList.remove("loading", "error"));
    }

    // Actions specific to the /possessions page
    if (currentPath.includes("/possessions")) {
      console.log("FL Tracker: /possessions page detected."); // Kept log
      // Wait for the main item container before proceeding
      waitForElement("div.possessions", (possessionsPane) => {
        if (
          possessionsPane &&
          window.location.pathname.includes("/possessions")
        ) {
          enhancePossessionsPage();
          findAndStoreTrackedItemsData();
          setupPossessionsObserver(possessionsPane);
        } else if (!possessionsPane) {
          console.warn("FL Tracker: Possessions pane not found after wait.");
        }
      });
    }
  }

  /** Sets up listeners for SPA navigation events (pushState, replaceState, popstate). */
  function setupSpaNavigationListener() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function () {
      const result = originalPushState.apply(this, arguments);
      window.dispatchEvent(new Event("pushstate")); // Dispatch custom event
      window.dispatchEvent(new Event("locationchange"));
      return result;
    };

    history.replaceState = function () {
      const result = originalReplaceState.apply(this, arguments);
      window.dispatchEvent(new Event("replacestate")); // Dispatch custom event
      window.dispatchEvent(new Event("locationchange"));
      return result;
    };

    window.addEventListener("popstate", () => {
      window.dispatchEvent(new Event("locationchange"));
    });

    // Listen to our custom event
    window.addEventListener("locationchange", handlePathChange);

    console.log("FL Tracker: SPA navigation listeners setup."); // Kept log
  }

  // --- Main Execution ---
  console.log("FL Item Tracker++ Initializing..."); // Kept log

  // Initial display of the sidebar based on stored data
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", displayTrackedItems);
  } else {
    displayTrackedItems();
  }

  // Setup core listeners
  setupSpaNavigationListener();
  setupRequestInterceptor(); // Setup API interception

  // Initial check of the current path
  // Use setTimeout to ensure the rest of the page's initial scripts might run first
  setTimeout(handlePathChange, 100);

  console.log("FL Item Tracker++ Initialization complete."); // Kept log
})(); // End of IIFE
