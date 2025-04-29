// ==UserScript==
// @name         Fallen London Item Tracker
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Track multiple Fallen London items with target goals, shows styled category in tooltip. Updates via API intercept & /possessions page.
// @author       xeoplise (enhanced by AI)
// @match        https://www.fallenlondon.com/*
// @icon         https://images.fallenlondon.com/favicon-fl.png
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api.fallenlondon.com
// @downloadURL  https://raw.githubusercontent.com/zimlouk/fallenLondonEasier/main/fallenLondonItemTracker.user.js
// @updateURL    https://raw.githubusercontent.com/zimlouk/fallenLondonEasier/main/fallenLondonItemTracker.user.js
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================
    // === CONFIGURATION & CONSTANTS ===
    // =========================================================================

    // --- Behavior ---
    const WAIT_TIMEOUT_MS = 10000; // Max time to wait for elements on /possessions
    const RETRY_INTERVAL_MS = 500; // How often to retry finding elements
    const ENHANCE_DEBOUNCE_DELAY = 300; // Delay (ms) before re-enhancing /possessions after DOM changes

    // --- Selectors & Keys ---
    const API_USE_URL = "https://api.fallenlondon.com/api/storylet/usequality";
    const API_INTERCEPT_URL_PATTERN = /\/api\/storylet\/choosebranch$/; // URL pattern to intercept for updates
    const TRACKED_ITEM_IDS_KEY = "fl_tracker_tracked_ids_v4"; // Storage key for tracked item IDs
    const POSSESSIONS_ITEM_CONTAINER_SELECTOR = ".stack-content--3-of-4"; // Container for items on /possessions
    const DISPLAY_ELEMENT_ID = "fl-item-tracker-sidebar"; // ID for the tracker sidebar
    const CONTAINER_CLASS = "fl-tracker-item-container"; // Class for individual item containers in sidebar
    const TOOLTIP_CLASS = "fl-tracker-tooltip"; // Class for tooltips in sidebar
    const VISIBLE_CLASS = "fl-tracker-tooltip-visible"; // Class for visible tooltips
    const USE_BUTTON_CLASS = "fl-tracker-use-button"; // Class for 'Use' button in tooltip
    const ADD_BUTTON_CLASS = "fl-tracker-add-button"; // Class for '+' button on /possessions items
    const POPUP_OVERLAY_ID = "fl-tracker-popup-overlay"; // ID for the target input popup overlay
    const POPUP_BOX_CLASS = "fl-tracker-popup-box"; // Class for the target input popup box
    const STORAGE_KEY_PREFIX = "fl_tracker_v4_item_"; // Prefix for storing individual item data
    const STORAGE_SUFFIX_TARGET = "target"; // Suffix for storing item target value
    const STORAGE_SUFFIX_CATEGORY = "category"; // Suffix for storing item category

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
            pointer-events: none; /* Allow clicks through background */
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
            return Array.isArray(ids) ? ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id)) : [];
        } catch (e) {
            console.error("FL Tracker: Error parsing tracked IDs, returning empty list.", e);
            return [];
        }
    }

    /** Saves the list of tracked item IDs to storage. */
    function setTrackedItemIds(ids) {
        if (!Array.isArray(ids)) return;
        const uniqueIds = [...new Set(ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id)))];
        GM_setValue(TRACKED_ITEM_IDS_KEY, JSON.stringify(uniqueIds));
    }

    /** Gets the target value for a specific item ID. */
    function getItemTarget(itemId) {
        const storedTarget = GM_getValue(getStorageKeyPrefix(itemId) + STORAGE_SUFFIX_TARGET, null);
        if (storedTarget === null || storedTarget === "") return null;
        const targetNum = parseInt(storedTarget, 10);
        return !isNaN(targetNum) && targetNum >= 0 ? targetNum : null;
    }

    /** Sets or removes the target value for a specific item ID and updates its display. */
    function setItemTarget(itemId, targetValue) {
        const prefix = getStorageKeyPrefix(itemId);
        let targetToStore = ""; // Default to empty string (remove target)
        if (targetValue !== null && targetValue !== "" && targetValue !== undefined) {
            const targetNum = parseInt(targetValue, 10);
            if (!isNaN(targetNum) && targetNum >= 0) {
                targetToStore = targetNum.toString();
                console.log(`FL Tracker: Setting target for item ${itemId} to ${targetNum}`);
            } else {
                console.warn(`FL Tracker: Invalid target value "${targetValue}" for item ${itemId}. Removing target.`);
            }
        } else {
            console.log(`FL Tracker: Removing target for item ${itemId}`);
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
        // console.log(`FL Tracker: Storing data for ID ${itemData.id}`); // Reduce logging noise
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
                    if (value && typeof value === 'string' && value.startsWith("ey") && value.includes(".") && jwtRegex.test(value)) {
                        console.log(`FL Tracker: Found potential JWT in ${storage === localStorage ? 'localStorage' : 'sessionStorage'}.`);
                        return value;
                    }
                }
            } catch (e) {
                console.warn(`FL Tracker: Error accessing ${storage === localStorage ? 'localStorage' : 'sessionStorage'}`, e);
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
            const descLine = tooltipElement.querySelector('.tooltip-desc-line');
            if (button) button.insertAdjacentElement('beforebegin', statusDiv);
            else if (descLine) descLine.insertAdjacentElement('afterend', statusDiv);
            else tooltipElement.appendChild(statusDiv); // Fallback
            statusDiv.style.marginTop = '8px'; // Add margin if newly created
        }

        statusDiv.textContent = message;
        statusDiv.className = "tooltip-status"; // Reset classes
        if (type === "success") statusDiv.classList.add("success");
        else if (type === "error") statusDiv.classList.add("error");
        statusDiv.style.display = message ? 'block' : 'none';
    }

    /** Waits for an element matching the selector to appear in the DOM. */
    function waitForElement(selector, callback, timeout = WAIT_TIMEOUT_MS, interval = RETRY_INTERVAL_MS) {
        const startTime = Date.now();
        const timer = setInterval(() => {
            const element = document.querySelector(selector);
            if (element) {
                clearInterval(timer);
                console.log(`FL Tracker: Element "${selector}" found.`);
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

        displayBar.addEventListener("click", (event) => {
            const target = event.target;
            const container = target.closest(`.${CONTAINER_CLASS}`);
            if (!container) return;

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

            // Handle click inside tooltip (do nothing, allow interaction)
            if (tooltip.contains(target)) {
                event.stopPropagation();
                return;
            }

            // Handle click on container itself (toggle tooltip)
            event.stopPropagation(); // Prevent document listener closing it immediately
            console.log(`FL Tracker: Toggling tooltip for item ${itemId}`);
            const isCurrentlyVisible = tooltip.classList.contains(VISIBLE_CLASS);

            // Hide any other visible tooltips first
            document.querySelectorAll(`#${DISPLAY_ELEMENT_ID} .${TOOLTIP_CLASS}.${VISIBLE_CLASS}`)
                .forEach(visibleTooltip => {
                    if (visibleTooltip !== tooltip) {
                        visibleTooltip.classList.remove(VISIBLE_CLASS);
                        showStatusMessage(visibleTooltip, "", null); // Clear status
                    }
                });

            // Toggle the current one
            if (!isCurrentlyVisible) {
                tooltip.classList.add(VISIBLE_CLASS);
                showStatusMessage(tooltip, "", null); // Clear status on open
            } else {
                tooltip.classList.remove(VISIBLE_CLASS);
                // Status cleared when hiding via outside click anyway
            }
        });

        // Listener on the document to close tooltips when clicking outside
        document.addEventListener('click', (event) => {
            const displayBarElement = document.getElementById(DISPLAY_ELEMENT_ID);
            if (!displayBarElement) return; // Sidebar might not exist yet/anymore
            const visibleTooltip = displayBarElement.querySelector(`.${TOOLTIP_CLASS}.${VISIBLE_CLASS}`);
            if (!visibleTooltip) return;

            const clickedInsideSidebar = displayBarElement.contains(event.target);
            const clickedInsideVisibleTooltip = visibleTooltip.contains(event.target);

            if (!clickedInsideSidebar && !clickedInsideVisibleTooltip) {
                console.log("FL Tracker: Click outside active container/tooltip, hiding tooltip.");
                visibleTooltip.classList.remove(VISIBLE_CLASS);
                showStatusMessage(visibleTooltip, "", null); // Clear status
            }
        }, true); // Use capture phase

        isSidebarListenerSetup = true;
    }

    /** Updates the display of a single tracked item in the sidebar (quantity & button state). */
    function updateTrackedItemDisplay(itemId, newQuantity) {
        const displayBar = document.getElementById(DISPLAY_ELEMENT_ID);
        if (!displayBar) return;

        const quantitySpan = displayBar.querySelector(`.tracker-quantity[data-item-id="${itemId}"]`);
        if (quantitySpan) {
            const itemTarget = getItemTarget(itemId);
            const formattedQuantity = itemTarget !== null
                ? `${newQuantity} / ${itemTarget}`
                : newQuantity;
            if (quantitySpan.textContent !== formattedQuantity) {
                 console.log(`FL Tracker: Updating display for ${itemId} to "${formattedQuantity}"`);
                 quantitySpan.textContent = formattedQuantity;
            }
        } else {
            // This can happen if the item was just added/removed, displayTrackedItems will handle it.
            // console.warn(`FL Tracker: Quantity span not found for item ${itemId} during incremental update.`);
            return;
        }
        updateUseButtonState(itemId, newQuantity);
    }

    /** Updates the enabled/disabled state and title of the 'Use' button for an item. */
    function updateUseButtonState(itemId, quantity) {
        const displayBar = document.getElementById(DISPLAY_ELEMENT_ID);
        if (!displayBar) return;
        const useButton = displayBar.querySelector(`.${USE_BUTTON_CLASS}[data-item-id="${itemId}"]`);
        if (useButton) {
            const qtyNum = parseInt(quantity, 10) || 0;
            const isDisabled = qtyNum <= 0;
            useButton.disabled = isDisabled;
            // Only update title if it changes, reduces unnecessary DOM manipulation
            const newTitle = isDisabled ? "Cannot use: Qty 0" : `Use ${GM_getValue(getStorageKeyPrefix(itemId) + "name", `Item ${itemId}`)}`;
            if (useButton.title !== newTitle) {
                 useButton.title = newTitle;
            }
        }
    }

    /** Creates/updates the sidebar display, adding/removing items as needed. */
    function displayTrackedItems() {
        let displayBar = document.getElementById(DISPLAY_ELEMENT_ID);
        if (!displayBar) {
            console.log("FL Tracker: Creating sidebar display element.");
            displayBar = document.createElement("div");
            displayBar.id = DISPLAY_ELEMENT_ID;
            document.body.appendChild(displayBar);
            setupSidebarListeners(displayBar); // Setup listeners when bar is first created
        }

        const trackedIds = getTrackedItemIds();
        const currentDisplayedIds = new Set(
            Array.from(displayBar.querySelectorAll(`.${CONTAINER_CLASS}[data-item-id]`))
                .map(el => parseInt(el.dataset.itemId, 10))
        );

        const idsToAdd = trackedIds.filter(id => !currentDisplayedIds.has(id));
        const idsToRemove = [...currentDisplayedIds].filter(id => !trackedIds.includes(id));

        // Remove items no longer tracked
        idsToRemove.forEach(itemId => {
            const containerToRemove = displayBar.querySelector(`.${CONTAINER_CLASS}[data-item-id="${itemId}"]`);
            if (containerToRemove) {
                console.log(`FL Tracker: Removing item ${itemId} from display.`);
                containerToRemove.remove();
            }
        });

        // Add newly tracked items
        idsToAdd.forEach(itemId => {
            console.log(`FL Tracker: Adding item ${itemId} to display.`);
            const prefix = getStorageKeyPrefix(itemId);
            const item = {
                id: itemId,
                name: GM_getValue(prefix + "name", `Item ${itemId}`),
                quantity: GM_getValue(prefix + "quantity", "?"),
                icon: GM_getValue(prefix + "icon", ""),
                category: GM_getValue(prefix + STORAGE_SUFFIX_CATEGORY, ""),
                description: GM_getValue(prefix + "description", "No description available."),
                isUsable: GM_getValue(prefix + "is_usable", false),
                target: getItemTarget(itemId)
            };

            const container = document.createElement("div");
            container.className = CONTAINER_CLASS;
            container.dataset.itemId = itemId;

            // Build Tooltip HTML
            let tooltipHTML = `<div class="${TOOLTIP_CLASS}">`;
            tooltipHTML += `<span class="tooltip-name">${item.name}</span>`;
            tooltipHTML += `<span class="tooltip-desc-line">`;
            if (item.category) tooltipHTML += `<span class="tooltip-category">${item.category}</span>`;
            tooltipHTML += `<span class="tooltip-description">${item.description}</span>`;
            tooltipHTML += `</span>`;
            if (item.isUsable) {
                tooltipHTML += `<button class="${USE_BUTTON_CLASS}" data-item-id="${item.id}" title="Use ${item.name}">Use</button>`;
                tooltipHTML += `<div class="tooltip-status" style="display: none;"></div>`; // Add status placeholder
            }
            tooltipHTML += `</div>`;

            // Build Visible Part HTML
            let visibleHTML = item.icon
                ? `<img src="${item.icon}" alt="Icon" class="tracker-icon" loading="lazy">`
                : `<span class="tracker-icon placeholder">?</span>`;
            const formattedQuantity = item.target !== null ? `${item.quantity} / ${item.target}` : item.quantity;
            visibleHTML += `<span class="tracker-quantity" data-item-id="${item.id}">${formattedQuantity}</span>`;

            container.innerHTML = visibleHTML + tooltipHTML;
            displayBar.appendChild(container); // Add to bar first

            updateUseButtonState(item.id, item.quantity); // Set initial button state

            // Apply loading state if finder is active
            if (findIntervalId) container.classList.add("loading", "error");
        });

         // Reorder elements to match trackedIds array (keeps user order)
         const desiredOrderMap = new Map(trackedIds.map((id, index) => [id, index]));
         const containersToSort = Array.from(displayBar.querySelectorAll(`.${CONTAINER_CLASS}[data-item-id]`));

         containersToSort.sort((a, b) => {
             const idA = parseInt(a.dataset.itemId, 10);
             const idB = parseInt(b.dataset.itemId, 10);
             return (desiredOrderMap.get(idA) ?? Infinity) - (desiredOrderMap.get(idB) ?? Infinity);
         });

         // Re-append in sorted order
         containersToSort.forEach(container => displayBar.appendChild(container));

        // Handle placeholder visibility
        const placeholder = displayBar.querySelector('span[style*="italic"]');
        if (trackedIds.length === 0 && !placeholder) {
            displayBar.innerHTML = `<span style="color: #888; font-style: italic; pointer-events: none;">Click '+' on an item in Possessions to track it.</span>`;
        } else if (trackedIds.length > 0 && placeholder) {
            placeholder.remove();
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

        const itemData = parseItemDataFromElement(itemElement) || { name: `Item ${itemId}` };
        const itemName = itemData.name;
        const currentTarget = getItemTarget(itemId);
        const isTracked = getTrackedItemIds().includes(itemId);

        const overlay = document.createElement("div");
        overlay.id = POPUP_OVERLAY_ID;
        overlay.className = "fl-tracker-popup-overlay";
        overlay.addEventListener('click', (event) => { if (event.target === overlay) removeTargetPopup(); });

        const box = document.createElement("div");
        box.className = POPUP_BOX_CLASS;

        // Dynamically build buttons based on state
        let buttonsHTML = `<button id="fl-popup-set" class="primary">${isTracked ? 'Update Target' : 'Set Target & Track'}</button>`;
        if (isTracked && currentTarget !== null) buttonsHTML += `<button id="fl-popup-remove-target">Remove Target</button>`;
        if (isTracked) buttonsHTML += `<button id="fl-popup-untrack" class="danger">Untrack Item</button>`;
        buttonsHTML += `<button id="fl-popup-cancel">Cancel</button>`;

        box.innerHTML = `
            <h3>${isTracked ? 'Update Target / Untrack' : 'Set Target & Track'}: ${itemName}</h3>
            <label for="fl-target-input">Target Quantity (0+, blank to remove):</label>
            <input type="number" id="fl-target-input" min="0" step="1" placeholder="No target" value="${currentTarget !== null ? currentTarget : ''}">
            <div class="fl-tracker-popup-buttons">${buttonsHTML}</div>
        `;

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const inputField = box.querySelector('#fl-target-input');
        inputField.focus();
        inputField.select();

        // --- Button Event Listeners ---
        box.querySelector('#fl-popup-set').addEventListener('click', () => {
            setItemTarget(itemId, inputField.value);
            if (!isTracked) trackItem(itemId); // Track if setting target on untracked item
            removeTargetPopup();
        });

        const removeBtn = box.querySelector('#fl-popup-remove-target');
        if (removeBtn) removeBtn.addEventListener('click', () => { setItemTarget(itemId, null); removeTargetPopup(); });

        const untrackBtn = box.querySelector('#fl-popup-untrack');
        if (untrackBtn) untrackBtn.addEventListener('click', () => { untrackItem(itemId); removeTargetPopup(); });

        box.querySelector('#fl-popup-cancel').addEventListener('click', removeTargetPopup);

        inputField.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') { event.preventDefault(); box.querySelector('#fl-popup-set').click(); }
        });
    }

    // =========================================================================
    // === DATA PARSING & API HANDLING ===
    // =========================================================================

    /** Parses item data from a DOM element on the /possessions page. */
    function parseItemDataFromElement(itemElement) {
        if (!itemElement) return null;
        try {
            const qualityId = parseInt(itemElement.getAttribute("data-quality-id"), 10);
            const quantityElement = itemElement.querySelector("span.js-item-value");
            const buttonDiv = itemElement.querySelector('div[role="button"]');
            const imgElement = itemElement.querySelector("img");
            const ariaLabelSource = buttonDiv || itemElement;
            const ariaLabel = ariaLabelSource?.getAttribute("aria-label") ?? "";
            const imgSrc = imgElement?.getAttribute("src") ?? "";

            if (!qualityId || !quantityElement || !ariaLabel || !imgSrc) return null;

            const itemQuantity = quantityElement.textContent.trim();
            const currentIcon = imgSrc.startsWith("//") ? `https:${imgSrc}` : imgSrc;

            // --- Parse Name, Category, Description from aria-label ---
            const parts = ariaLabel.split(/;\s*/);

            // --- REVISED Regex V3 ---
            // Looks for an optional, specific prefix "Number(s) x Space". Captures the rest as name.
            const nameMatch = parts[0]?.match(/^(?:\d[\d,\s]*x\s+)?(.+?)(?:\s*×\s*\d+)?$/);
            const itemName = nameMatch?.[1]?.trim() ?? // Use group 1 if regex matches
                                parts[0]?.trim() ??       // Fallback to trimmed parts[0]
                                `Item ${qualityId}`;      // Final fallback

            let itemCategory = "";
            let itemDescription = "";
            let isUsable = false;
            const categoryRegex = new RegExp(`\\b(${KNOWN_CATEGORIES.join("|")})\\b`, "i");

            let descParts = [];
            let categoryFound = false;
            for (let i = 1; i < parts.length; i++) {
                const part = parts[i].trim();
                if (!part) continue;

                    if (part.toLowerCase().startsWith("click on this item")) {
                    isUsable = true;
                    continue;
                    }

                const categoryMatch = !categoryFound ? part.match(categoryRegex) : null;
                if (categoryMatch) {
                    itemCategory = categoryMatch[0];
                    const remainingText = part.substring(part.indexOf(itemCategory) + itemCategory.length).trim();
                    if (remainingText) descParts.push(remainingText);
                    categoryFound = true;
                } else {
                    descParts.push(part);
                }
            }
            itemDescription = descParts.join("; ").trim();

            // --- Debugging log ---
            // console.log(`Parsed ID ${qualityId}: Qty=${itemQuantity}, Name="${itemName}", Cat="${itemCategory}", Desc="${itemDescription}", Use=${isUsable}, Label="${parts[0]}"`);

            return {
                id: qualityId, name: itemName, quantity: itemQuantity, icon: currentIcon,
                category: itemCategory, description: itemDescription, isUsable: isUsable,
            };
        } catch (error) {
            console.error("FL Tracker: Error parsing item data from element:", error, itemElement);
            return null;
        }
    }

    /** Processes intercepted API response data to update tracked item quantities. */
    function processInterceptedData(responseData) {
        if (!responseData?.messages?.length) return; // Check for messages array

        console.log("FL Tracker: Processing intercepted /choosebranch data...");
        const trackedIds = getTrackedItemIds();
        let updated = false;

        responseData.messages.forEach(message => {
            if (message?.possession) {
                const pData = message.possession;
                const itemId = parseInt(pData.id, 10);
                // Use 'level' for quantity, ensure it exists
                if (!isNaN(itemId) && pData.level !== undefined && pData.level !== null) {
                    if (trackedIds.includes(itemId)) {
                        const newQty = pData.level.toString();
                        const prefix = getStorageKeyPrefix(itemId);
                        if (GM_getValue(prefix + "quantity", null) !== newQty) {
                            console.log(`FL Tracker: Updating item ${itemId} quantity to ${newQty} via intercept`);
                            GM_setValue(prefix + "quantity", newQty);
                            updateTrackedItemDisplay(itemId, newQty);
                            updated = true;
                        }
                        // Consider updating name/icon here too? Less critical.
                        // if (pData.name) GM_setValue(prefix + "name", pData.name);
                        // if (pData.image) GM_setValue(prefix + "icon", `https://images.fallenlondon.com/icons/${pData.image}.png`);
                    }
                }
            }
        });
        if (updated) console.log("FL Tracker: Sidebar display updated from intercepted data.");
    }

    /** Sets up interception for fetch and XMLHttpRequest. */
    function setupRequestInterceptor() {
        const TARGET_URL = API_INTERCEPT_URL_PATTERN; // Use constant defined above
        if (!TARGET_URL) {
             console.warn("FL Tracker: No API intercept URL pattern defined. Skipping interceptor setup.");
             return;
        }
        const { fetch: originalFetch, XMLHttpRequest: originalXHR } = window;
        const originalXhrOpen = originalXHR.prototype.open;
        const originalXhrSend = originalXHR.prototype.send;

        console.log("FL Tracker: Setting up request interceptors...");

        // --- Patch fetch ---
        window.fetch = async function(input, init) {
            const url = (typeof input === 'string') ? input : input?.url;
            const fetchPromise = originalFetch.apply(this, arguments);

            if (url && TARGET_URL.test(url)) { // Use test() method for regex
                console.log(`FL Tracker: Intercepting fetch: ${url}`);
                fetchPromise.then(response => {
                    if (response.ok) {
                        response.clone().json() // Clone before reading body
                            .then(data => processInterceptedData(data))
                            .catch(e => console.warn(`FL Tracker: Failed to parse JSON from fetch ${url}`, e));
                    } else {
                        console.warn(`FL Tracker: Intercepted fetch ${url} failed: ${response.status}`);
                    }
                }).catch(error => console.error(`FL Tracker: Error in fetch intercept processing for ${url}`, error));
                // We don't need to return the modified response, just observe it.
            }
            return fetchPromise; // Return original promise regardless
        };

        // --- Patch XMLHttpRequest ---
        originalXHR.prototype.open = function(method, url) {
             this._trackedUrl = url; // Store URL on instance
             return originalXhrOpen.apply(this, arguments);
        };

        originalXHR.prototype.send = function() {
            const xhr = this;
            const originalCallback = xhr.onreadystatechange;
            let processed = false; // Prevent multiple triggers

            xhr.onreadystatechange = function() {
                if (xhr.readyState === 4 && !processed && xhr._trackedUrl && TARGET_URL.test(xhr._trackedUrl)) {
                    processed = true;
                    console.log(`FL Tracker: Intercepting XHR: ${xhr._trackedUrl} (Status: ${xhr.status})`);
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try {
                            const data = JSON.parse(xhr.responseText);
                            processInterceptedData(data);
                        } catch (e) {
                            console.error("FL Tracker: Error processing XHR response", e, xhr.responseText);
                        }
                    } else {
                         console.warn(`FL Tracker: Intercepted XHR ${xhr._trackedUrl} failed: ${xhr.status}`);
                    }
                }
                // Call original callback if it exists
                if (originalCallback) return originalCallback.apply(this, arguments);
            };
            return originalXhrSend.apply(this, arguments);
        };
        console.log("FL Tracker: Request interceptors active.");
    }

    /** Uses an item via the API. */
    function useTrackedItem(itemId, buttonElement) {
        if (!itemId) return;
        console.log(`FL Tracker: Attempting to use item ID ${itemId}.`);
        const token = findAuthToken();
        const tooltipElement = buttonElement?.closest(`.${TOOLTIP_CLASS}`); // Find parent tooltip

        if (!token) {
            showStatusMessage(tooltipElement, "Error: Auth Token not found.", "error");
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
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "Accept": "application/json, */*",
                "X-Requested-With": "XMLHttpRequest", // Often needed for APIs
            },
            data: JSON.stringify({ qualityId: itemId }),
            responseType: "json", // Expect JSON response
            timeout: 15000, // 15 second timeout
            onload: function (response) {
                console.log("FL Tracker: Use API Response Status:", response.status);
                if (response.status >= 200 && response.status < 300) {
                    console.log("FL Tracker: API use successful. Page should update via intercept/reload.");
                    // Don't auto-reload, rely on interception or game's own update
                    // showStatusMessage(tooltipElement, "Used!", "success"); // Optional success message
                    // If interceptor works, display will update automatically. Button state will update then too.
                    // If interceptor *might* fail, re-enable button after a delay? Risky.
                } else {
                    const errorMessage = response.response?.message || response.statusText || `HTTP ${response.status}`;
                    console.error("FL Tracker: Use API Error - ", errorMessage, response.response);
                    showStatusMessage(tooltipElement, `Error: ${errorMessage}`, "error");
                    if (buttonElement) buttonElement.disabled = false; // Re-enable on error
                    // If tooltip was hidden, re-show it on error
                    // if (tooltipElement && !tooltipElement.classList.contains(VISIBLE_CLASS)) {
                    //    tooltipElement.classList.add(VISIBLE_CLASS);
                    // }
                }
            },
            onerror: function (response) {
                console.error("FL Tracker: Use Network Error - ", response.statusText, response.error);
                showStatusMessage(tooltipElement, `Network Error: ${response.error || "Failed to send"}`, "error");
                if (buttonElement) buttonElement.disabled = false;
            },
            ontimeout: function () {
                console.error("FL Tracker: Use Request timed out.");
                showStatusMessage(tooltipElement, "Error: Request Timed Out", "error");
                if (buttonElement) buttonElement.disabled = false;
            }
        });
    }


    // =========================================================================
    // === POSSESSIONS PAGE HANDLING ===
    // =========================================================================

    /** Finds tracked items on /possessions page and stores/updates their data. */
    function findAndStoreTrackedItemsData() {
        const trackedIds = getTrackedItemIds();
        if (trackedIds.length === 0) return;

        console.log(`FL Tracker: Searching /possessions for ${trackedIds.length} tracked items...`);
        const displayBar = document.getElementById(DISPLAY_ELEMENT_ID);

        // Mark relevant items in sidebar as loading
        trackedIds.forEach(id => {
            const container = displayBar?.querySelector(`.${CONTAINER_CLASS}[data-item-id="${id}"]`);
            container?.classList.add("loading", "error"); // Assume error until found
        });

        if (findIntervalId) clearInterval(findIntervalId); // Clear previous interval if any

        const startTime = Date.now();
        const itemSelector = trackedIds.map(id => `.icon[data-quality-id="${id}"]`).join(", ");

        findIntervalId = setInterval(() => {
            // Ensure we are still on the possessions page
            if (!window.location.pathname.includes("/possessions")) {
                 console.log("FL Tracker: Navigated away during item search, stopping.");
                 clearInterval(findIntervalId);
                 findIntervalId = null;
                 // Clean up loading state? Maybe not needed as handlePathChange will disconnect observer.
                 return;
            }

            const itemContainer = document.querySelector(POSSESSIONS_ITEM_CONTAINER_SELECTOR);
            if (!itemContainer) { // Container might disappear during SPA transitions
                 if (Date.now() - startTime > WAIT_TIMEOUT_MS / 2) { // Give it some time
                      console.warn("FL Tracker: Possessions container not found during search.");
                      clearInterval(findIntervalId);
                      findIntervalId = null;
                 }
                 return; // Wait for container to appear
            }

            const foundElements = itemContainer.querySelectorAll(itemSelector);
            const foundIds = new Set();
            let updated = false;

            // Process found items
            foundElements.forEach(itemElement => {
                const itemData = parseItemDataFromElement(itemElement);
                if (itemData) {
                    storeItemData(itemData);
                    updateTrackedItemDisplay(itemData.id, itemData.quantity); // Update display incrementally
                    foundIds.add(itemData.id);
                    const container = displayBar?.querySelector(`.${CONTAINER_CLASS}[data-item-id="${itemData.id}"]`);
                    container?.classList.remove("loading", "error"); // Found, remove flags
                    updated = true;
                }
            });

            // Handle timeout or completion
            if (foundIds.size === trackedIds.length || Date.now() - startTime >= WAIT_TIMEOUT_MS) {
                clearInterval(findIntervalId);
                findIntervalId = null;

                const missingIds = trackedIds.filter(id => !foundIds.has(id));
                if (missingIds.length > 0) {
                    console.log(`FL Tracker: Items not found on page (Timeout or Qty 0): [${missingIds.join(", ")}]`);
                    missingIds.forEach(missingId => {
                        const prefix = getStorageKeyPrefix(missingId);
                        // Only set to 0 if we previously had valid data for it
                        if (GM_getValue(prefix + "name", null) && !GM_getValue(prefix + "name", "").startsWith("Item ")) {
                             console.log(`FL Tracker: Setting quantity to 0 for missing item ID ${missingId}.`);
                             GM_setValue(prefix + "quantity", "0");
                             updateTrackedItemDisplay(missingId, "0");
                             updated = true;
                        }
                        const container = displayBar?.querySelector(`.${CONTAINER_CLASS}[data-item-id="${missingId}"]`);
                        container?.classList.remove("loading"); // Remove loading, keep error if applicable? Or remove both?
                        container?.classList.remove("error");
                    });
                }
                console.log(`FL Tracker: Finished /possessions item search. ${updated ? 'Display updated.' : ''}`);
            }
        }, RETRY_INTERVAL_MS);
    }

    /** Enhances the /possessions page by adding '+' buttons to items. */
    function enhancePossessionsPage() {
        // console.log("FL Tracker: Enhancing possessions page..."); // Reduce noise
        const itemContainer = document.querySelector(POSSESSIONS_ITEM_CONTAINER_SELECTOR);
        if (!itemContainer) return;

        const itemIcons = itemContainer.querySelectorAll(".icon[data-quality-id]:not(.fl-tracker-enhanced)"); // Select only icons not yet enhanced

        if (itemIcons.length > 0) {
             console.log(`FL Tracker: Found ${itemIcons.length} new item icons to enhance.`);
        }

        itemIcons.forEach((iconElement) => {
            const itemId = parseInt(iconElement.getAttribute("data-quality-id"), 10);
            if (!itemId) return;

            iconElement.classList.add('fl-tracker-enhanced'); // Mark as enhanced

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
        const container = document.querySelector(POSSESSIONS_ITEM_CONTAINER_SELECTOR);
        if (!container) return;

        const addButtons = container.querySelectorAll(`.${ADD_BUTTON_CLASS}`);
        addButtons.forEach((button) => {
            const buttonItemId = parseInt(button.dataset.itemId || "0", 10);
            if (buttonItemId) {
                const isTracked = trackedIds.includes(buttonItemId);
                const currentText = isTracked ? "✓" : "+";
                const currentTitle = isTracked ? "Update target / Untrack this item" : "Track this item with a target";

                if (button.textContent !== currentText) button.textContent = currentText;
                if (button.title !== currentTitle) button.title = currentTitle;
                button.classList.toggle("selected", isTracked);
            }
        });
    }

    /** Sets up a MutationObserver to re-enhance the /possessions page when items change (e.g., filtering). */
    function setupPossessionsObserver(containerElement) {
        if (possessionsObserver) { // Disconnect previous if exists
            console.log("FL Tracker: Disconnecting existing Possessions observer.");
            possessionsObserver.disconnect();
        }

        const observerCallback = function(mutationsList, observer) {
            let needsEnhance = false;
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList' && (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
                    // Check if actual item icons were added/removed
                    const affectedIcons = Array.from(mutation.addedNodes).some(n => n.nodeType === 1 && (n.matches?.('.icon[data-quality-id]') || n.querySelector?.('.icon[data-quality-id]'))) ||
                                          Array.from(mutation.removedNodes).some(n => n.nodeType === 1 && n.matches?.('.icon[data-quality-id]')); // Don't need querySelector for removed
                    if (affectedIcons) {
                        needsEnhance = true;
                        break;
                    }
                }
            }

            if (needsEnhance) {
                // console.log("FL Tracker: Detected changes in possessions, debouncing enhance..."); // Reduce noise
                clearTimeout(enhanceDebounceTimer);
                enhanceDebounceTimer = setTimeout(() => {
                    // Check if container still exists before enhancing
                    const currentContainer = document.querySelector(POSSESSIONS_ITEM_CONTAINER_SELECTOR);
                    if (!currentContainer) {
                        console.warn("FL Tracker: Possessions container disappeared before debounced enhance.");
                        return;
                    }

                    // Temporarily disconnect observer during enhancement to prevent loops
                    console.log("FL Tracker: Temporarily disconnecting observer for enhancement.");
                    observer.disconnect(); // Use the passed observer instance
                    try {
                        console.log("FL Tracker: Re-enhancing possessions page after mutation.");
                        enhancePossessionsPage();
                    } catch (e) {
                        console.error("FL Tracker: Error during debounced enhancePossessionsPage:", e);
                    } finally {
                        // Reconnect observer, ensure container still valid
                        if (document.body.contains(currentContainer)) { // Check if element is still in DOM
                             console.log("FL Tracker: Reconnecting observer.");
                             observer.observe(currentContainer, { childList: true, subtree: true });
                        } else {
                             console.warn("FL Tracker: Cannot reconnect observer, container removed from DOM.");
                             possessionsObserver = null; // Nullify the global variable if container gone
                        }
                    }
                }, ENHANCE_DEBOUNCE_DELAY);
            }
        };

        possessionsObserver = new MutationObserver(observerCallback);
        possessionsObserver.observe(containerElement, { childList: true, subtree: true });
        console.log("FL Tracker: Possessions observer started.");
    }

    // --- Refactored Tracking Logic ---
    /** Adds an item to the tracked list and updates relevant UI. */
    function trackItem(itemId) {
        let trackedIds = getTrackedItemIds();
        if (!trackedIds.includes(itemId)) {
            console.log(`FL Tracker: Tracking item ID ${itemId}`);
            trackedIds.push(itemId);
            setTrackedItemIds(trackedIds);

            // Attempt to store initial data immediately
            const itemElement = document.querySelector(`${POSSESSIONS_ITEM_CONTAINER_SELECTOR} .icon[data-quality-id="${itemId}"]`);
            if (itemElement) {
                const itemData = parseItemDataFromElement(itemElement);
                if (itemData) storeItemData(itemData);
            } else {
                 console.warn(`FL Tracker: Could not find element for newly tracked item ${itemId} to store initial data.`);
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
            console.log(`FL Tracker: Untracking item ID ${itemId}`);
            trackedIds = trackedIds.filter(id => id !== itemId);
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
        console.log("FL Tracker: Path changed to:", currentPath);

        // Clean up resources from previous page state
        if (possessionsObserver) {
            console.log("FL Tracker: Disconnecting Possessions observer due to path change.");
            possessionsObserver.disconnect();
            possessionsObserver = null;
        }
        clearTimeout(enhanceDebounceTimer);
        if (findIntervalId) {
             console.log("FL Tracker: Clearing active item search interval.");
             clearInterval(findIntervalId);
             findIntervalId = null;
             // Remove any lingering loading indicators
             document.querySelectorAll(`#${DISPLAY_ELEMENT_ID} .${CONTAINER_CLASS}.loading`)
                     .forEach(c => c.classList.remove("loading", "error"));
        }

        // Actions specific to the /possessions page
        if (currentPath.includes("/possessions")) {
            console.log("FL Tracker: /possessions page detected.");
            // Wait for the main item container before proceeding
            waitForElement(POSSESSIONS_ITEM_CONTAINER_SELECTOR, (itemContainerElement) => {
                if (itemContainerElement && window.location.pathname.includes("/possessions")) { // Double-check path hasn't changed again
                    enhancePossessionsPage(); // Enhance visible items
                    findAndStoreTrackedItemsData(); // Find data for tracked items
                    setupPossessionsObserver(itemContainerElement); // Watch for changes
                } else if (!itemContainerElement) {
                    console.warn("FL Tracker: Possessions item container not found after wait.");
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
            window.dispatchEvent(new Event('pushstate')); // Dispatch custom event
            window.dispatchEvent(new Event('locationchange'));
            return result;
        };

        history.replaceState = function () {
            const result = originalReplaceState.apply(this, arguments);
            window.dispatchEvent(new Event('replacestate')); // Dispatch custom event
            window.dispatchEvent(new Event('locationchange'));
            return result;
        };

        window.addEventListener("popstate", () => {
            window.dispatchEvent(new Event('locationchange'));
        });

        // Listen to our custom event
        window.addEventListener('locationchange', handlePathChange);

        console.log("FL Tracker: SPA navigation listeners setup.");
    }

    // --- Main Execution ---
    console.log("FL Item Tracker++ Initializing...");

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

    console.log("FL Item Tracker++ Initialization complete.");

})(); // End of IIFE
