// ==UserScript==
// @name         Fallen London Card Automator
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Automates playing or discarding opportunity cards based on a loaded JSON configuration file.
// @author       Xeo (with modifications)
// @downloadURL  https://raw.githubusercontent.com/zimlouk/fallenLondonEasier/main/fallenLondonCardAutomator.user.js
// @updateURL    https://raw.githubusercontent.com/zimlouk/fallenLondonEasier/main/fallenLondonCardAutomator.user.js
// @match        https://www.fallenlondon.com/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// ==/UserScript==

(function () {
    'use strict';

    // --- Script Constants ---
    const POLLING_INTERVAL = 300; // ms
    const ELEMENT_TIMEOUT = 15000; // ms
    const DECK_DRAW_DELAY = 2500; // ms, wait after drawing a card
    const ACTION_TRANSITION_DELAY = 2500; // ms, wait after clicking a branch

    // --- State Variables ---
    let isPlaying = false;
    let scriptConfig = {}; // Will be populated by the loaded JSON file
    let statusDiv;
    let playButton, loadButton, fileInput;


    // --- Reusable Helper Functions ---

    function getOriginalTextContent(element) {
        if (!element) return "";
        const clone = element.cloneNode(true);
        const translationWrappers = clone.querySelectorAll('font.immersive-translate-target-wrapper, .immersive-translate-target-wrapper, font.notranslate');
        translationWrappers.forEach(wrapper => wrapper.remove());
        return clone.textContent.trim().replace(/\s*(\u00A0\u00A0| {2,}).*/, '').trim();
    }

    function getButtonText(buttonEl) {
        if (!buttonEl) return "";
        const spanInsideButton = buttonEl.querySelector('span:not([class*="buttonlet"]):not([class*="fa-"])');
        if (spanInsideButton) {
            const spanText = getOriginalTextContent(spanInsideButton);
            if (spanText) return spanText.replace(/\s*\(\d+\)$/, '').trim();
        }
        return getOriginalTextContent(buttonEl).replace(/\s*\(\d+\)$/, '').trim();
    }

    function isElementVisible(el) {
        if (!el || !document.body.contains(el)) return false;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) < 0.1) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1;
    }

    function forceClick(element) {
        if (!element) return;
        const eventSequence = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
        eventSequence.forEach(eventType => {
            element.dispatchEvent(new MouseEvent(eventType, { view: unsafeWindow, bubbles: true, cancelable: true }));
        });
    }

    async function waitUntil(conditionFn, timeout, pollInterval) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout && isPlaying) {
            const result = conditionFn();
            if (result) return result; // Return the truthy value (the element)
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
        return null;
    }

    async function waitUntilElementIsReady(identifier) {
        const type_desc = identifier.type === 'storylet_exit_button' ? 'exit button' : 'branch';
        updateStatus(`Waiting for ${type_desc}: ${identifier.buttonText || identifier.titleHint}...`);

        const element = await waitUntil(() => findElement(identifier), ELEMENT_TIMEOUT, POLLING_INTERVAL);

        if (!element) {
            updateStatus(`Error: Timed out waiting for element.`);
            console.error("Timed out waiting for:", identifier);
        }
        return element;
    }

    // --- Core Logic Functions ---

    function findElement(identifier) {
        if (!identifier || !identifier.type) return null;
        
        switch (identifier.type) {
            case "titled_block_button":
                const matchingHeadings = Array.from(document.querySelectorAll("h1, h2, .storylet-root__heading, .storylet__heading"))
                    .filter(h => getOriginalTextContent(h).includes(identifier.titleHint) && isElementVisible(h));

                for (const heading of matchingHeadings) {
                    const container = heading.closest('.storylet, .media--root, .branch');
                    if (container) {
                        const button = Array.from(container.querySelectorAll('button, [role="button"]'))
                            .find(btn => getButtonText(btn) === identifier.buttonText && isElementVisible(btn));
                        if (button) return button;
                    }
                }
                break;
            
            case "storylet_exit_button":
                const exitContainer = document.querySelector(".buttons--storylet-exit-options");
                if (exitContainer) {
                    return Array.from(exitContainer.querySelectorAll("button"))
                                .find(btn => getButtonText(btn) === identifier.buttonText && isElementVisible(btn));
                }
                break;
        }
        return null;
    }

    // *** REPLACED WITH THE USER-PROVIDED WORKING FUNCTION ***
    async function executeChangeOutfit(action) {
        updateStatus(`Executing: Change outfit to ${action.outfitName}`);

        // Step 1: Find and click the dropdown
        const titleSpan = Array.from(
          document.querySelectorAll(".outfit-selector__title")
        ).find(isElementVisible);
        const container = titleSpan?.closest('div[style*="margin-right"]');
        const dropdownTrigger =
          container?.querySelector(".css-88n967-control") ||
          container?.querySelector('[class*="-control"]');

        if (!dropdownTrigger) {
          console.error(
            "executeChangeOutfit: Dropdown trigger could not be found."
          );
          updateStatus("Error: Could not find outfit dropdown trigger.");
          return false;
        }
        forceClick(dropdownTrigger);
        await new Promise((resolve) => setTimeout(resolve, 300)); // Wait for menu to appear

        // Step 2: Find and click the option
        let optionElement = null;
        const menuStartTime = Date.now();
        while (Date.now() - menuStartTime < ELEMENT_TIMEOUT && isPlaying) {
          const options = Array.from(
            document.querySelectorAll('[class*="-option"]')
          );
          optionElement = options.find(
            (opt) =>
              getOriginalTextContent(opt) === action.outfitName &&
              isElementVisible(opt)
          );
          if (optionElement) break;
          await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL));
        }

        if (!optionElement) {
          updateStatus(`Error: Outfit option '${action.outfitName}' not found.`);
          if (isElementVisible(dropdownTrigger)) forceClick(dropdownTrigger); // Try to close
          return false;
        }

        forceClick(optionElement);
        await new Promise(r => setTimeout(r, 1000)); // Wait for outfit to apply
        return true; // Success
    }


    // --- Main Automation Loop ---

    async function mainLoop() {
        while (isPlaying) {
            try {
                // Check if we are on the main 'story' tab with cards
                const handContainer = document.querySelector('.hand');
                if (!handContainer || !isElementVisible(handContainer)) {
                    updateStatus("Not on story tab. Waiting...");
                    await new Promise(r => setTimeout(r, 5000));
                    continue;
                }

                const cards = document.querySelectorAll('.hand__card-container[data-event-id]');
                let cardToProcess = null;
                let actionConfig = null;

                for (const card of cards) {
                    const eventId = card.dataset.eventId;
                    if (scriptConfig[eventId]) {
                        cardToProcess = card;
                        actionConfig = scriptConfig[eventId];
                        break;
                    }
                }

                if (cardToProcess && actionConfig) {
                    // Normalize action to lowercase to avoid config errors
                    const action = (actionConfig.action || '').toLowerCase();

                    if (action === 'play') {
                        updateStatus(`Playing: ${actionConfig.description}`);
                        forceClick(cardToProcess.querySelector('[role="button"]'));
                        await new Promise(r => setTimeout(r, ACTION_TRANSITION_DELAY));
                        if (!isPlaying) return;

                        if (actionConfig.outfit) {
                            // *** CORRECTED FUNCTION CALL TO PASS AN OBJECT ***
                            if (!await executeChangeOutfit({ outfitName: actionConfig.outfit })) {
                                stopScript("Outfit change failed.");
                                return;
                            }
                        }

                        const branchButton = await waitUntilElementIsReady(actionConfig.branch);
                        if (branchButton) {
                            updateStatus(`Clicking branch: ${actionConfig.branch.buttonText}`);
                            forceClick(branchButton);
                            await new Promise(r => setTimeout(r, ACTION_TRANSITION_DELAY));
                            if (!isPlaying) return;

                            if (actionConfig.exitButtonText) {
                                const exitIdentifier = { type: "storylet_exit_button", buttonText: actionConfig.exitButtonText };
                                const exitButton = await waitUntilElementIsReady(exitIdentifier);
                                if (exitButton) {
                                    updateStatus(`Clicking exit: ${actionConfig.exitButtonText}`);
                                    forceClick(exitButton);
                                    await new Promise(r => setTimeout(r, ACTION_TRANSITION_DELAY));
                                } else {
                                    stopScript("Could not find exit button.");
                                    return;
                                }
                            }
                        } else {
                            stopScript("Could not find branch button.");
                            return;
                        }

                    } else if (action === 'discard') {
                        updateStatus(`Discarding: ${actionConfig.description}`);
                        const discardButton = cardToProcess.querySelector('.card__discard-button');
                        if (discardButton) {
                            forceClick(discardButton);
                            await new Promise(r => setTimeout(r, DECK_DRAW_DELAY));
                        } else {
                            updateStatus(`Error: No discard button for ${actionConfig.description}`);
                            await new Promise(r => setTimeout(r, 2000));
                        }
                    }
                } else {
                    const deck = document.querySelector('button.deck');
                    if (deck && isElementVisible(deck) && !deck.disabled) {
                        updateStatus("No actionable cards. Drawing...");
                        forceClick(deck);
                        await new Promise(r => setTimeout(r, DECK_DRAW_DELAY));
                    } else {
                        updateStatus("No actionable cards; cannot draw. Waiting...");
                        await new Promise(r => setTimeout(r, 10000));
                    }
                }
            } catch (error) {
                console.error("An error occurred in the main loop:", error);
                stopScript("Error occurred. Check console.");
            }
             await new Promise(r => setTimeout(r, 500));
        }
    }


    // --- UI and Control ---

    function handleConfigFileLoad(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const loadedConfig = JSON.parse(e.target.result);
                if (typeof loadedConfig === 'object' && loadedConfig !== null && !Array.isArray(loadedConfig)) {
                    scriptConfig = loadedConfig;
                    const ruleCount = Object.keys(scriptConfig).length;
                    updateStatus(`Config '${file.name}' loaded with ${ruleCount} rules. Ready.`);
                    playButton.disabled = false;
                } else {
                    throw new Error("File is not a valid JSON object.");
                }
            } catch (err) {
                console.error("Error loading or parsing config file:", err);
                updateStatus(`Error: Invalid config file. ${err.message}`);
                scriptConfig = {};
                playButton.disabled = true;
            }
        };
        reader.readAsText(file);
        fileInput.value = '';
    }

    function startScript() {
        if (isPlaying) return;
        if (Object.keys(scriptConfig).length === 0) {
            updateStatus("Error: No configuration loaded.");
            return;
        }
        isPlaying = true;
        playButton.textContent = "Stop";
        loadButton.disabled = true;
        updateStatus("Starting card automation...");
        mainLoop();
    }

    function stopScript(reason = "Script stopped.") {
        if (!isPlaying && playButton.textContent === "Start") return; // Already stopped
        isPlaying = false;
        playButton.textContent = "Start";
        loadButton.disabled = false;
        updateStatus(reason);
    }

    function createUI() {
        const ball = document.createElement('div');
        ball.id = 'fl-automator-ball';
        ball.title = 'FL Card Automator';
        document.body.appendChild(ball);

        const panel = document.createElement('div');
        panel.id = 'fl-automator-panel';
        panel.innerHTML = `
            <h3>Card Automator</h3>
            <div style="display: flex; gap: 6px;">
                <button id="fl-load-btn" style="flex:1;">Load Config</button>
                <button id="fl-play-btn" style="flex:1;" disabled>Start</button>
            </div>
            <input type="file" id="fl-config-input" accept=".json" style="display: none;">
            <div id="fl-status-div">Load a config file to begin.</div>
        `;
        document.body.appendChild(panel);

        playButton = document.getElementById('fl-play-btn');
        loadButton = document.getElementById('fl-load-btn');
        fileInput = document.getElementById('fl-config-input');
        statusDiv = document.getElementById('fl-status-div');

        loadButton.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', handleConfigFileLoad);

        playButton.addEventListener('click', () => {
            isPlaying ? stopScript("Stopped by user.") : startScript();
        });

        ball.addEventListener('click', () => {
             panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
        });

        document.addEventListener('mousedown', (e) => {
            if (panel.style.display === 'block' && !panel.contains(e.target) && !ball.contains(e.target)) {
                panel.style.display = 'none';
            }
        });

        GM_addStyle(`
            #fl-automator-ball {
                position: fixed; bottom: 24px; left: 24px; width: 36px; height: 36px;
                background: radial-gradient(circle at 65% 30%, #f5e5b8 65%, #d4b97c 100%);
                border-radius: 50%; box-shadow: 0 1px 4px rgba(0,0,0,0.2); z-index: 10001; cursor: pointer;
                border: 2px solid #bca86b; display: flex; align-items: center; justify-content: center;
            }
            #fl-automator-ball::before {
                content: ''; display: block; width: 20px; height: 20px;
                background-image: url('//images.fallenlondon.com/cards/deck.png'); background-size: contain;
            }
            #fl-automator-panel {
                position: fixed; bottom: 70px; left: 24px; width: 240px;
                background: #23201b; color: #e3dac0; border: 1px solid #5f5242; padding: 12px;
                z-index: 10002; font-family: 'Lato', sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                display: none; animation: fl-fade-in 0.2s;
            }
            @keyframes fl-fade-in { from { opacity: 0; transform: translateY(15px);} to { opacity: 1; transform: translateY(0);} }
            #fl-automator-panel h3 { margin: 0 0 10px; font-size: 1.1em; color: #fff8e1; text-align: center; border-bottom: 1px solid #3d342a; padding-bottom: 8px; }
            #fl-automator-panel button { padding: 8px; border: 1px solid #5f5242; cursor: pointer; background-color: #37322a; color: #e3dac0; font-size: 1em; }
            #fl-automator-panel button:hover:not(:disabled) { background-color: #6e5433; color: #fffbe6; }
            #fl-automator-panel button:disabled { cursor: not-allowed; opacity: 0.6; }
            #fl-status-div { margin-top: 10px; padding: 8px; background: #2c271e; border: 1px solid #403826; min-height: 40px; font-size: 0.9em; color: #c6b589; }
        `);
    }

    function updateStatus(message) {
        if (statusDiv) {
            statusDiv.textContent = message;
            console.log("FL Automator Status:", message);
        }
    }

    // --- Initialization ---
    function init() {
        if (document.querySelector("#fl-automator-panel")) return;
        const observer = new MutationObserver(() => {
            if (document.querySelector("#main")) {
                observer.disconnect();
                createUI();
            }
        });
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        } else {
            window.addEventListener('DOMContentLoaded', () => observer.observe(document.body, { childList: true, subtree: true }));
        }
    }

    init();

})();
