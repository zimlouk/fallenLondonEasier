// ==UserScript==
// @name         Fallen London Helper
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  为特定页面的元素添加执行脚本按钮，通过父元素的 data-branch-id 精确查找 Button1
// @author       xeoplise
// @match        *://www.fallenlondon.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Hoist timer IDs and stop function reference
    let checkButton1TimeoutId = null;
    let nextClickTimeoutId = null;
    let findButton2IntervalId = null;
    let stopScriptGlobally = null;

    // --- Button Creation Functions ---

    // Creates and adds the button to add script triggers
    function addMainToggleButton() {
        const toggleButton = document.createElement('button');
        toggleButton.id = 'fl-helper-add-button'; // Add an ID for potential styling/selection
        toggleButton.textContent = '添加执行脚本按钮';
        toggleButton.style.position = 'fixed';
        toggleButton.style.top = '10px';
        toggleButton.style.right = '10px';
        toggleButton.style.zIndex = 10000; // Ensure it's on top
        toggleButton.style.padding = '8px 12px';
        toggleButton.style.backgroundColor = '#007bff';
        toggleButton.style.color = 'white';
        toggleButton.style.border = 'none';
        toggleButton.style.borderRadius = '4px';
        toggleButton.style.cursor = 'pointer';
        toggleButton.style.fontSize = '14px';

        document.body.appendChild(toggleButton);

        toggleButton.addEventListener('click', function() {
            addScriptButtons();
            toggleButton.textContent = '已添加/刷新';
            toggleButton.disabled = true;
            setTimeout(() => {
                toggleButton.textContent = '添加执行脚本按钮';
                toggleButton.disabled = false;
            }, 2000);
        });
    }

    // Creates and adds the global stop button
    function addStopAllButton() {
        const stopButton = document.createElement('button');
        stopButton.id = 'fl-helper-stop-button'; // Add an ID
        stopButton.textContent = '停止运行中脚本';
        stopButton.style.position = 'fixed';
        stopButton.style.top = '55px'; // Position below the add button
        stopButton.style.right = '10px';
        stopButton.style.zIndex = 10000; // Ensure it's on top
        stopButton.style.padding = '8px 12px';
        stopButton.style.backgroundColor = '#dc3545'; // Red color for stop
        stopButton.style.color = 'white';
        stopButton.style.border = 'none';
        stopButton.style.borderRadius = '4px';
        stopButton.style.cursor = 'pointer';
        stopButton.style.fontSize = '14px';
        stopButton.disabled = true; // Initially disabled, enabled when a script starts

        document.body.appendChild(stopButton);

        stopButton.addEventListener('click', function() {
            if (typeof stopScriptGlobally === 'function') {
                console.log('全局停止按钮被点击，尝试停止脚本...');
                stopScriptGlobally(); // Call the active stop function
                stopButton.textContent = '已停止';
                stopButton.disabled = true; // Disable after stopping
                setTimeout(() => {
                     stopButton.textContent = '停止运行中脚本';
                     // Keep it disabled until a new script starts
                }, 1500);
            } else {
                console.log('全局停止按钮被点击，但当前无运行中的脚本。');
                alert('当前没有脚本正在运行。');
            }
        });
    }

    // Creates and inserts the individual "Execute Script" buttons
    function addScriptButtons() {
        var allButtons = document.querySelectorAll('.js-tt.button.button--primary.button--margin.button--go');

        allButtons.forEach(function(targetButton) {
            // Check if a script button already exists for this target button
            if (targetButton.previousElementSibling && targetButton.previousElementSibling.classList.contains('fl-helper-script-button')) {
                return; // Skip if already added
            }

            // Don't add script button to our own generated buttons
            if (targetButton.classList.contains('fl-helper-script-button')) {
                return;
            }

            var scriptButton = document.createElement('button');
            scriptButton.className = 'js-tt button button--primary button--margin button--go fl-helper-script-button'; // Add specific class
            scriptButton.type = 'button';
            scriptButton.innerHTML = '<span>执行脚本</span>';
            scriptButton.style.backgroundColor = '#28a745'; // Green color for execute
            scriptButton.style.borderColor = '#1e7e34';
            scriptButton.style.marginRight = '5px'; // Add some space

            targetButton.parentNode.insertBefore(scriptButton, targetButton);

            scriptButton.addEventListener('click', function() {
                // Stop any previous instance before starting a new one
                if (typeof stopScriptGlobally === 'function') {
                   console.log("检测到正在运行的旧脚本实例，正在停止...");
                   stopScriptGlobally();
                }
                // Start the new script instance, passing the button it's attached to
                startScript(targetButton);
            });
        });
    }

    // Add the global stop button state update function
    window.updateFlHelperStopButtonState = function(isRunning) {
        const btn = document.getElementById('fl-helper-stop-button');
        if (btn) {
            btn.disabled = !isRunning;
            if (!isRunning && btn.textContent === '已停止') {
                setTimeout(() => { btn.textContent = '停止运行中脚本'; }, 1500);
            }
        }
    }

    // --- Core Script Logic ---
    function startScript(initialButton1) { // The button element next to which "Execute Script" was clicked
        // --- User Input ---
        var userInputClicks = prompt('请输入要循环点击的次数:', '10');
        var maxClicks = parseInt(userInputClicks, 10);
        if (isNaN(maxClicks) || maxClicks <= 0) { alert('循环次数输入无效...'); return; }
        var userInputQuality = prompt('请输入目标质量值:', '17');
        var targetQualityValue = parseInt(userInputQuality, 10);
        if (isNaN(targetQualityValue) || targetQualityValue <= 0) { alert('目标质量值输入无效...'); return; }

        // --- Get Parent Identifier ---
        const parentElementWithId = initialButton1.closest('[data-branch-id]'); // Find closest ancestor with the ID
        let parentBranchId = null;
        let button1Selector = null; // The selector to re-find the button

        if (parentElementWithId) {
            parentBranchId = parentElementWithId.dataset.branchId;
            // Construct the selector: Find the parent by ID, then the button within it
            // Assuming the button classes are consistent and it's a direct or nested child
            button1Selector = `[data-branch-id="${parentBranchId}"] .js-tt.button.button--primary.button--margin.button--go`;
            console.log(`脚本启动：将使用父元素 data-branch-id="${parentBranchId}" 查找 Button1 (选择器: "${button1Selector}")`);
        } else {
            // If no parent with data-branch-id is found, we cannot reliably target the button. Stop.
            alert('错误：无法找到目标按钮父元素的 data-branch-id。脚本无法确定要点击哪个按钮，已终止。');
            console.error('Error: Could not find a parent element with data-branch-id for the initial Button1. Cannot proceed.');
            // Ensure stop button state is correct if script fails to start
            if (window.updateFlHelperStopButtonState) window.updateFlHelperStopButtonState(false);
            return; // Stop execution
        }

        console.log(`目标点击 ${maxClicks} 次，目标质量 ${targetQualityValue}`);

        if (window.updateFlHelperStopButtonState) window.updateFlHelperStopButtonState(true);

        var clickCount = 0;
        var scriptRunning = true;

        // --- Cleanup previous timers ---
        clearAllTimers();

        // --- Helper Functions ---

        // 查找 button2
        function findButton2() {
            var buttons2 = document.querySelectorAll('.button.button--primary');
            var button2;
            buttons2.forEach(function(button) {
                if (button.textContent.trim() === 'Try again') { button2 = button; }
            });
            return button2;
         }

        // 检查质量值
        function checkQualityValue() {
            var qualitySpan = document.querySelector('.quality-name');
            if (qualitySpan) {
                var qualityText = qualitySpan.textContent;
                var match = qualityText.match(/increased to (\d+)/);
                if (match && parseInt(match[1], 10) === targetQualityValue) {
                    alert(`值已经到了 ${targetQualityValue}，脚本终止!`);
                    console.log(`目标质量 ${targetQualityValue} 已达到，脚本终止。`);
                    stopScript();
                    return true;
                }
            }
            return false;
        }

        // --- Core Cycle Functions ---

        // 1. 点击 Button1 (Receives the specific button element to click)
        function clickButton1AndInitiateNextStep(buttonToClick) {
             if (!scriptRunning) return;
             console.log(`--- Cycle ${clickCount + 1} / ${maxClicks} ---`);

             // Use the specific parent ID in logging/errors for clarity
             const logId = `Parent Branch ID: ${parentBranchId}`;

             if (document.body.contains(buttonToClick) && !buttonToClick.disabled) {
                 console.log(`[Step 1] 点击 Button1 (标识: ${logId})`);
                 buttonToClick.click();
                 clearTimeout(nextClickTimeoutId);
                 nextClickTimeoutId = setTimeout(findAndCheckQualityBeforeClickButton2, 750);
             } else if (document.body.contains(buttonToClick) && buttonToClick.disabled) {
                 alert(`错误：尝试点击 Button1 (标识: ${logId}) 时发现其被禁用，脚本终止。`);
                 console.error(`[Error] Button1 (${logId}) is disabled.`);
                 stopScript();
             } else {
                  alert(`错误：尝试点击 Button1 (标识: ${logId}) 时发现其已从页面消失，脚本终止。`);
                  console.error(`[Error] Button1 (${logId}) disappeared.`);
                  stopScript();
             }
         }

        // 2. 查找并可能点击 Button2
        function findAndCheckQualityBeforeClickButton2() {
            if (!scriptRunning) return;
            console.log("[Step 2] 开始查找 Button2...");

            let findButton2Attempts = 0;
            const maxFindButton2Attempts = 20; // 10 seconds timeout

            // Clear previous interval if any
            clearInterval(findButton2IntervalId);

            findButton2IntervalId = setInterval(function() {
                if (!scriptRunning) {
                    clearInterval(findButton2IntervalId);
                    return;
                }

                const button2 = findButton2();
                if (button2) {
                    clearInterval(findButton2IntervalId); // Found it, stop searching
                    findButton2IntervalId = null;
                    console.log('[Step 2a] 找到 Button2 (Try again)');

                    if (checkQualityValue()) { // Check quality *before* clicking Button2
                        console.log("[Step 2b] 目标质量已达到，脚本停止。");
                        // stopScript() called inside checkQualityValue
                    } else {
                        console.log("[Step 2b] 目标质量未达到，点击 Button2。");
                        button2.click();
                        // Schedule the next step: wait for Button1
                        clearTimeout(nextClickTimeoutId); // Clear just in case
                        nextClickTimeoutId = setTimeout(waitForButton1, 500); // Wait 500ms before starting to wait for Button1
                    }
                } else {
                    findButton2Attempts++;
                    console.log(` -> 等待 Button2... (尝试 ${findButton2Attempts}/${maxFindButton2Attempts})`);
                    if (findButton2Attempts >= maxFindButton2Attempts) { // Timeout finding Button2
                        clearInterval(findButton2IntervalId);
                        findButton2IntervalId = null;
                        alert('等待 Button2 (Try again) 超时，脚本终止。');
                        console.error('[Error] Timeout waiting for Button2.');
                        stopScript();
                    }
                }
            }, 500); // Check every 500ms
        }

        // 3. 等待 Button1 恢复 (Uses the parent ID + button selector)
        function waitForButton1() {
            if (!scriptRunning) return;
            console.log(`[Step 3] 开始等待 Button1 恢复 (选择器: "${button1Selector}")`);

            clearTimeout(checkButton1TimeoutId);

            const startTime = Date.now();
            const timeoutDuration = 15000;
            const initialCheckDelay = 2000;
            const notFoundCheckDelay = 3000;
            const logId = `Parent Branch ID: ${parentBranchId}`; // For logging

            function checkButton1Status() {
                if (!scriptRunning) return;
                const elapsedTime = Date.now() - startTime;

                if (elapsedTime > timeoutDuration) {
                    alert(`等待 Button1 (标识: ${logId}) 恢复超时 (${timeoutDuration / 1000} 秒)，脚本终止。`);
                    console.error(`[Error] Timeout waiting for Button1 (${logId}).`);
                    stopScript();
                    return;
                }

                // --- Core Change: Query using the specific selector ---
                console.log(` -> 正在使用选择器 "${button1Selector}" 查找 Button1...`);
                const currentButton1 = document.querySelector(button1Selector);

                if (currentButton1) {
                    console.log(` -> 找到匹配按钮。检查是否可用...`);
                    if (!currentButton1.disabled) {
                        // --- Button1 Found and Ready ---
                        console.log(`[Step 3a] Button1 (标识: ${logId}) 已找到并可用 (耗时 ${elapsedTime}ms)。`);
                        clickCount++;
                        if (clickCount >= maxClicks) {
                            console.log(`[Step 4] 已达到最大点击次数 (${maxClicks})，脚本完成。`);
                            stopScript();
                        } else {
                            console.log(`[Step 4] 准备开始下一轮 (当前: ${clickCount}/${maxClicks})。`);
                            clearTimeout(nextClickTimeoutId);
                            // Pass the NEWLY FOUND button to the next click function
                            nextClickTimeoutId = setTimeout(() => clickButton1AndInitiateNextStep(currentButton1), 1000);
                        }
                        // --- End Button1 Found Logic ---
                    } else {
                        // Found but disabled - retry
                        console.log(` -> Button1 (标识: ${logId}) 找到但仍被禁用，将在 ${notFoundCheckDelay / 1000} 秒后重试...`);
                        checkButton1TimeoutId = setTimeout(checkButton1Status, notFoundCheckDelay);
                    }
                } else {
                    // Button1 not found - retry
                    console.log(` -> Button1 (选择器: "${button1Selector}") 尚未出现，将在 ${notFoundCheckDelay / 1000} 秒后重试...`);
                    checkButton1TimeoutId = setTimeout(checkButton1Status, notFoundCheckDelay);
                }
            }
            checkButton1TimeoutId = setTimeout(checkButton1Status, initialCheckDelay);
        }


        // --- Stop Function & Timer Cleanup ---
        function stopScript() {
            if (!scriptRunning) return;
            console.log('%c停止脚本...', 'color: red; font-weight: bold;');
            scriptRunning = false;

            // Clear all known timers
            clearAllTimers();

            // Attempt to clear any other lingering timers (best effort)
            const highIntervalId = setTimeout(() => {}, 30000); // Use setTimeout to get a high ID
            for (let i = 1; i <= highIntervalId; i++) {
                clearInterval(i);
                clearTimeout(i);
            }
            console.log("尝试清理所有可能残留的定时器。");

            stopScriptGlobally = null;
            if (window.updateFlHelperStopButtonState) window.updateFlHelperStopButtonState(false);
            console.log('脚本已完全停止。');
        }

        // Utility to clear all known timers
        function clearAllTimers() {
             console.log("清理定时器...");
             clearTimeout(checkButton1TimeoutId);
             checkButton1TimeoutId = null;
             clearTimeout(nextClickTimeoutId);
             nextClickTimeoutId = null;
             clearInterval(findButton2IntervalId);
             findButton2IntervalId = null;
        }


        // Assign the stop function to the global reference
        stopScriptGlobally = stopScript;

        // --- Initial State Check (Verifies initialButton1 still exists before getting parent ID) ---
        if (!initialButton1 || !document.body.contains(initialButton1)) {
             alert('目标按钮 (Button1) 在脚本启动时未找到，脚本终止。'); console.error('Initial Button1 not found.'); stopScript(); return;
        }
        if (initialButton1.disabled) {
             alert('目标按钮 (Button1) 在脚本启动时已被禁用，脚本终止。'); console.error('Initial Button1 is disabled.'); stopScript(); return;
        }
        // Note: The check for the parent ID happens *after* these initial checks, inside the Parent Identifier section.

        // --- Start the First Cycle ---
        clickButton1AndInitiateNextStep(initialButton1); // Start with the original button element

    } // End of startScript

    // --- Initial Execution ---
    console.log("FL Helper: Initializing (v1.8)...");
    addMainToggleButton();
    addStopAllButton();
    setTimeout(() => {
        console.log("FL Helper: Setting initial stop button state.");
        window.updateFlHelperStopButtonState(false);
    }, 200);
    console.log("FL Helper: Initialization complete.");

})(); // End of userscript IIFE
