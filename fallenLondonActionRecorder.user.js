// ==UserScript==
// @name         Fallen London Action Recorder
// @namespace    http://tampermonkey.net/
// @version      0.5
// @description  Record, replay, and handle failures on Fallen London story pages.
// @author       Xeo
// @match        https://www.fallenlondon.com/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';

    // --- Configuration ---
    const POLLING_INTERVAL = 300; // ms, how often to check for an element during playback
    const ELEMENT_TIMEOUT = 15000; // ms, how long to wait for an element before giving up
    const MAX_CONSECUTIVE_FAILURES = 3; // Max retries for a single step on failure

    // --- State Variables ---
    let isRecording = false;
    let recordedActions = [];
    let currentPlaybackActions = [];
    let playbackIndex = 0;
    let isPlaying = false;
    let onFailureAction = 'stop'; // 'stop' or 'retry'

    // --- UI Elements ---
    let recordButton, stopButton, loadButton, playButton, fileInput, statusDiv, failureActionSelect;

    // --- Helper Functions ---

    function getOriginalTextContent(element) {
        if (!element) return '';
        const clone = element.cloneNode(true);
        const translationWrappers = clone.querySelectorAll(
            'font.immersive-translate-target-wrapper, .immersive-translate-target-wrapper, font.notranslate'
        );
        translationWrappers.forEach(wrapper => wrapper.remove());
        let text = clone.textContent.trim();
        const separatorPattern = /\s*(\u00A0\u00A0| {2,}).*/;
        text = text.replace(separatorPattern, '').trim();
        if ((element.tagName === 'BUTTON' || element.tagName === 'SPAN')) {
            let directText = "";
            clone.childNodes.forEach(child => {
                if (child.nodeType === Node.TEXT_NODE) directText += child.textContent;
            });
            if (directText.trim()) {
                 const cleanedDirectText = directText.trim().replace(separatorPattern, '').trim();
                 if (cleanedDirectText) return cleanedDirectText;
            }
        }
        return text;
    }

    function getButtonText(buttonEl) {
        if (!buttonEl) return '';
        const spanInsideButton = buttonEl.querySelector('span:not([class*="buttonlet"]):not([class*="fa-"])');
        let textSourceElement = buttonEl;
        if (spanInsideButton) {
            const spanText = getOriginalTextContent(spanInsideButton);
            const buttonDirectText = getOriginalTextContent(buttonEl);
            if (spanText && (buttonDirectText.includes(spanText) || !buttonDirectText)) {
                textSourceElement = spanInsideButton;
            }
        }
        let text = getOriginalTextContent(textSourceElement);
        if (!text && buttonEl.value) text = getOriginalTextContent(buttonEl);
        return text.replace(/\s*\(\d+\)$/, '').trim();
    }

    function getCleanedDebugHtml(element) {
        if (!element) return '';
        const clone = element.cloneNode(true);
        const translationElements = clone.querySelectorAll(
            'font.immersive-translate-target-wrapper, .immersive-translate-target-wrapper, font.notranslate, [data-immersive-translate-translation-element-mark]'
        );
        translationElements.forEach(el => el.remove());
        const elementsToCleanAttrs = [clone, ...clone.querySelectorAll('*')];
        elementsToCleanAttrs.forEach(el => {
            el.removeAttribute('data-immersive-translate-walked');
            el.removeAttribute('data-immersive-translate-paragraph');
            el.removeAttribute('data-immersive-translate-translation-element-mark');
        });
        return clone.outerHTML.substring(0, 250);
    }

    function getElementIdentifier(clickedEl) {
        if (!clickedEl || !clickedEl.tagName) return null;
        const buttonEl = clickedEl.closest('button, input[type="button"], input[type="submit"], [role="button"]');
        if (!buttonEl) return null;
        const buttonText = getButtonText(buttonEl);
        if (!buttonText) return null;
        const cleanedDebugHtml = getCleanedDebugHtml(buttonEl);

        const branchDiv = buttonEl.closest('div[data-branch-id]');
        if (branchDiv && branchDiv.dataset.branchId) {
            const branchId = branchDiv.dataset.branchId;
            let titleHint = '';
            const headingEl = branchDiv.querySelector('h1, h2, .storylet__heading, .branch__title');
            if (headingEl) titleHint = getOriginalTextContent(headingEl).substring(0, 150);
            return { type: 'branch_button', branchId, buttonText, titleHint, debug_element_html: cleanedDebugHtml };
        }

        let storyRootForTitleBlock = null;
        let titleHintForTitleBlock = '';
        const standardButtonContainer = buttonEl.closest('.buttons--storylet-exit-options, .storylet__buttons');
        if (standardButtonContainer && standardButtonContainer.parentElement) {
            const potentialRoot = standardButtonContainer.parentElement;
            const headingInPotentialRoot = potentialRoot.querySelector('h1, h2, .storylet-root__heading, .storylet__heading');
            if (headingInPotentialRoot) {
                storyRootForTitleBlock = potentialRoot;
                titleHintForTitleBlock = getOriginalTextContent(headingInPotentialRoot).substring(0, 150);
            }
        }
        if (!storyRootForTitleBlock) {
            let currentAncestor = buttonEl.parentElement;
            for (let i = 0; i < 5 && currentAncestor; i++) {
                const headingInAncestor = currentAncestor.querySelector('h1, h2, .storylet-root__heading, .storylet__heading');
                if (headingInAncestor && currentAncestor.contains(buttonEl)) {
                    storyRootForTitleBlock = currentAncestor;
                    titleHintForTitleBlock = getOriginalTextContent(headingInAncestor).substring(0, 150);
                    break;
                }
                currentAncestor = currentAncestor.parentElement;
            }
        }
        if (!storyRootForTitleBlock) {
            const mainContentDiv = buttonEl.closest('#main > .tab-content__bordered-container > div:not(.media--root):not(.storylet)');
            if (mainContentDiv) {
                 const headingInMainDiv = mainContentDiv.querySelector('.media--root h1, .media--root h2, .media--root .storylet-root__heading, .storylet h1, .storylet h2, .storylet .storylet__heading');
                 if (headingInMainDiv && mainContentDiv.contains(buttonEl)) {
                    storyRootForTitleBlock = mainContentDiv;
                    titleHintForTitleBlock = getOriginalTextContent(headingInMainDiv).substring(0,150);
                 }
            }
        }
        if (storyRootForTitleBlock && titleHintForTitleBlock) {
            return { type: 'titled_block_button', titleHint: titleHintForTitleBlock, buttonText, debug_element_html: cleanedDebugHtml };
        }

        if (buttonEl.id) {
            return { type: 'id_button', id: buttonEl.id, buttonText, debug_element_html: cleanedDebugHtml };
        }

        let selector = buttonEl.tagName.toLowerCase();
        const classes = Array.from(buttonEl.classList).filter(c => c && !['selected', 'active', 'highlight', 'js-tt'].includes(c) && !c.startsWith('immersive-translate'));
        if (classes.length > 0) selector += '.' + classes.join('.');
        return { type: 'selector_button', selector, buttonText, debug_element_html: cleanedDebugHtml };
    }

    function findElement(identifier) {
        if (!identifier || !identifier.type) return null;
        let elements = [];
        let targetElement = null;

        switch (identifier.type) {
            case 'branch_button':
                const branchContainer = document.querySelector(`div[data-branch-id="${identifier.branchId}"]`);
                if (branchContainer) {
                    if (identifier.titleHint) {
                        const headingEl = branchContainer.querySelector('h1, h2, .storylet__heading, .branch__title');
                        // Optional: title mismatch warning: if (headingEl && getOriginalTextContent(headingEl).substring(0, 150) !== identifier.titleHint) console.warn(...);
                    }
                    elements = Array.from(branchContainer.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]'));
                    targetElement = elements.find(el => getButtonText(el) === identifier.buttonText && isElementVisible(el));
                }
                break;
            case 'titled_block_button':
                const allHeadings = Array.from(document.querySelectorAll('h1, h2, .storylet-root__heading, .storylet__heading'));
                const titleHeading = allHeadings.find(h => getOriginalTextContent(h).substring(0, 150) === identifier.titleHint && isElementVisible(h));
                if (titleHeading) {
                    const commonParent = titleHeading.closest('.media--root, .storylet');
                    let blockContainer = null;
                    if (commonParent && commonParent.parentElement && commonParent.parentElement.querySelector('.buttons--storylet-exit-options, .storylet__buttons')) {
                        blockContainer = commonParent.parentElement;
                    } else {
                        blockContainer = titleHeading.closest('.storylet, #main > .tab-content__bordered-container > div:first-child');
                    }
                    if (blockContainer) {
                        elements = Array.from(blockContainer.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]'));
                        targetElement = elements.find(el => getButtonText(el) === identifier.buttonText && isElementVisible(el));
                    }
                }
                break;
            case 'id_button':
                targetElement = document.getElementById(identifier.id);
                if (targetElement && getButtonText(targetElement) !== identifier.buttonText) { /* Optional warning */ }
                break;
            case 'selector_button':
                elements = Array.from(document.querySelectorAll(identifier.selector));
                targetElement = elements.find(el => getButtonText(el) === identifier.buttonText && isElementVisible(el));
                if (!targetElement && elements.length === 1 && isElementVisible(elements[0])) targetElement = elements[0];
                break;
        }
        return (targetElement && isElementVisible(targetElement)) ? targetElement : null;
    }

    function isElementVisible(el) {
        if (!el) return false;
        if (el.classList.contains('u-visually-hidden') || el.style.display === 'none' || el.closest('.u-visually-hidden')) return false;
        if (el.closest('[data-immersive-translate-walked]') && el.offsetParent === null && el.offsetWidth === 0 && el.offsetHeight === 0) {
            if (el.tagName === 'FONT' && el.classList.contains('immersive-translate-target-wrapper')) return false;
        }
        return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    }

    function checkForFailure() {
        const qualityUpdatesContainer = document.querySelector('.branch.media--quality-updates');
        if (qualityUpdatesContainer) {
            const updatesText = getOriginalTextContent(qualityUpdatesContainer);
            if (updatesText.toLowerCase().includes("failed in a challenge")) {
                console.warn("Failure detected: Text 'failed in a challenge' found.");
                return true;
            }
        }
        // Check for specific failure titles as a secondary, weaker indicator if needed
        const mainTitleEl = document.querySelector('.media--root .storylet-root__heading');
        if (mainTitleEl) {
            const mainTitleText = getOriginalTextContent(mainTitleEl).toLowerCase();
            const knownFailureTitles = ["unconvinced", "a setback!", "frustration", "no luck this time"]; // Expand as needed
            if (knownFailureTitles.some(ft => mainTitleText.includes(ft))) {
                // This is a weaker signal, might lead to false positives if not careful.
                // For now, only return true if "failed in a challenge" is also present,
                // or if you are confident these titles ONLY appear on definite failures.
                // If "failed in a challenge" is reliable, this title check might be redundant or for very specific cases.
                // console.warn("Potential failure detected by title: ", mainTitleText);
                // return true; // Uncomment if titles alone should trigger failure
            }
        }
        return false;
    }

    async function clickExitButtonOnFailureScreen() {
        updateStatus("Attempting to click 'Onwards' on failure screen...");
        const exitButtonTexts = ["Onwards", "Continue", "Try again"]; // "Try again" if it leads back, not to the same action
        let exitButton = null;
        const buttonsArea = document.querySelector('.buttons--storylet-exit-options');
        if (buttonsArea) {
            const allButtons = Array.from(buttonsArea.querySelectorAll('button'));
            for (const text of exitButtonTexts) {
                exitButton = allButtons.find(btn => getButtonText(btn).toLowerCase() === text.toLowerCase() && isElementVisible(btn));
                if (exitButton) break;
            }
        }

        if (exitButton) {
            console.log("Found exit button on failure screen:", getButtonText(exitButton));
            const originalOutline = exitButton.style.outline;
            exitButton.style.outline = "3px solid orange";
            exitButton.scrollIntoView({ behavior: 'auto', block: 'center' });
            await new Promise(resolve => setTimeout(resolve, 200));
            exitButton.click();
            await new Promise(resolve => setTimeout(resolve, 100));
            exitButton.style.outline = originalOutline;
            await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 500)); // Longer delay for page transition
            updateStatus(`'${getButtonText(exitButton)}' clicked. Preparing to retry...`);
            return true;
        } else {
            updateStatus("Could not find suitable exit button on failure screen. Cannot retry automatically.");
            console.error("No 'Onwards' or similar exit button found on failure screen.");
            return false;
        }
    }

    // --- Event Handlers ---
    function handleDocumentClick(event) {
        if (!isRecording || event.target.closest('#fl-recorder-panel')) return;
        const identifier = getElementIdentifier(event.target);
        if (identifier) {
            recordedActions.push(identifier);
            updateStatus(`Recorded: [${identifier.type}] ${identifier.buttonText || identifier.id}`);
            console.log("Recorded Action:", identifier);
        } else {
            updateStatus("Could not identify clicked button meaningfully.");
        }
    }

    function startRecording() {
        if (isRecording) return;
        isRecording = true;
        recordedActions = [];
        recordButton.disabled = true; stopButton.disabled = false; playButton.disabled = true; loadButton.disabled = true;
        updateStatus("Recording started...");
        document.addEventListener('click', handleDocumentClick, true);
    }

    function stopRecording() {
        if (!isRecording) return;
        isRecording = false;
        document.removeEventListener('click', handleDocumentClick, true);
        recordButton.disabled = false; stopButton.disabled = true; playButton.disabled = recordedActions.length === 0; loadButton.disabled = false;
        updateStatus(`Recording stopped. ${recordedActions.length} actions recorded.`);
        if (recordedActions.length > 0) saveRecordingToFile();
    }

    function saveRecordingToFile() {
        if (recordedActions.length === 0) { alert("No actions recorded."); return; }
        const jsonData = JSON.stringify(recordedActions, null, 2);
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().replace(/:/g, '-').slice(0, 19);
        a.download = `fl_actions_${dateStr}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        updateStatus(`Recording saved to ${a.download}`);
    }

    function handleLoadFile(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const loaded = JSON.parse(e.target.result);
                if (Array.isArray(loaded) && (loaded.length === 0 || (loaded[0].type && (loaded[0].buttonText || loaded[0].id)))) {
                    currentPlaybackActions = loaded; recordedActions = [...loaded];
                    updateStatus(`Loaded ${currentPlaybackActions.length} actions from ${file.name}.`);
                    playButton.disabled = currentPlaybackActions.length === 0; recordButton.disabled = false;
                } else {
                    updateStatus("Invalid recording file format."); playButton.disabled = true;
                }
            } catch (err) {
                updateStatus(`Error loading file: ${err.message}`); playButton.disabled = true;
            }
        };
        reader.readAsText(file); fileInput.value = '';
    }

    async function startPlayback() {
        if (isPlaying || currentPlaybackActions.length === 0) {
            updateStatus(isPlaying ? "Playback in progress." : "No actions to play."); return;
        }
        isPlaying = true; playbackIndex = 0;
        playButton.textContent = "Stop Playback";
        recordButton.disabled = true; stopButton.disabled = true; loadButton.disabled = true; failureActionSelect.disabled = true;
        updateStatus(`Starting playback... (Failure: ${onFailureAction})`);
        let consecutiveFailuresOnStep = 0;

        while (playbackIndex < currentPlaybackActions.length && isPlaying) {
            if (consecutiveFailuresOnStep >= MAX_CONSECUTIVE_FAILURES) {
                updateStatus(`Stopped: ${MAX_CONSECUTIVE_FAILURES} consecutive failures on step ${playbackIndex + 1}.`);
                isPlaying = false; break;
            }
            const action = currentPlaybackActions[playbackIndex];
            updateStatus(`[${playbackIndex + 1}/${currentPlaybackActions.length}] Look: ${action.buttonText || action.id}`);
            let element = null;
            const startTime = Date.now();
            while (Date.now() - startTime < ELEMENT_TIMEOUT && isPlaying) {
                element = findElement(action);
                if (element) break;
                await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
            }

            if (!isPlaying) { updateStatus("Playback stopped by user."); break; }

            if (element) {
                updateStatus(`Found. Clicking: ${action.buttonText || action.id}`);
                const originalOutline = element.style.outline; element.style.outline = "3px solid #4CAF50";
                element.scrollIntoView({ behavior: 'auto', block: 'center' });
                await new Promise(resolve => setTimeout(resolve, 200));
                element.click();
                await new Promise(resolve => setTimeout(resolve, 100));
                element.style.outline = originalOutline;
                await new Promise(resolve => setTimeout(resolve, 1200 + Math.random() * 600)); // Longer delay for page to fully update

                if (checkForFailure()) {
                    consecutiveFailuresOnStep++;
                    updateStatus(`Failure after action ${playbackIndex + 1}. Mode: ${onFailureAction}. Attempt ${consecutiveFailuresOnStep}.`);
                    if (onFailureAction === 'retry') {
                        const navigatedAway = await clickExitButtonOnFailureScreen();
                        if (navigatedAway) {
                            // playbackIndex is NOT incremented, so this action will be retried
                            updateStatus(`Retrying action ${playbackIndex + 1}: ${action.buttonText}...`);
                            await new Promise(resolve => setTimeout(resolve, 500)); // Small delay before retry
                            continue; // Skip playbackIndex++ and restart loop for current action
                        } else {
                            updateStatus("Cannot navigate from failure. Stopping."); isPlaying = false; break;
                        }
                    } else { // 'stop'
                        updateStatus("Stopping on failure."); isPlaying = false; break;
                    }
                } else {
                    // No failure detected
                    consecutiveFailuresOnStep = 0; // Reset counter for this step
                    playbackIndex++;
                }
            } else {
                updateStatus(`Error: Element for action ${playbackIndex + 1} not found. Stopping.`);
                console.error("Element not found:", action, "HTML:", action.debug_element_html);
                isPlaying = false; break;
            }
        }

        if (isPlaying && playbackIndex === currentPlaybackActions.length) updateStatus("Playback finished.");
        isPlaying = false;
        playButton.textContent = "Start Playback";
        playButton.disabled = currentPlaybackActions.length === 0;
        recordButton.disabled = false; loadButton.disabled = false; failureActionSelect.disabled = false;
        if (recordedActions.length > 0 && !playButton.disabled) stopButton.disabled = true; else if (!isRecording) stopButton.disabled = true;

    }

    function stopPlayback() {
        if (isPlaying) {
            isPlaying = false;
            updateStatus("Playback stopping...");
        }
    }

    // --- UI Setup ---
    async function createUI() { // Made async for GM_getValue
        const panel = document.createElement('div');
        panel.id = 'fl-recorder-panel';
        panel.innerHTML = `
            <h3>FL Action Recorder</h3>
            <button id="fl-record-btn" title="Start recording clicks">Record</button>
            <button id="fl-stop-btn" title="Stop recording and save" disabled>Stop Rec</button>
            <hr>
            <input type="file" id="fl-file-input" accept=".json" style="display: none;">
            <button id="fl-load-btn" title="Load a previously saved recording">Load Rec</button>
            <button id="fl-play-btn" title="Play loaded recording / Stop current playback" disabled>Start Playback</button>
            <div style="margin-top: 5px; display: flex; align-items: center; justify-content: space-between;">
                <label for="fl-failure-action" style="font-size:0.9em; margin-right: 5px;">On Failure:</label>
                <select id="fl-failure-action" style="font-size:0.9em; padding: 3px; flex-grow: 1; border: 1px solid #666; background-color: #444; color: #eee;">
                    <option value="stop">Stop Script</option>
                    <option value="retry">Retry Action</option>
                </select>
            </div>
            <div id="fl-status-div" style="margin-top: 8px; font-size: 0.9em; min-height: 36px;">Idle.</div>
        `;
        document.body.appendChild(panel);

        recordButton = document.getElementById('fl-record-btn');
        stopButton = document.getElementById('fl-stop-btn');
        loadButton = document.getElementById('fl-load-btn');
        playButton = document.getElementById('fl-play-btn');
        fileInput = document.getElementById('fl-file-input');
        statusDiv = document.getElementById('fl-status-div');
        failureActionSelect = document.getElementById('fl-failure-action');

        recordButton.addEventListener('click', startRecording);
        stopButton.addEventListener('click', stopRecording);
        loadButton.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', handleLoadFile);
        playButton.addEventListener('click', () => { isPlaying ? stopPlayback() : startPlayback(); });

        // Load saved preference for failure action
        onFailureAction = await GM_getValue('flRecorderFailureAction', 'stop');
        failureActionSelect.value = onFailureAction;
        updateStatus(`Failure mode: ${onFailureAction}. Ready.`);


        failureActionSelect.addEventListener('change', async (event) => {
            onFailureAction = event.target.value;
            await GM_setValue('flRecorderFailureAction', onFailureAction);
            updateStatus(`Failure mode set to: ${onFailureAction}`);
        });

        GM_addStyle(`
            #fl-recorder-panel {
                position: fixed; bottom: 10px; right: 10px; background-color: #333; color: #eee;
                border: 1px solid #555; padding: 12px; z-index: 10001; border-radius: 6px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.5); font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
                width: 270px; font-size: 13px;
            }
            #fl-recorder-panel h3 {
                margin-top: 0; margin-bottom: 12px; font-size: 1.15em; text-align: center;
                color: #fff; border-bottom: 1px solid #555; padding-bottom: 7px;
            }
            #fl-recorder-panel button {
                padding: 8px 12px; margin: 5px 2px; border: 1px solid #666; border-radius: 4px;
                cursor: pointer; background-color: #555; color: #fff; font-size: 0.9em;
                transition: background-color 0.2s; width: calc(50% - 6px); box-sizing: border-box;
            }
            #fl-recorder-panel button#fl-play-btn { width: calc(100% - 4px); }
            #fl-recorder-panel button:hover:not(:disabled) { background-color: #777; }
            #fl-recorder-panel button:disabled { cursor: not-allowed; opacity: 0.5; background-color: #444; }
            #fl-status-div {
                background-color: #282828; border: 1px solid #444; padding: 7px; font-size: 0.85em;
                min-height: 38px; max-height:55px; overflow-y: auto; word-wrap: break-word; color: #ccc; border-radius: 3px;
            }
            #fl-recorder-panel hr { border: none; border-top: 1px solid #555; margin: 10px 0; }
            #fl-recorder-panel label { color: #bbb;}
        `);
    }

    function updateStatus(message) {
        if (statusDiv) {
            statusDiv.textContent = message;
            statusDiv.scrollTop = statusDiv.scrollHeight;
        }
        console.log("FLR Status:", message);
    }

    function init() {
        const observer = new MutationObserver((mutationsList, observer) => {
            if (document.querySelector('#main') || document.querySelector('.storylet')) {
                observer.disconnect();
                createUI().catch(console.error); // Call async createUI
                console.log("FL Recorder UI Initialized.");
            }
        });
        if (document.body) {
             if (document.querySelector('#main') || document.querySelector('.storylet')) {
                createUI().catch(console.error);
                console.log("FL Recorder UI Initialized (immediate).");
            } else {
                observer.observe(document.body, { childList: true, subtree: true });
            }
        } else {
            window.addEventListener('DOMContentLoaded', () => {
                observer.observe(document.body, { childList: true, subtree: true });
            });
        }
    }
    init();

})();
