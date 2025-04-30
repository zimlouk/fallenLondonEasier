// ==UserScript==
// @name         Fallen London Easier
// @namespace    https://github.com/zimlouk/fallenLondonEasier
// @version      2.3
// @description  Adds helper buttons and automation to Fallen London pages.
// @description:zh-CN 为 Fallen London 页面添加快捷按钮并自动化操作
// @author       xeoplise
// @match        *://www.fallenlondon.com/*
// @icon         https://www.fallenlondon.com/favicon.ico
// @grant        GM_addStyle
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/zimlouk/fallenLondonEasier/main/fallenLondonEasier.user.js
// @updateURL    https://raw.githubusercontent.com/zimlouk/fallenLondonEasier/main/fallenLondonEasier.user.js
// ==/UserScript==

(function () {
  "use strict";

  // --- Global Variables ---
  // Hoist timer IDs and the reference to the currently active stop function
  let checkButton1TimeoutId = null;
  let nextClickTimeoutId = null;
  let findButton2IntervalId = null;
  let stopScriptGlobally = null; // Holds the stop function of the currently running script instance

  // --- Styles ---
  // Add global styles. Use !important to override game styles.
  // z-index: 451 ensures buttons are above the game's bottom navbar (usually z-index 450).
  GM_addStyle(`
        .fl-helper-button-group {
            position: fixed !important;
            left: 10px !important;
            z-index: 451 !important; /* Above nav footer (450) */
            transition: bottom 0.3s ease !important; /* Smooth transition when footer appears/disappears */
            box-sizing: border-box !important; /* Consistent sizing */
        }
        /* Define base bottom positions (though dynamically updated by JS) */
        #fl-helper-add-button          { bottom: 10px; }
        #fl-helper-stop-button         { bottom: 60px; }
        #fl-helper-explanation-note    { bottom: 110px; }
        #fl-helper-explanation-content { bottom: 160px; } /* Positioned relative to Note and Stop */

        /* Basic button styling (Consider moving more inline styles here) */
        .fl-helper-button {
            padding: 8px 12px;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            text-align: center;
        }
        .fl-helper-button:disabled {
            cursor: not-allowed;
            opacity: 0.65;
        }
    `);

  // --- Dynamic Positioning Logic ---

  /**
   * Checks if an element is currently visible in the DOM.
   * @param {HTMLElement} el - The element to check.
   * @returns {boolean} True if the element is visible, false otherwise.
   */
  function isElementVisible(el) {
    // Check offset dimensions or client rects
    return (
      el && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0)
    );
  }

  /**
   * Adjusts the vertical position of all helper buttons based on the visibility
   * and height of the mobile footer navigation bar (`nav.footer-xs`).
   */
  function adjustButtonPosition() {
    const navFooter = document.querySelector("nav.footer-xs");
    const buttons = document.querySelectorAll(".fl-helper-button-group");
    // Calculate the offset needed (height of the footer if visible, otherwise 0)
    const offset = navFooter && isElementVisible(navFooter) ? navFooter.offsetHeight : 0;

    buttons.forEach((btn) => {
      // Read the original base position stored in the dataset
      const originalBottom = parseInt(btn.dataset.originalBottom || "0", 10);
      // Apply the new bottom position including the offset
      btn.style.bottom = `${originalBottom + offset}px`;
    });
  }

  /**
   * Sets up observers to monitor changes that might require button repositioning.
   * This includes DOM changes, footer visibility changes, and window resizing.
   */
  function startObserving() {
    // 1. Observe general DOM changes (e.g., footer added/removed)
    // Use subtree: true cautiously, might impact performance on complex pages, but necessary for footer detection.
    const mutationObserver = new MutationObserver(() => adjustButtonPosition());
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    // 2. Observe the visibility of the specific footer element (more efficient)
    const navFooter = document.querySelector("nav.footer-xs");
    if (navFooter) {
      const intersectionObserver = new IntersectionObserver((entries) => {
        // Adjust whenever the intersection status changes
        adjustButtonPosition();
      });
      intersectionObserver.observe(navFooter);
    } else {
        console.warn("FL Helper: Mobile footer 'nav.footer-xs' not found for IntersectionObserver.");
    }

    // 3. Observe window resize events
    // Debouncing could be added here if resize events cause performance issues.
    window.addEventListener("resize", adjustButtonPosition);
  }


  // --- UI Element Creation Functions ---

  /**
   * Creates and adds the main "Add Execution Button" button to the page.
   * This button triggers the `addScriptButtons` function.
   */
  function addMainToggleButton() {
    const toggleButton = document.createElement("button");
    toggleButton.id = "fl-helper-add-button";
    toggleButton.textContent = "Add Execution Button";
    toggleButton.className = "fl-helper-button-group fl-helper-button"; // Apply common classes
    // Specific styles
    toggleButton.style.backgroundColor = "#007bff"; // Blue

    document.body.appendChild(toggleButton);

    toggleButton.addEventListener("click", function () {
      addScriptButtons(); // Add the "Start Loop" buttons next to game actions
      toggleButton.textContent = "Added";
      toggleButton.disabled = true;
      setTimeout(() => {
        toggleButton.textContent = "Add Execution Button";
        toggleButton.disabled = false;
      }, 2000); // Re-enable after 2 seconds
    });

    // Store its base position for dynamic adjustment
    toggleButton.dataset.originalBottom = "10";
    toggleButton.style.bottom = `${toggleButton.dataset.originalBottom}px`; // Set initial position
  }

  /**
   * Creates and adds the "Note!" button and its associated hover explanation box.
   */
  function addExplanationBox() {
    // Create the "Note!" button element
    const explanationBox = document.createElement("div"); // Use div for non-clickable note
    explanationBox.id = "fl-helper-explanation-note";
    explanationBox.textContent = "Notice";
    explanationBox.className = "fl-helper-button-group"; // For positioning
    explanationBox.style.padding = "8px 12px";
    explanationBox.style.color = "white";
    explanationBox.style.border = "none";
    explanationBox.style.borderRadius = "4px";
    explanationBox.style.cursor = "default";
    explanationBox.style.fontSize = "12px";
    explanationBox.style.backgroundColor = "#5a6268"; // Darker grey (removed redundant background set)
    explanationBox.style.display = "block";

    document.body.appendChild(explanationBox);

    // Store its base position for dynamic adjustment
    explanationBox.dataset.originalBottom = "110";
    explanationBox.style.bottom = `${explanationBox.dataset.originalBottom}px`; // Set initial position

    // Create the explanation content box (shown on hover)
    const explanationContent = document.createElement("div");
    explanationContent.id = "fl-helper-explanation-content";
    explanationContent.textContent =
      "See the action (Go button) → Click 'Add Execution Button' to add 'Start Loop' buttons → Click the new 'Start Loop' button to begin auto-loop (Go → Try Again → ...). (Note: Only supports the simple Go → Try Again → Go loop)";
    explanationContent.className = "fl-helper-button-group"; // For positioning
    explanationContent.style.maxWidth = "250px";
    explanationContent.style.whiteSpace = "pre-line"; // Allow line breaks
    explanationContent.style.zIndex = 10001; // Ensure it's above the "Note!" button
    explanationContent.style.padding = "8px 12px";
    explanationContent.style.backgroundColor = "#6c757d"; // Grey
    explanationContent.style.color = "white";
    explanationContent.style.border = "none";
    explanationContent.style.borderRadius = "4px";
    explanationContent.style.cursor = "default";
    explanationContent.style.fontSize = "14px";
    explanationContent.style.display = "none"; // Hidden by default

    document.body.appendChild(explanationContent);

    // --- Calculate and Set Hover Box Position ---
    const noteButtonOriginalBottom = parseInt(explanationBox.dataset.originalBottom, 10); // 110

    // Try to get the stop button's position to calculate the gap
    const stopButton = document.getElementById("fl-helper-stop-button");
    let contentOriginalBottom;
    const defaultGap = 50; // Default spacing if calculation fails

    if (stopButton && stopButton.dataset.originalBottom) {
         const stopButtonOriginalBottom = parseInt(stopButton.dataset.originalBottom, 10); // 60
         // Calculate the gap between stop and note buttons
         const targetGap = noteButtonOriginalBottom - stopButtonOriginalBottom; // e.g., 110 - 60 = 50
         // Position the hover box the same gap above the note button
         contentOriginalBottom = noteButtonOriginalBottom + targetGap; // e.g., 110 + 50 = 160
         // console.log(`FL Helper Debug: Calculated hover explanation bottom: ${noteButtonOriginalBottom} + ${targetGap} = ${contentOriginalBottom}`);
    } else {
        // Fallback if stop button data isn't available (shouldn't normally happen)
        console.warn("FL Helper: Stop button data not ready for precise hover box spacing. Using fallback.");
        contentOriginalBottom = noteButtonOriginalBottom + defaultGap; // Fallback to 110 + 50 = 160
    }

    // Store its base position for dynamic adjustment
    explanationContent.dataset.originalBottom = contentOriginalBottom.toString(); // "160"
    explanationContent.style.bottom = `${explanationContent.dataset.originalBottom}px`; // Set initial position

    // --- Hover Listeners ---
    explanationBox.addEventListener("mouseover", function () {
      explanationContent.style.display = "block"; // Show hover box
    });

    explanationBox.addEventListener("mouseout", function () {
      explanationContent.style.display = "none"; // Hide hover box
    });
  }

  /**
   * Creates and adds the global "Stop Running Script" button.
   */
  function addStopAllButton() {
    const stopButton = document.createElement("button");
    stopButton.id = "fl-helper-stop-button";
    stopButton.textContent = "Stop Running Script";
    stopButton.className = "fl-helper-button-group fl-helper-button"; // Apply common classes
    // Specific styles
    stopButton.style.backgroundColor = "#dc3545"; // Red
    stopButton.disabled = true; // Initially disabled

    document.body.appendChild(stopButton);

    // Hover effects
    stopButton.addEventListener("mouseover", function () {
        if (!this.disabled) this.style.backgroundColor = "#c82333"; // Darker red
    });
    stopButton.addEventListener("mouseout", function () {
        if (!this.disabled) this.style.backgroundColor = "#dc3545"; // Original red
    });

    // Click handler
    stopButton.addEventListener("click", function () {
      if (typeof stopScriptGlobally === "function") {
        console.log("Global stop button clicked, attempting to stop script...");
        stopScriptGlobally(); // Call the active stop function
        stopButton.textContent = "Stopped";
        stopButton.disabled = true; // Disable after stopping
        setTimeout(() => {
          stopButton.textContent = "Stop Running Script";
          // Keep disabled until a new script starts
        }, 1500);
      } else {
        console.log("Global stop button clicked, but no script is currently running.");
        alert("No script is currently running.");
      }
    });

    // Store its base position for dynamic adjustment
    stopButton.dataset.originalBottom = "60";
    stopButton.style.bottom = `${stopButton.dataset.originalBottom}px`; // Set initial position
  }

  /**
   * Finds relevant game buttons ("Go" buttons) and adds a "Start Loop"
   * button next to each one.
   */
  function addScriptButtons() {
    // Selector for the game's primary action buttons we want to target
    const targetButtonSelector = ".js-tt.button.button--primary.button--margin.button--go";
    const allTargetButtons = document.querySelectorAll(targetButtonSelector);
    const helperButtonClass = "fl-helper-script-button"; // Class for our generated buttons

    // CSS styles for the "Start Loop" button, designed to mimic game style
    const scriptButtonStyle = `
        appearance: auto !important;
        background-color: rgb(66, 104, 107) !important; /* Teal color */
        border: 0.8px solid rgb(45, 82, 86) !important;
        box-shadow: rgba(0, 0, 0, 0.5) 0px 1px 2px 0px !important;
        box-sizing: border-box !important;
        color: rgb(185, 225, 228) !important;
        cursor: pointer !important;
        display: block !important;
        font-family: "Roboto Slab", Georgia, Times, serif !important;
        font-size: 13px !important;
        font-weight: 700 !important;
        letter-spacing: 0.65px !important;
        margin: 0 0 0 4px !important; /* Margin to space it from the original button */
        padding: 10px 20px !important;
        text-align: center !important;
        text-transform: uppercase !important;
        user-select: none !important;
        vertical-align: middle !important;
        width: auto !important;
        position: relative !important;
        height: 38.4px !important; /* Match game button height */
        line-height: normal !important;
        text-shadow: none !important;
    `;

    allTargetButtons.forEach(function (targetButton) {
      // Prevent adding multiple buttons to the same target
      if (
        targetButton.previousElementSibling &&
        targetButton.previousElementSibling.classList.contains(helperButtonClass)
      ) {
        return; // Skip if already added
      }

      // Avoid adding a button next to our *own* helper buttons if the selector accidentally matches
      if (targetButton.classList.contains(helperButtonClass)) {
        return;
      }

      // Create the "Start Loop" button
      const scriptButton = document.createElement("button");
      scriptButton.className = `js-tt button button--primary button--margin button--go ${helperButtonClass}`; // Mimic game classes + add our own
      scriptButton.type = "button";
      scriptButton.innerHTML = "<span>Start Loop</span>"; // Match game button structure
      scriptButton.style.cssText = scriptButtonStyle; // Apply the defined styles

      // Add hover/interaction effects (similar to game buttons)
      scriptButton.addEventListener("mouseover", function () {
        this.style.backgroundColor = "rgb(82, 128, 132)"; // Lighter teal
        this.style.borderColor = "rgb(63, 114, 119)";
      });
      scriptButton.addEventListener("mouseout", function () {
        this.style.backgroundColor = "rgb(66, 104, 107)"; // Original teal
        this.style.borderColor = "rgb(45, 82, 86)";
      });
      scriptButton.addEventListener("mousedown", function () {
        this.style.backgroundColor = "rgb(57, 89, 91)"; // Darker teal
        this.style.boxShadow = "inset 0 2px 4px rgb(57, 89, 91)";
      });
      scriptButton.addEventListener("mouseup", function () {
        this.style.boxShadow = "rgba(0, 0, 0, 0.5) 0px 1px 2px 0px"; // Restore shadow
      });

      // Insert the "Start Loop" button *before* the original "Go" button
      targetButton.parentNode.insertBefore(scriptButton, targetButton);

      // Add click listener to start the automation
      scriptButton.addEventListener("click", function () {
        // If another loop is already running, stop it first
        if (typeof stopScriptGlobally === "function") {
          console.log("FL Helper: Detected running script instance. Stopping it before starting new one.");
          stopScriptGlobally();
        }
        // Start the automation sequence, passing the original "Go" button it's associated with
        startScript(targetButton);
      });
    });
  }

  /**
   * Updates the enabled/disabled state and text of the global stop button.
   * Exposed on `window` so it can be called from within the `startScript` scope.
   * @param {boolean} isRunning - True if a script is currently running, false otherwise.
   */
  window.updateFlHelperStopButtonState = function (isRunning) {
    const btn = document.getElementById("fl-helper-stop-button");
    if (btn) {
      btn.disabled = !isRunning;
      // If stopping, reset text after a short delay (but keep disabled if stopped)
      if (!isRunning && btn.textContent === "Stopped") {
        setTimeout(() => {
          btn.textContent = "Stop Running Script";
        }, 1500);
      }
      // Ensure correct background color based on new disabled state
      btn.style.backgroundColor = btn.disabled ? "#dc3545" : "#dc3545"; // Keep red, rely on opacity/cursor for disabled look
    }
  };

  // --- Core Automation Logic ---

  /**
   * Starts the main automation loop (Click Button1 -> Wait/Check -> Click Button2 -> Wait -> Repeat).
   * @param {HTMLElement} initialButton1 - The specific "Go" button element that was clicked next to "Start Loop".
   */
  function startScript(initialButton1) {
    console.log("FL Helper: Starting script...");

    // --- Configuration & Timeouts (Constants) ---
    const CLICK_DELAY_AFTER_B1 = 750;        // ms to wait after clicking Button1 before looking for Button2/results
    const FIND_B2_INTERVAL = 500;           // ms interval for checking if Button2 appeared
    const FIND_B2_MAX_ATTEMPTS = 20;        // Max checks for Button2 (FIND_B2_INTERVAL * this = timeout)
    const DELAY_BEFORE_WAITING_FOR_B1 = 500; // ms to wait after clicking Button2 before starting to look for Button1
    const WAIT_B1_INITIAL_DELAY = 2000;     // ms initial delay before first check for Button1
    const WAIT_B1_RETRY_DELAY = 3000;       // ms delay between checks if Button1 is not found/ready
    const WAIT_B1_TIMEOUT = 3000;          // ms total time to wait for Button1 before giving up
    const CLICK_DELAY_BEFORE_NEXT_CYCLE = 1000; // ms delay before starting the next cycle (after Button1 is found)

    // --- User Input ---
    const userInputClicks = prompt(
      "Enter the maximum number of cycles to run:",
      "10"
    );
    const maxClicks = parseInt(userInputClicks, 10);
    if (isNaN(maxClicks) || maxClicks <= 0) {
      alert("Invalid number of cycles entered. Script terminated.");
      console.error("FL Helper: Invalid maxClicks input.");
      return; // Stop script execution
    }

    const userInputQuality = prompt(
      "Enter the target quality value to stop at (or leave blank/non-number to ignore):",
      "" // Default to blank, implying ignore unless specified
    );
    let targetQualityValue = parseInt(userInputQuality, 10);
    let checkQuality = !isNaN(targetQualityValue); // Only check quality if input was a valid number

    if (!checkQuality && userInputQuality.trim() !== "") {
        console.log("FL Helper: Non-numeric quality target entered. Quality check will be ignored.");
    } else if (checkQuality) {
        console.log(`FL Helper: Target quality value set to ${targetQualityValue}.`);
    } else {
        console.log("FL Helper: No target quality value set. Script will run for max clicks.");
    }
    // Optional: Warning for non-positive values if quality check is enabled
    if (checkQuality && targetQualityValue <= 0 && userInputQuality.trim() !== "0") {
      console.warn(
        `FL Helper: Target quality value (${targetQualityValue}) is not positive. Please confirm this is intended.`
      );
    }

    // --- Get Stable Parent Identifier (Crucial for Reliability) ---
    // Find the closest ancestor element with a 'data-branch-id' attribute.
    // This ID usually remains stable even if the button itself is replaced during DOM updates.
    const parentElementWithId = initialButton1.closest("[data-branch-id]");
    let parentBranchId = null;
    let button1Selector = null; // The CSS selector to re-find Button1 later

    if (parentElementWithId) {
      parentBranchId = parentElementWithId.dataset.branchId;
      // Construct a specific selector to find Button1 within its stable parent
      // Assumes the button classes remain consistent
      button1Selector = `[data-branch-id="${parentBranchId}"] .js-tt.button.button--primary.button--margin.button--go`;
      console.log(
        `FL Helper: Script targeting Button1 within parent data-branch-id="${parentBranchId}" (Selector: "${button1Selector}")`
      );
    } else {
      // If no stable parent ID is found, we cannot reliably re-find Button1 after clicks.
      alert(
        "Error: Could not find a parent element with 'data-branch-id' for the target button. Script cannot reliably proceed and has been terminated."
      );
      console.error(
        "FL Helper Error: Could not find parent with data-branch-id for initial Button1."
      );
      if (window.updateFlHelperStopButtonState) window.updateFlHelperStopButtonState(false); // Update stop button state
      return; // Stop execution
    }

    console.log(`FL Helper: Running for max ${maxClicks} cycles. ${checkQuality ? `Stopping if quality reaches ${targetQualityValue}.` : ''}`);

    // --- State Variables ---
    let clickCount = 0;
    let scriptRunning = true;

    // --- Setup ---
    if (window.updateFlHelperStopButtonState) window.updateFlHelperStopButtonState(true); // Enable global stop button
    clearAllTimers(); // Clear any timers from previous runs

    // --- Nested Helper Functions (within startScript scope) ---

    /** Finds the "Try again" button (Button 2). */
    function findButton2() {
        // Select potential candidates more broadly first
        const candidateButtons = document.querySelectorAll(".button.button--primary");
        let button2 = null;
        const targetText = "try again"; // Text to look for (case-insensitive)

        candidateButtons.forEach(button => {
            // Check text content, converting to lowercase for case-insensitive comparison
            if (button.textContent.toLowerCase().includes(targetText)) {
                button2 = button;
                // Optional: Could add checks for specific classes if "Try again" appears elsewhere
            }
        });
        return button2; // Return the found button or null
    }

    /** Checks if the target quality value has been reached after an action. */
    function checkQualityValue() {
        // Only proceed if quality checking is enabled
        if (!checkQuality || !scriptRunning) {
            return false;
        }

        // Find all quality update sections on the page
        const updateBodies = document.querySelectorAll(".quality-update__body");
        if (updateBodies.length === 0) {
            console.log(" -> No quality update elements found (.quality-update__body), skipping quality check.");
            return false; // No updates found
        }

        console.log(` -> Found ${updateBodies.length} quality update elements. Checking final values...`);
        let targetMet = false;

        updateBodies.forEach((body) => {
            if (targetMet) return; // Stop checking if target already found in a previous update body

            // Try to get the quality name for logging (optional)
            const qualityNameSpan = body.querySelector(".quality-name");
            const qualityName = qualityNameSpan ? qualityNameSpan.textContent.trim() : "Unknown Quality";

            // The most reliable way to get the *new* value is often the *last* element
            // showing the current progress/value within the progress bar structure.
            const lastProgressCurrent = body.querySelector(".progress .progress__current:last-of-type");

            if (lastProgressCurrent) {
                const currentValueText = lastProgressCurrent.textContent.trim();
                const currentValue = parseInt(currentValueText, 10);
                console.log(`  --> Checking ${qualityName}: Found final value element, text="${currentValueText}"`);

                if (!isNaN(currentValue) && currentValue === targetQualityValue) {
                    // Parsed successfully and matches the target
                    alert(`Target quality ${qualityName} reached value ${targetQualityValue}! Script terminating.`);
                    console.log(`  --> Target quality ${targetQualityValue} MET for ${qualityName}. Stopping script.`);
                    targetMet = true;
                    stopScript(); // Stop the entire script
                } else if (isNaN(currentValue)) {
                    // Failed to parse the value
                    console.warn(`  --> Could not parse numeric value from "${currentValueText}" for ${qualityName}.`);
                } else {
                    // Parsed, but doesn't match target
                    console.log(`  --> Current value ${currentValue} does not match target ${targetQualityValue} for ${qualityName}.`);
                }
            } else {
                // Couldn't find the expected element structure for the value
                console.log(`  --> Could not find '.progress .progress__current:last-of-type' element within this update body for ${qualityName}.`);
            }
        });

        return targetMet; // Return true if target was met in any update body
    }

    // --- Core Cycle Functions (Nested) ---

    /** Step 1: Clicks Button 1 and schedules the next step. */
    function clickButton1AndInitiateNextStep(buttonToClick) {
        if (!scriptRunning) return;
        console.log(`--- Cycle ${clickCount + 1} / ${maxClicks} ---`);

        const logId = `Parent Branch ID: ${parentBranchId}`; // For consistent logging

        // Double-check the button still exists and is clickable
        if (document.body.contains(buttonToClick) && !buttonToClick.disabled) {
            console.log(`[Step 1] Clicking Button1 (Target: ${logId})`);
            buttonToClick.click();
            // Clear any lingering timer and schedule the check for Button2/results
            clearTimeout(nextClickTimeoutId);
            nextClickTimeoutId = setTimeout(
                findAndCheckQualityBeforeClickButton2, // Next step function
                CLICK_DELAY_AFTER_B1                  // Wait a bit for results/Button2 to appear
            );
        } else if (document.body.contains(buttonToClick) && buttonToClick.disabled) {
            // Button exists but is disabled
            alert(`Error: Button1 (Target: ${logId}) is disabled. Script terminated.`);
            console.error(`[Error] Button1 (Target: ${logId}) found but is disabled.`);
            stopScript();
        } else {
            // Button disappeared
            alert(`Error: Button1 (Target: ${logId}) has disappeared from the page. Script terminated.`);
            console.error(`[Error] Button1 (Target: ${logId}) not found in DOM.`);
            stopScript();
        }
    }

    /** Step 2: Waits for Button 2 ("Try again"), checks quality, and clicks Button 2 if applicable. */
    function findAndCheckQualityBeforeClickButton2() {
        if (!scriptRunning) return;
        console.log("[Step 2] Looking for results and/or Button2 ('Try again')...");

        let findButton2Attempts = 0;

        // Clear previous interval timer if any exists
        clearInterval(findButton2IntervalId);
        findButton2IntervalId = null; // Explicitly nullify

        findButton2IntervalId = setInterval(function () {
            if (!scriptRunning) {
                clearInterval(findButton2IntervalId);
                findButton2IntervalId = null;
                return;
            }

            // First, check if the quality goal has been met by the last action
            if (checkQualityValue()) {
                // Quality check found the target and called stopScript(), interval will be cleared by stopScript
                console.log("[Step 2a] Target quality met. Script stopped.");
                // No need to clear interval here, stopScript handles it.
                return;
            }

            // If quality target not met (or not checked), look for Button 2
            const button2 = findButton2();
            if (button2) {
                // Found Button 2
                clearInterval(findButton2IntervalId); // Stop searching
                findButton2IntervalId = null;
                console.log("[Step 2b] Found Button2 ('Try again'). Clicking it.");
                button2.click();

                // Schedule the next step: wait for Button 1 to reappear/become active
                clearTimeout(nextClickTimeoutId); // Clear any previous timer
                nextClickTimeoutId = setTimeout(
                    waitForButton1,                 // Next step function
                    DELAY_BEFORE_WAITING_FOR_B1     // Wait a short time before starting the wait
                );
            } else {
                // Button 2 not found yet, increment attempt counter
                findButton2Attempts++;
                console.log(` -> Waiting for Button2... (Attempt ${findButton2Attempts}/${FIND_B2_MAX_ATTEMPTS})`);

                // Check if we've exceeded the maximum attempts
                if (findButton2Attempts >= FIND_B2_MAX_ATTEMPTS) {
                    clearInterval(findButton2IntervalId); // Stop searching
                    findButton2IntervalId = null;
                    alert("Error: Timed out waiting for Button2 ('Try again'). Script terminated.");
                    console.error("[Error] Timeout waiting for Button2.");
                    stopScript(); // Stop the script due to timeout
                }
            }
        }, FIND_B2_INTERVAL); // Check every interval
    }

    /** Step 3: Waits for Button 1 to reappear and become clickable using the specific selector. */
    function waitForButton1() {
        if (!scriptRunning) return;
        console.log(`[Step 3] Waiting for Button1 to be ready (Selector: "${button1Selector}")`);

        clearTimeout(checkButton1TimeoutId); // Clear previous check timer

        const startTime = Date.now();
        const logId = `Parent Branch ID: ${parentBranchId}`; // For logging

        function checkButton1Status() {
            if (!scriptRunning) return;

            const elapsedTime = Date.now() - startTime;

            // Check for overall timeout
            if (elapsedTime > WAIT_B1_TIMEOUT) {
                alert(
                    `Error: Timed out waiting for Button1 (Target: ${logId}) to become ready (${WAIT_B1_TIMEOUT / 1000}s). Script terminated.`
                );
                console.error(`[Error] Timeout waiting for Button1 (${logId}).`);
                stopScript();
                return;
            }

            // Query the DOM using the specific selector derived earlier
            // console.log(` -> Checking selector "${button1Selector}"...`); // Verbose logging if needed
            const currentButton1 = document.querySelector(button1Selector);

            if (currentButton1) {
                // Button found, check if it's enabled
                if (!currentButton1.disabled) {
                    // --- Button1 Found and Ready ---
                    console.log(`[Step 3a] Button1 (Target: ${logId}) found and ready (took ${elapsedTime}ms).`);
                    clickCount++;

                    // Check if max clicks reached
                    if (clickCount >= maxClicks) {
                        console.log(`[Step 4] Maximum cycle count (${maxClicks}) reached. Script finished.`);
                        alert(`Finished Execution after ${clickCount} cycles.`);
                        stopScript();
                    } else {
                        // Prepare for the next cycle
                        console.log(`[Step 4] Preparing for next cycle (${clickCount + 1}/${maxClicks}).`);
                        clearTimeout(nextClickTimeoutId);
                        // Schedule the *next* click on the *newly found* Button1 element
                        nextClickTimeoutId = setTimeout(
                            () => clickButton1AndInitiateNextStep(currentButton1), // Pass the found button
                            CLICK_DELAY_BEFORE_NEXT_CYCLE                          // Wait a bit before clicking again
                        );
                    }
                    // --- End Button1 Found Logic ---
                } else {
                    // Button found but still disabled, wait and retry
                    console.log(` -> Button1 (Target: ${logId}) found but is disabled. Retrying in ${WAIT_B1_RETRY_DELAY / 1000}s...`);
                    checkButton1TimeoutId = setTimeout(checkButton1Status, WAIT_B1_RETRY_DELAY);
                }
            } else {
                // Button not found yet, wait and retry
                console.log(` -> Button1 (Selector: "${button1Selector}") not found. Retrying in ${WAIT_B1_RETRY_DELAY / 1000}s...`);
                checkButton1TimeoutId = setTimeout(checkButton1Status, WAIT_B1_RETRY_DELAY);
            }
        }

        // Start the first check after an initial delay
        checkButton1TimeoutId = setTimeout(checkButton1Status, WAIT_B1_INITIAL_DELAY);
    }

    // --- Stop Function & Timer Cleanup (Nested) ---

    /** Stops the script execution and cleans up timers. */
    function stopScript() {
      // Prevent multiple stops
      if (!scriptRunning) return;
      console.log("%cFL Helper: Stopping script...", "color: red; font-weight: bold;");
      scriptRunning = false;

      // Clear all known timers associated with this script instance
      clearAllTimers();

      // Best-effort attempt to clear any other potentially lingering timers.
      // This is a bit aggressive but can help in complex async scenarios.
      try {
        const highIntervalId = setTimeout(() => {}, 30000); // Get a high timer ID
        // console.log(`FL Helper: Attempting to clear timers up to ID ${highIntervalId}`);
        for (let i = 1; i <= highIntervalId; i++) {
          clearTimeout(i);
          clearInterval(i);
        }
      } catch (e) {
          console.warn("FL Helper: Error during aggressive timer cleanup (ignore if benign)", e);
      }

      // Reset the global stop function reference
      stopScriptGlobally = null;
      // Update the global stop button state
      if (window.updateFlHelperStopButtonState) window.updateFlHelperStopButtonState(false);
      console.log("FL Helper: Script stopped.");
    }

    /** Utility to clear all known timers for this script instance. */
    function clearAllTimers() {
      // console.log("FL Helper: Clearing script timers..."); // Verbose if needed
      clearTimeout(checkButton1TimeoutId);
      checkButton1TimeoutId = null;
      clearTimeout(nextClickTimeoutId);
      nextClickTimeoutId = null;
      clearInterval(findButton2IntervalId);
      findButton2IntervalId = null;
    }

    // --- Initialization within startScript ---

    // Assign the nested stop function to the global variable so the stop button can call it
    stopScriptGlobally = stopScript;

    // Initial sanity check: Ensure the button passed in is still valid *before* we rely on it
    if (!initialButton1 || !document.body.contains(initialButton1)) {
      alert("Error: The initial target button disappeared before the script could start. Script terminated.");
      console.error("FL Helper Error: Initial Button1 not found in DOM at script start.");
      stopScript(); // Ensure cleanup and button state update
      return;
    }
    if (initialButton1.disabled) {
      alert("Error: The initial target button is disabled at script start. Script terminated.");
      console.error("FL Helper Error: Initial Button1 is disabled at script start.");
      stopScript(); // Ensure cleanup and button state update
      return;
    }
    // Note: The crucial check for the parent `data-branch-id` happens *after* these checks, further up.

    // --- Start the First Cycle ---
    // Kick off the process by clicking the initial button passed to the function
    clickButton1AndInitiateNextStep(initialButton1);

  } // End of startScript function


  // --- Initial Script Execution ---
  // This runs when the userscript loads on a matching page.

  console.log("FL Helper: Initializing (v2.3)...");

  // Create and add the fixed UI elements
  addMainToggleButton();
  addExplanationBox();
  addStopAllButton();

  // Wait a short moment for the page to potentially finish rendering
  // before performing initial position adjustments and starting observers.
  setTimeout(() => {
    console.log("FL Helper: Performing initial button positioning and starting observers.");
    adjustButtonPosition(); // Set initial positions correctly based on footer (if present)
    startObserving();       // Start watching for changes
    // Set initial state of the stop button (disabled)
    if (window.updateFlHelperStopButtonState) {
        window.updateFlHelperStopButtonState(false);
    }
  }, 1000); // 1-second delay

  console.log("FL Helper: Initialization complete. Use 'Add Execution Button' then 'Start Loop'.");

})(); // End of userscript IIFE
