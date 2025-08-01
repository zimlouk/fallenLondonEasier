// ==UserScript==
// @name         Fallen London Item Tracker
// @namespace    http://tampermonkey.net/
// @version      2.7
// @description  Track items with goals. Updates via /myself API, real-time action intercepts, and enhances storylet/possessions pages.
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

  const WAIT_TIMEOUT_MS = 10000;
  const RETRY_INTERVAL_MS = 500;
  const ENHANCE_DEBOUNCE_DELAY = 300;

  const DISPLAY_ELEMENT_ID = "fl-item-tracker-sidebar";
  const CONTAINER_CLASS = "fl-tracker-item-container";
  const TRACKED_ITEM_IDS_KEY = "fl_tracker_tracked_ids_v4";
  const TOOLTIP_CLASS = "fl-tracker-tooltip";
  const VISIBLE_CLASS = "fl-tracker-tooltip-visible";
  const USE_BUTTON_CLASS = "fl-tracker-use-button";
  const ADD_BUTTON_CLASS = "fl-tracker-add-button";
  const POPUP_OVERLAY_ID = "fl-tracker-popup-overlay";
  const POPUP_BOX_CLASS = "fl-tracker-popup-box";
  const STORAGE_KEY_PREFIX = "fl_tracker_v4_item_";
  const STORAGE_SUFFIX_TARGET = "target";
  const STORAGE_SUFFIX_CATEGORY = "category";

  const API_MYSELF_PATTERN = /\/api\/character\/myself$/;
  const API_CHOOSEBRANCH_PATTERN = /\/api\/storylet\/choosebranch$/;
  const API_SELL_PATTERN = /\/api\/exchange\/sell$/;
  const API_BUY_PATTERN = /\/api\/exchange\/buy$/;
  const API_STORYLET_PATTERN = /\/api\/storylet(\/begin)?$/;
  const API_USE_URL = "https://api.fallenlondon.com/api/storylet/usequality";

  const INTERCEPT_PATTERNS = [
    API_MYSELF_PATTERN, API_CHOOSEBRANCH_PATTERN, API_SELL_PATTERN, API_BUY_PATTERN, API_STORYLET_PATTERN,
  ];

  const KNOWN_CATEGORIES = [
    "ubiquitous", "commonplace", "uncommon", "scarce", "rare", "coveted", "legendary",
  ];

  let possessionsObserver = null;
  let enhanceDebounceTimer = null;
  let isSidebarListenerSetup = false;


  // =========================================================================
  // === STYLES ===
  // =========================================================================
  GM_addStyle(`
    #${DISPLAY_ELEMENT_ID} {
        position: fixed; top: 65px; right: 0; width: 54px; min-width: 28px; z-index: 10000;
        display: flex; flex-direction: column; align-items: flex-end;
        background: linear-gradient(to right,rgb(189, 178, 158) 85%,rgb(182, 173, 144) 100%);
        box-shadow: -2px 0 8px rgba(90,80,50,0.07); padding: 0; box-sizing: border-box;
        font-family: "Roboto Slab", Georgia, Times, serif;
        border-top: 2px solid rgb(137, 125, 103); border-bottom: 2px solid rgb(137, 125, 103); border-left: 2px solid rgb(137, 125, 103);
    }
    #${DISPLAY_ELEMENT_ID}.fl-tracker-collapsed { width: 28px !important; min-width: 28px; background: transparent !important; border: none !important; box-shadow: none !important; padding: 0; }
    #${DISPLAY_ELEMENT_ID} .fl-tracker-arrow {
        width: 100%; height: 25px; background: #d0c6b4; color: #8d7500; font-size: 16px;
        border: none; border-bottom: 1px solid #b9a365; display: flex; align-items: center; justify-content: center;
        cursor: pointer; box-shadow: none; transition: background-color 0.16s, color 0.16s;
        margin-bottom: 8px; padding: 0; box-sizing: border-box; text-align: center;
    }
    #${DISPLAY_ELEMENT_ID} .fl-tracker-arrow:hover { background: #e0d8c7; color: #a38a00; }
    #${DISPLAY_ELEMENT_ID}.fl-tracker-collapsed .fl-tracker-arrow { background: #c0b6a5; border-bottom-color: #a89d7c; }
    #${DISPLAY_ELEMENT_ID} .fl-tracker-content { display: flex; flex-direction: column; align-items: center; width: 100%; gap: 8px; }
    #${DISPLAY_ELEMENT_ID}.fl-tracker-collapsed .fl-tracker-content { display: none !important; }
    .${CONTAINER_CLASS} {
        position: relative; display: flex; flex-direction: column; align-items: center;
        width: 46px; min-height: 48px; flex-shrink: 0; text-align: center; overflow: visible !important;
        box-sizing: border-box; background-color: rgb(237, 227, 210);
        background-image: url(https://images.fallenlondon.com/static/bg-paper.png);
        border: none; border-radius: 0; padding: 5px 4px;
        box-shadow: 0 2px 3px rgba(145, 133, 110, 0.6); color: rgb(40, 37, 32);
        pointer-events: auto; cursor: pointer;
    }
    #${DISPLAY_ELEMENT_ID} img.tracker-icon {
        width: 32px; height: 32px; border-radius: 0; margin-bottom: 4px;
        border: 2px solid rgb(56, 56, 56); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
        box-sizing: border-box; display: block; vertical-align: middle; flex-shrink: 0;
    }
    #${DISPLAY_ELEMENT_ID} .tracker-quantity {
        font-size: clamp(11px, 1.5vw, 13px); color: #8d7500; font-weight: bold; margin-top: 2px;
        text-shadow: 0 1px 0 #f8e6b7; font-family: "Roboto Slab", Georgia, Times, serif;
        word-break: break-all; text-align: center; max-width: 42px; line-height: 1.2;
        border-radius: 0; padding: 1px 2px; box-sizing: border-box; overflow-wrap: anywhere; white-space: normal;
    }
    #${DISPLAY_ELEMENT_ID} .fl-tracker-placeholder {
        color: #8d7500; font-style: italic; font-size: 11px; text-align: center; padding: 10px 5px;
        width: 100%; box-sizing: border-box; word-wrap: break-word; overflow-wrap: break-word;
        white-space: normal; line-height: 1.3; display: block;
    }
    .${TOOLTIP_CLASS} {
        display: none; position: absolute; top: 50%; right: calc(100% + 8px); left: auto;
        transform: translateY(-50%); background-color: rgba(10, 10, 10, 0.97); color: #E0E0E0;
        border: 1px solid #666; border-radius: 5px; padding: 10px 12px; width: max-content;
        max-width: 300px; font-size: 13px; z-index: 10001; text-align: left;
        white-space: normal; box-shadow: -3px 3px 8px rgba(0, 0, 0, 0.5); pointer-events: auto; cursor: default;
    }
    .${TOOLTIP_CLASS}.${VISIBLE_CLASS} { display: block; }
    .${TOOLTIP_CLASS} .tooltip-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 8px; }
    .${TOOLTIP_CLASS} .tooltip-name { font-weight: bold; color: #FFF; font-size: 14px; margin-bottom: 0; flex-grow: 1; }
    .${TOOLTIP_CLASS} .fl-tracker-untrack-btn {
        display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px;
        background-color: #553333; color: #fcc; border: 1px solid #885555; border-radius: 3px;
        font-size: 14px; font-weight: bold; line-height: 16px; text-align: center;
        cursor: pointer; padding: 0; flex-shrink: 0; transition: background-color 0.15s ease, border-color 0.15s ease;
    }
    .${TOOLTIP_CLASS} .fl-tracker-untrack-btn:hover { background-color: #774444; border-color: #aa7777; color: #fff; }
    .tooltip-desc-line { display: block; margin-top: 4px; margin-bottom: 8px; line-height: 1.4; }
    .tooltip-category { font-weight: bold !important; font-style: italic !important; margin-right: 0.4em; color: #DDD; text-shadow: 1px 1px 2px rgba(0,0,0,0.7); }
    .tooltip-description { color: #BBB; font-weight: normal; font-style: normal; }
    .${TOOLTIP_CLASS} .${USE_BUTTON_CLASS} {
        background-color: #555; color: #FFF; border: 1px solid #777; padding: 4px 10px; border-radius: 3px;
        cursor: pointer; font-size: 12px; display: block; margin-top: 8px; text-align: center; width: 100%; box-sizing: border-box;
    }
    .${TOOLTIP_CLASS} .${USE_BUTTON_CLASS}:hover:not([disabled]) { background-color: #666; border-color: #888; }
    .${TOOLTIP_CLASS} .${USE_BUTTON_CLASS}[disabled] { background-color: #444; color: #888; cursor: not-allowed; border-color: #555; }
    .${TOOLTIP_CLASS} .tooltip-status { font-size: 11px; margin-top: 8px; padding: 3px; text-align: center; border-radius: 3px; display: none; min-height: 1em; }
    .${TOOLTIP_CLASS} .tooltip-status.success { background-color: rgba(50, 120, 50, 0.7); color: #C8E6C9; }
    .${TOOLTIP_CLASS} .tooltip-status.error { background-color: rgba(120, 50, 50, 0.7); color: #FFCDD2; }
    div[role="button"], .icon[data-quality-id] { position: relative; } /* Ensure parents are positioned */
    .${ADD_BUTTON_CLASS} {
        position: absolute; top: -5px; right: -5px; width: 18px; height: 18px;
        background-color: #282520 !important; color: #fff !important; border: 1px solid #4d4a45 !important;
        border-radius: 11px; font-family: "Roboto Slab", Georgia, Times, serif;
        font-size: 12px; font-weight: normal; line-height: 17px; text-align: center;
        cursor: pointer; z-index: 5; opacity: 0.85; transition: opacity 0.2s, transform 0.2s, background-color 0.2s;
        box-shadow: 0 1px 2px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;
    }
    .${ADD_BUTTON_CLASS}:hover { opacity: 1; transform: scale(1.1); background-color: #383430 !important; }
    .${ADD_BUTTON_CLASS}.selected {
        background-color: #ffd75e !important; color: #3a2e1d !important;
        border-color: #d4b343 !important; line-height: 16px;
    }
    #${POPUP_OVERLAY_ID} {
        position: fixed; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(0, 0, 0, 0.75);
        z-index: 10002; display: flex; align-items: center; justify-content: center;
    }
    .${POPUP_BOX_CLASS} {
        background-color: #111; border: 1px solid #555; padding: 20px 25px; color: #ccc;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; min-width: 300px; max-width: 400px;
        box-shadow: 0 0 15px rgba(0,0,0,0.5); border-radius: 0; text-align: left;
    }
    .${POPUP_BOX_CLASS} h3 { margin-top: 0; margin-bottom: 15px; color: #eee; font-size: 16px; border-bottom: 1px solid #444; padding-bottom: 8px; }
    .${POPUP_BOX_CLASS} label { display: block; margin-bottom: 5px; font-size: 14px; color: #bbb; }
    .${POPUP_BOX_CLASS} input[type="number"] {
        width: 100%; padding: 8px 10px; margin-bottom: 15px; background-color: #222;
        border: 1px solid #555; color: #eee; font-size: 14px; box-sizing: border-box; border-radius: 0;
    }
    .${POPUP_BOX_CLASS} input[type=number]::-webkit-outer-spin-button,
    .${POPUP_BOX_CLASS} input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    .${POPUP_BOX_CLASS} input[type=number] { -moz-appearance: textfield; }
    .fl-tracker-popup-buttons { display: flex; justify-content: space-between; gap: 10px; margin-top: 15px; flex-wrap: wrap; }
    .fl-tracker-popup-buttons button {
        padding: 10px 20px; flex-grow: 1; margin: 0; text-align: center; min-width: 80px;
        background-color: rgb(66, 104, 107); border: 1px solid rgb(45, 82, 86); color: rgb(185, 225, 228);
        font-family: "Roboto Slab", Georgia, Times, serif; font-weight: 700; font-size: 13px;
        letter-spacing: 0.65px; text-transform: uppercase; box-shadow: rgba(0, 0, 0, 0.5) 0px 1px 2px 0px;
        border-radius: 0; cursor: pointer; user-select: none; appearance: none;
        transition: background-color 0.15s ease, border-color 0.15s ease;
    }
    .fl-tracker-popup-buttons button:hover { background-color: rgb(76, 114, 117); border-color: rgb(55, 92, 96); }
    .fl-tracker-popup-buttons button.danger { background-color: rgb(107, 66, 66); border-color: rgb(86, 45, 45); color: rgb(228, 185, 185); }
    .fl-tracker-popup-buttons button.danger:hover { background-color: rgb(127, 76, 76); border-color: rgb(106, 55, 55); }
  `);

  // =========================================================================
  // === HELPER FUNCTIONS ===
  // =========================================================================
  function getStorageKeyPrefix(itemId) { return `${STORAGE_KEY_PREFIX}${itemId}_`; }
  function getTrackedItemIds() {
    try {
      const ids = JSON.parse(GM_getValue(TRACKED_ITEM_IDS_KEY, "[]"));
      return Array.isArray(ids) ? ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id)) : [];
    } catch (e) { return []; }
  }
  function setTrackedItemIds(ids) {
    if (!Array.isArray(ids)) return;
    const uniqueIds = [...new Set(ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id)))];
    GM_setValue(TRACKED_ITEM_IDS_KEY, JSON.stringify(uniqueIds));
  }
  function getItemTarget(itemId) {
    const storedTarget = GM_getValue(getStorageKeyPrefix(itemId) + STORAGE_SUFFIX_TARGET, null);
    if (storedTarget === null || storedTarget === "") return null;
    const targetNum = parseInt(storedTarget, 10);
    return !isNaN(targetNum) && targetNum >= 0 ? targetNum : null;
  }
  function setItemTarget(itemId, targetValue) {
    const prefix = getStorageKeyPrefix(itemId);
    let targetToStore = "";
    if (targetValue !== null && targetValue !== "" && targetValue !== undefined) {
      const targetNum = parseInt(targetValue, 10);
      if (!isNaN(targetNum) && targetNum >= 0) targetToStore = targetNum.toString();
    }
    GM_setValue(prefix + STORAGE_SUFFIX_TARGET, targetToStore);
    const currentQuantity = GM_getValue(prefix + "quantity", "?");
    updateTrackedItemDisplay(itemId, currentQuantity);
  }
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
  function findAuthToken() {
    const jwtRegex = /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]*$/;
    for (const storage of [localStorage, sessionStorage]) {
      try {
        for (const key of Object.keys(storage)) {
          const value = storage.getItem(key);
          if (value && typeof value === 'string' && value.startsWith('ey') && value.includes('.') && jwtRegex.test(value)) return value;
        }
      } catch (e) { /* ignore */ }
    }
    console.error("FL Tracker: Could not find JWT."); return null;
  }
  function showStatusMessage(tooltipElement, message, type = null) {
    if (!tooltipElement) return;
    let statusDiv = tooltipElement.querySelector(".tooltip-status");
    if (!statusDiv) {
      statusDiv = document.createElement("div"); statusDiv.className = "tooltip-status"; tooltipElement.appendChild(statusDiv);
    }
    statusDiv.textContent = message;
    statusDiv.className = "tooltip-status";
    if (type) statusDiv.classList.add(type);
    statusDiv.style.display = message ? "block" : "none";
  }
  function waitForElement(selector, callback, timeout = WAIT_TIMEOUT_MS, interval = RETRY_INTERVAL_MS) {
    const startTime = Date.now();
    const timer = setInterval(() => {
      const element = document.querySelector(selector);
      if (element) {
        clearInterval(timer); callback(element);
      } else if (Date.now() - startTime > timeout) {
        clearInterval(timer); callback(null);
      }
    }, interval);
  }

  // =========================================================================
  // === UI FUNCTIONS (SIDEBAR, POPUP, BUTTONS) ===
  // =========================================================================
  function setupSidebarListeners(displayBar) {
    if (isSidebarListenerSetup) return;
    displayBar.addEventListener("click", (event) => {
      const container = event.target.closest(`.${CONTAINER_CLASS}`);
      if (!container) return;
      event.stopPropagation();
      const itemId = parseInt(container.dataset.itemId, 10);
      const tooltip = container.querySelector(`.${TOOLTIP_CLASS}`);
      if (!itemId || !tooltip) return;
      if (event.target.closest(`.${USE_BUTTON_CLASS}`)) { useTrackedItem(itemId, event.target); return; }
      if (event.target.closest(".fl-tracker-untrack-btn")) { untrackItem(itemId); return; }
      if (tooltip.contains(event.target)) return;
      const isVisible = tooltip.classList.toggle(VISIBLE_CLASS);
      document.querySelectorAll(`#${DISPLAY_ELEMENT_ID} .${TOOLTIP_CLASS}.${VISIBLE_CLASS}`).forEach(vt => {
        if (vt !== tooltip) vt.classList.remove(VISIBLE_CLASS);
      });
      if (isVisible) showStatusMessage(tooltip, "", null);
    });
    document.addEventListener("click", (event) => {
      const displayBarElement = document.getElementById(DISPLAY_ELEMENT_ID);
      const visibleTooltip = displayBarElement?.querySelector(`.${TOOLTIP_CLASS}.${VISIBLE_CLASS}`);
      if (visibleTooltip && !displayBarElement.contains(event.target) && !visibleTooltip.contains(event.target)) {
        visibleTooltip.classList.remove(VISIBLE_CLASS);
        showStatusMessage(visibleTooltip, "", null);
      }
    }, true);
    isSidebarListenerSetup = true;
  }
  function updateTrackedItemDisplay(itemId, newQuantity) {
    const quantitySpan = document.querySelector(`#${DISPLAY_ELEMENT_ID} .tracker-quantity[data-item-id="${itemId}"]`);
    if (quantitySpan) {
      const itemTarget = getItemTarget(itemId);
      const formattedQuantity = itemTarget !== null ? `${newQuantity} / ${itemTarget}` : newQuantity;
      if (quantitySpan.textContent !== formattedQuantity) quantitySpan.textContent = formattedQuantity;
    }
    updateUseButtonState(itemId, newQuantity);
  }
  function updateUseButtonState(itemId, quantity) {
    const useButton = document.querySelector(`#${DISPLAY_ELEMENT_ID} .${USE_BUTTON_CLASS}[data-item-id="${itemId}"]`);
    if (useButton) useButton.disabled = (parseInt(quantity, 10) || 0) <= 0;
  }
  function displayTrackedItems() {
    let displayBar = document.getElementById(DISPLAY_ELEMENT_ID);
    let arrow, content;
    if (!displayBar) {
      displayBar = document.createElement("div"); displayBar.id = DISPLAY_ELEMENT_ID;
      arrow = document.createElement("div"); arrow.className = "fl-tracker-arrow"; arrow.title = "Toggle Tracker Sidebar";
      content = document.createElement("div"); content.className = "fl-tracker-content";
      displayBar.appendChild(arrow); displayBar.appendChild(content);
      document.body.appendChild(displayBar);
      arrow.addEventListener("click", (e) => {
        e.stopPropagation();
        const isCollapsing = !displayBar.classList.contains("fl-tracker-collapsed");
        displayBar.classList.toggle("fl-tracker-collapsed", isCollapsing);
        arrow.innerHTML = isCollapsing ? "▶" : "◀";
      });
      displayBar.classList.add("fl-tracker-collapsed");
      arrow.innerHTML = "▶";
      setupSidebarListeners(displayBar);
    } else {
      content = displayBar.querySelector(".fl-tracker-content");
      arrow = displayBar.querySelector(".fl-tracker-arrow");
      if(arrow) arrow.innerHTML = displayBar.classList.contains("fl-tracker-collapsed") ? "▶" : "◀";
    }
    if (!content) return;
    content.innerHTML = "";
    const trackedIds = getTrackedItemIds();
    if (trackedIds.length === 0) {
      content.innerHTML = `<span class="fl-tracker-placeholder">Click '+' on an item to track it.</span>`;
    } else {
      const fragment = document.createDocumentFragment();
      trackedIds.forEach(itemId => {
        const prefix = getStorageKeyPrefix(itemId);
        const item = {
          id: itemId, name: GM_getValue(prefix + "name", `Item ${itemId}`),
          quantity: GM_getValue(prefix + "quantity", "?"), icon: GM_getValue(prefix + "icon", ""),
          category: GM_getValue(prefix + STORAGE_SUFFIX_CATEGORY, ""),
          description: GM_getValue(prefix + "description", ""),
          isUsable: GM_getValue(prefix + "is_usable", false), target: getItemTarget(itemId),
        };
        const container = document.createElement("div"); container.className = CONTAINER_CLASS; container.dataset.itemId = itemId;
        container.innerHTML = `
          <img src="${item.icon}" class="tracker-icon" onerror="this.style.display='none'">
          <span class="tracker-quantity" data-item-id="${item.id}">${item.target !== null ? `${item.quantity} / ${item.target}` : item.quantity}</span>
          <div class="${TOOLTIP_CLASS}">
            <div class="tooltip-header"><span class="tooltip-name">${item.name}</span><button class="fl-tracker-untrack-btn" title="Untrack">×</button></div>
            <span class="tooltip-desc-line">
              ${item.category ? `<span class="tooltip-category">${item.category}</span>` : ''}
              <span class="tooltip-description">${item.description || "No description."}</span>
            </span>
            ${item.isUsable ? `<button class="${USE_BUTTON_CLASS}" data-item-id="${item.id}" title="Use ${item.name}">Use</button>` : ''}
          </div>`;
        fragment.appendChild(container);
        updateUseButtonState(item.id, item.quantity);
      });
      content.appendChild(fragment);
    }
  }
  function removeTargetPopup() { document.getElementById(POPUP_OVERLAY_ID)?.remove(); }
  function showTargetInputPopup(itemId, itemElement) {
    removeTargetPopup();
    const itemData = parseItemDataFromElement(itemElement) || { name: `Item ${itemId}` };
    const currentTarget = getItemTarget(itemId);
    const isTracked = getTrackedItemIds().includes(itemId);
    const overlay = document.createElement("div"); overlay.id = POPUP_OVERLAY_ID;
    overlay.addEventListener("click", e => { if (e.target === overlay) removeTargetPopup(); });
    let buttonsHTML = `<button id="fl-popup-set" class="primary">${isTracked ? "Update" : "Track"}</button>`;
    if (isTracked && currentTarget !== null) buttonsHTML += `<button id="fl-popup-remove-target">Remove Target</button>`;
    if (isTracked) buttonsHTML += `<button id="fl-popup-untrack" class="danger">Untrack</button>`;
    buttonsHTML += `<button id="fl-popup-cancel">Cancel</button>`;
    overlay.innerHTML = `<div class="${POPUP_BOX_CLASS}">
        <h3>Track: ${itemData.name}</h3>
        <label for="fl-target-input">Target Quantity (0+, blank to remove):</label>
        <input type="number" id="fl-target-input" min="0" step="1" placeholder="No target" value="${currentTarget ?? ''}">
        <div class="fl-tracker-popup-buttons">${buttonsHTML}</div>
      </div>`;
    document.body.appendChild(overlay);
    const inputField = overlay.querySelector("#fl-target-input"); inputField.focus(); inputField.select();
    overlay.querySelector("#fl-popup-set").addEventListener("click", () => {
      setItemTarget(itemId, inputField.value); if (!isTracked) trackItem(itemId); removeTargetPopup();
    });
    overlay.querySelector("#fl-popup-remove-target")?.addEventListener("click", () => { setItemTarget(itemId, null); removeTargetPopup(); });
    overlay.querySelector("#fl-popup-untrack")?.addEventListener("click", () => { untrackItem(itemId); removeTargetPopup(); });
    overlay.querySelector("#fl-popup-cancel").addEventListener("click", removeTargetPopup);
    inputField.addEventListener("keypress", e => { if (e.key === "Enter") overlay.querySelector("#fl-popup-set").click(); });
  }
  function addTrackButtonToElement(containerElement, itemId) {
    if (!containerElement || !itemId || containerElement.querySelector(`.${ADD_BUTTON_CLASS}`)) return;
    const addButton = document.createElement("button");
    addButton.className = ADD_BUTTON_CLASS; addButton.dataset.itemId = itemId; addButton.type = "button";
    addButton.addEventListener("click", (event) => {
        event.preventDefault(); event.stopPropagation();
        const popupContextElement = containerElement.closest('.icon[data-quality-id], .quality-requirement[data-quality-id]') || containerElement;
        showTargetInputPopup(itemId, popupContextElement);
    });
    containerElement.appendChild(addButton);
    containerElement.classList.add('fl-tracker-enhanced-btn');
  }

  // =========================================================================
  // === DATA PARSING & API HANDLING ===
  // =========================================================================
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
        if (!qualityId || !ariaLabel || !imgSrc) return null;
        const itemQuantity = quantityElement ? quantityElement.textContent.trim() : "1";
        const currentIcon = imgSrc.startsWith("//") ? `https:${imgSrc}` : imgSrc;
        function extractItemNameFromAriaLabel(label) {
            if (!label) return "";
            if (label.startsWith("You unlocked this with")) {
                return label.replace(/You unlocked this with [\d,]+\s/, '').replace(/\s\(you needed .+\)$/, '').trim();
            }
            let firstPart = label.split(";")[0].trim();
            return firstPart.replace(/\s*[×x]\s*[\d,]+\s*$/i, "").trim();
        }
        const itemName = extractItemNameFromAriaLabel(ariaLabel) || `Item ${qualityId}`;
        let itemCategory = ""; let itemDescription = ""; let isUsable = false;
        const parts = ariaLabel.split(/;\s*/);
        for (let i = 1; i < parts.length; i++) {
            const part = parts[i].trim();
            if (!part) continue;
            if (part.toLowerCase().startsWith("click on this item")) { isUsable = true; continue; }
            const categoryMatch = part.match(new RegExp(`\\b(${KNOWN_CATEGORIES.join("|")})\\b`, "i"));
            if (categoryMatch && !itemCategory) {
                itemCategory = categoryMatch[0];
                const remainingText = part.substring(part.indexOf(itemCategory) + itemCategory.length).trim();
                if (remainingText && !/^[,.;:]+$/.test(remainingText)) itemDescription += (itemDescription ? "; " : "") + remainingText;
            } else {
                itemDescription += (itemDescription ? "; " : "") + part;
            }
        }
        return { id: qualityId, name: itemName, quantity: itemQuantity, icon: currentIcon, category: itemCategory, description: itemDescription.trim(), isUsable: isUsable };
    } catch (error) { console.error("FL Tracker: Error parsing item data:", error, itemElement); return null; }
  }
  function setupRequestInterceptor() {
    const { fetch: originalFetch, XMLHttpRequest: originalXHR } = window;
    const originalXhrOpen = originalXHR.prototype.open;
    const originalXhrSend = originalXHR.prototype.send;
    function matchesAnyInterceptPattern(url) {
      if (!url) return null;
      for (const pattern of INTERCEPT_PATTERNS) if (pattern.test(url)) return pattern;
      return null;
    }
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : input?.url;
      const matchedPattern = matchesAnyInterceptPattern(url);
      let requestBody = null;
      if (init?.body && (matchedPattern === API_SELL_PATTERN || matchedPattern === API_BUY_PATTERN)) try { requestBody = JSON.parse(init.body); } catch(e) {}
      const fetchPromise = originalFetch.apply(this, arguments);
      if (matchedPattern) fetchPromise.then(response => { if (response.ok) response.clone().json().then(data => handleInterceptedData(url, matchedPattern, data, requestBody)); });
      return fetchPromise;
    };
    originalXHR.prototype.open = function(method, url) { this._trackedUrl = url; return originalXhrOpen.apply(this, arguments); };
    originalXHR.prototype.send = function(data) {
        const xhr = this; let processed = false; const originalCallback = xhr.onreadystatechange; let requestBody = null;
        const matchedPattern = matchesAnyInterceptPattern(xhr._trackedUrl);
        if (data && (matchedPattern === API_SELL_PATTERN || matchedPattern === API_BUY_PATTERN)) try { requestBody = JSON.parse(data); } catch(e) {}
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4 && !processed && matchedPattern && xhr.status >= 200 && xhr.status < 300) {
                processed = true;
                try { handleInterceptedData(xhr._trackedUrl, matchedPattern, JSON.parse(xhr.responseText), requestBody); } catch (e) {}
            }
            if (originalCallback) originalCallback.apply(this, arguments);
        };
        return originalXhrSend.apply(this, arguments);
    };
  }
  function handleInterceptedData(url, pattern, responseData, requestData) {
    if (pattern === API_MYSELF_PATTERN) processMyselfData(responseData);
    else if (pattern === API_STORYLET_PATTERN) processStoryletData(responseData);
    else if (pattern === API_CHOOSEBRANCH_PATTERN) processPossessionChangeData(responseData.messages);
    else if (pattern === API_SELL_PATTERN || pattern === API_BUY_PATTERN) processPossessionChangeData(responseData.possessionsChanged);
  }
  function processMyselfData(responseData) {
    const possessions = responseData?.possessions;
    if (!Array.isArray(possessions)) return;
    console.log(`FL Tracker: Processing bulk update from /myself API with ${possessions.length} items.`);
    const possessionsMap = new Map(possessions.map(p => [p.id, p]));
    const trackedIds = getTrackedItemIds();
    let needsDisplayUpdate = false;
    const updateStorageValue = (prefix, key, newValue) => {
        if (GM_getValue(prefix + key, null) != newValue) { GM_setValue(prefix + key, newValue); return true; } return false;
    };
    trackedIds.forEach(id => {
        const prefix = getStorageKeyPrefix(id);
        const apiData = possessionsMap.get(id);
        let updated = false;
        if (apiData) {
            const { level, description, useEventId, name, image } = apiData;
            const tempDiv = document.createElement('div'); tempDiv.innerHTML = description || "";
            const categorySpan = tempDiv.querySelector('span.descriptive');
            const category = categorySpan ? categorySpan.textContent.trim() : '';
            if (categorySpan) categorySpan.remove();
            const cleanDescription = tempDiv.textContent.trim();
            const iconUrl = `https://images.fallenlondon.com/icons/${image}.png`;
            updated = updateStorageValue(prefix, "quantity", level) || updated;
            updated = updateStorageValue(prefix, "name", name) || updated;
            updated = updateStorageValue(prefix, "icon", iconUrl) || updated;
            updated = updateStorageValue(prefix, STORAGE_SUFFIX_CATEGORY, category) || updated;
            updated = updateStorageValue(prefix, "description", cleanDescription) || updated;
            updated = updateStorageValue(prefix, "is_usable", !!useEventId) || updated;
        } else {
            updated = updateStorageValue(prefix, "quantity", "0") || updated;
        }
        if (updated) needsDisplayUpdate = true;
    });
    if (needsDisplayUpdate) { console.log("FL Tracker: Bulk update complete. Refreshing display."); displayTrackedItems(); }
  }
  function processPossessionChangeData(changes) {
      if (!Array.isArray(changes) || changes.length === 0) return;
      const trackedIds = getTrackedItemIds();
      let updated = false;
      changes.forEach(change => {
          const pData = change.possession || change;
          const itemId = parseInt(pData.id, 10);
          if (pData.level !== undefined && trackedIds.includes(itemId)) {
              const newQty = pData.level.toString();
              if (GM_getValue(getStorageKeyPrefix(itemId) + "quantity", null) !== newQty) {
                  GM_setValue(getStorageKeyPrefix(itemId) + "quantity", newQty);
                  updateTrackedItemDisplay(itemId, newQty); updated = true;
              }
          }
      });
      if (updated) console.log("FL Tracker: Sidebar updated via action intercept.");
  }
  function processStoryletData(responseData) {
    if (!responseData?.storylet?.childBranches) return;
    const itemRequirementsByBranch = new Map();
    const branches = responseData.storylet.childBranches;
    branches.forEach(branch => {
        if (!branch.id || !branch.qualityRequirements) return;
        const requiredItems = branch.qualityRequirements
            .filter(req => req.nature === 'Thing' && req.qualityId && req.qualityName)
            .map(req => ({ qualityId: req.qualityId, qualityName: req.qualityName }));
        if (requiredItems.length > 0) itemRequirementsByBranch.set(branch.id, requiredItems);
    });
    if (itemRequirementsByBranch.size > 0) {
        const firstBranchId = [...itemRequirementsByBranch.keys()][0];
        waitForElement(`div[data-branch-id="${firstBranchId}"]`, (element) => {
            if (element) enhanceStoryletPage(itemRequirementsByBranch);
        });
    }
  }
  function useTrackedItem(itemId, buttonElement) {
    const token = findAuthToken(); const tooltipElement = buttonElement?.closest(`.${TOOLTIP_CLASS}`);
    if (!token) { showStatusMessage(tooltipElement, "Error: Auth Token not found.", "error"); return; }
    buttonElement.disabled = true; showStatusMessage(tooltipElement, "Using...", null);
    GM_xmlhttpRequest({
      method: "POST", url: API_USE_URL, headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      data: JSON.stringify({ qualityId: itemId }), responseType: "json",
      onload: (response) => {
        if (response.status >= 200 && response.status < 300) setTimeout(() => { window.location.href = "/"; }, 100);
        else { showStatusMessage(tooltipElement, `Error: ${response.response?.message || `HTTP ${response.status}`}`, "error"); buttonElement.disabled = false; }
      },
      onerror: () => { showStatusMessage(tooltipElement, "Network Error", "error"); buttonElement.disabled = false; },
    });
  }

  // =========================================================================
  // === PAGE-SPECIFIC HANDLING ===
  // =========================================================================
  function enhanceStoryletPage(itemMap) {
    if (itemMap.size === 0) return;
    itemMap.forEach((requiredItems, branchId) => {
        const branchElement = document.querySelector(`div.branch[data-branch-id="${branchId}"]`);
        if (!branchElement) return;
        branchElement.querySelectorAll('.quality-requirement').forEach(iconContainer => {
            const buttonTarget = iconContainer.querySelector('div[role="button"]');
            const ariaLabel = buttonTarget?.getAttribute('aria-label');
            if (!buttonTarget || !ariaLabel || buttonTarget.classList.contains('fl-tracker-enhanced-btn')) return;
            const matchedItem = requiredItems.find(item => ariaLabel.includes(item.qualityName));
            if (matchedItem) {
                iconContainer.dataset.qualityId = matchedItem.qualityId;
                addTrackButtonToElement(buttonTarget, matchedItem.qualityId);
            }
        });
    });
    updateAddButtonStates();
  }
  function enhancePossessionsPage() {
    document.querySelectorAll("li.item .icon[data-quality-id]:not(.fl-tracker-enhanced-btn)").forEach(iconElement => {
        const itemId = parseInt(iconElement.getAttribute("data-quality-id"), 10);
        if (itemId) addTrackButtonToElement(iconElement, itemId);
    });
    updateAddButtonStates();
  }
  function updateAddButtonStates() {
    const trackedIds = getTrackedItemIds();
    document.querySelectorAll(`.${ADD_BUTTON_CLASS}`).forEach(button => {
        const buttonItemId = parseInt(button.dataset.itemId, 10);
        if (buttonItemId) {
            const isTracked = trackedIds.includes(buttonItemId);
            button.textContent = isTracked ? "✓" : "+";
            button.title = isTracked ? "Update target / Untrack" : "Track this item";
            button.classList.toggle("selected", isTracked);
        }
    });
  }
  function setupPossessionsObserver(containerElement) {
    if (possessionsObserver) possessionsObserver.disconnect();
    possessionsObserver = new MutationObserver((mutations) => {
      if (mutations.some(m => m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0))) {
        clearTimeout(enhanceDebounceTimer);
        enhanceDebounceTimer = setTimeout(enhancePossessionsPage, ENHANCE_DEBOUNCE_DELAY);
      }
    });
    possessionsObserver.observe(containerElement, { childList: true, subtree: true });
  }
  function trackItem(itemId) {
    let trackedIds = getTrackedItemIds();
    if (!trackedIds.includes(itemId)) {
      trackedIds.push(itemId);
      setTrackedItemIds(trackedIds);
      const itemElement = document.querySelector(`.icon[data-quality-id="${itemId}"], .quality-requirement[data-quality-id="${itemId}"]`);
      if (itemElement) {
        const itemData = parseItemDataFromElement(itemElement);
        if (itemData) storeItemData(itemData);
      } else { // Fallback if element not found, e.g. tracking from a non-DOM source
        GM_setValue(getStorageKeyPrefix(itemId) + "quantity", "?");
      }
      displayTrackedItems();
      updateAddButtonStates();
    }
  }
  function untrackItem(itemId) {
    let trackedIds = getTrackedItemIds().filter(id => id !== itemId);
    setTrackedItemIds(trackedIds);
    setItemTarget(itemId, null);
    displayTrackedItems();
    updateAddButtonStates();
  }

  // =========================================================================
  // === SPA NAVIGATION & INITIALIZATION ===
  // =========================================================================
  function handlePathChange() {
    const currentPath = window.location.pathname;
    if (possessionsObserver) possessionsObserver.disconnect();
    possessionsObserver = null;
    clearTimeout(enhanceDebounceTimer);
    if (currentPath.includes("/possessions")) {
      waitForElement("div.possessions", (pane) => {
        if (pane && window.location.pathname.includes("/possessions")) {
          enhancePossessionsPage();
          setupPossessionsObserver(pane);
        }
      });
    }
  }
  function setupSpaNavigationListener() {
    const originalPushState = history.pushState;
    history.pushState = function () {
      originalPushState.apply(this, arguments);
      window.dispatchEvent(new Event("locationchange"));
    };
    window.addEventListener("popstate", () => window.dispatchEvent(new Event("locationchange")));
    window.addEventListener("locationchange", handlePathChange);
  }

  // --- Main Execution ---
  console.log("FL Item Tracker Initializing...");
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", displayTrackedItems);
  else displayTrackedItems();
  setupSpaNavigationListener();
  setupRequestInterceptor();
  setTimeout(handlePathChange, 100);
  console.log("FL Item Tracker Initialization complete.");
})();
