// ==UserScript==
// @name         fallenLondonFastEquipHighest
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Adds an intelligent button to specific qualities.
// @description:zh-CN 为Fallen London侧边栏添加智能按钮，通过模拟UI点击快速换装
// @author       Xeo
// @match        https://www.fallenlondon.com/*
// @updateURL    https://raw.githubusercontent.com/zimlouk/fallenLondonEasier/main/fallenLondonFastEquipHighest.user.js
// @downloadURL  https://raw.githubusercontent.com/zimlouk/fallenLondonEasier/main/fallenLondonFastEquipHighest.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // =================  配置区  =================
    const targetQualitiesConfig = {
        "Watchful": 209, "Shadowy": 210, "Dangerous": 211, "Persuasive": 212,
        "Respectable": 950, "Dreaded": 957, "Bizarre": 958,
        "Kataleptic Toxicology": 140826, "Monstrous Anatomy": 140830,
        "A Player of Chess": 140873, "Glasswork": 140896, "Shapeling Arts": 140897,
        "Artisan of the Red Science": 140969, "Mithridacy": 140998,
        "Zeefaring": 142291, "Chthonosophy": 144818
    };
    // ===========================================

    function waitForElement(selector, parent = document, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const intervalTime = 100; let timeWaited = 0;
            const interval = setInterval(() => {
                const element = parent.querySelector(selector);
                if (element) { clearInterval(interval); resolve(element); }
                else { timeWaited += intervalTime; if (timeWaited >= timeout) { clearInterval(interval); reject(new Error(`等待元素 "${selector}" 出现超时`)); } }
            }, intervalTime);
        });
    }
    
    function waitForElementToDisappear(selector, parent = document, timeout = 15000) {
        return new Promise((resolve, reject) => {
            const intervalTime = 100; let timeWaited = 0;
            const interval = setInterval(() => {
                const element = parent.querySelector(selector);
                if (!element) { clearInterval(interval); resolve(); }
                else { timeWaited += intervalTime; if (timeWaited >= timeout) { clearInterval(interval); reject(new Error(`等待元素 "${selector}" 消失超时`)); } }
            }, intervalTime);
        });
    }
    
    function simulateFullClick(element) {
        if (!element) throw new Error("尝试点击一个不存在的元素");
        const dispatch = (eventName) => { const event = new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }); element.dispatchEvent(event); };
        dispatch('mouseover'); dispatch('mousedown'); dispatch('mouseup'); dispatch('click');
    }
    const delay = ms => new Promise(res => setTimeout(res, ms));
    
    function createEquipButton(qualityName) {
        const button = document.createElement('span');
        const originalColor = 'rgb(237, 227, 210)';

        button.className = 'fast-equip-button';
        button.style.backgroundColor = originalColor;
        button.style.border = '1px solid #999';
        button.style.display = 'inline-block';
        button.style.width = '12px';
        button.style.height = '12px';
        button.style.marginLeft = '5px';
        button.style.cursor = 'pointer';
        button.style.verticalAlign = 'middle';
        button.title = `点击为 '${qualityName}' 快速换装`;
        button.style.transition = 'background-color 0.3s ease';

        button.addEventListener('click', async (event) => {
            event.stopPropagation();
            button.style.backgroundColor = 'orange';
            try {
                console.log(`[开始] 为 ${qualityName} 快速换装`);
                const possessionsLink = await waitForElement('a.cursor-pointer[href="/possessions"]');
                possessionsLink.click();
                await waitForElement('span.heading.heading--3');
                const containers = document.querySelectorAll('div[style^="align-items: baseline"]');
                const itemsContainer = Array.from(containers).find(c => c.querySelector('span.heading.heading--3')?.textContent.trim() === 'items');
                if (!itemsContainer) throw new Error('找不到 "items" 标题的容器');
                const currentValueDiv = itemsContainer.querySelector('.css-gj4dr3-singleValue');
                if (!currentValueDiv) throw new Error('找不到下拉菜单的当前值显示元素');
                const currentValueText = currentValueDiv.textContent.trim();
                if (currentValueText === qualityName) {
                    console.log(`优化：下拉菜单已是 "${qualityName}"，跳过选择步骤。`);
                } else {
                    console.log(`下拉菜单当前值为 "${currentValueText}"，需要更改为 "${qualityName}"。`);
                    const categoryDropdown = itemsContainer.querySelector('div.css-f92gjm-control');
                    if (!categoryDropdown) throw new Error('在"items"容器中找不到下拉菜单');
                    const openEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
                    categoryDropdown.dispatchEvent(openEvent);
                    await delay(100);
                    const listBox = await waitForElement('div[role="listbox"]');
                    const options = listBox.querySelectorAll('div[role="option"]');
                    const targetOption = Array.from(options).find(opt => opt.textContent.trim() === qualityName);
                    if (!targetOption) { document.querySelector('a.cursor-pointer[href="/"]')?.click(); throw new Error(`在下拉菜单中找不到选项 "${qualityName}"。`); }
                    simulateFullClick(targetOption);
                }
                await delay(200);
                const equipButton = await waitForElement('button.button--primary', document, 10000);
                if (!equipButton || !equipButton.textContent.includes('Equip Highest')) { throw new Error('找不到 "Equip Highest" 按钮'); }
                simulateFullClick(equipButton);
                const changingSlotSelector = '.equipment-slot--is-changing';
                try { await waitForElement(changingSlotSelector, document, 2000); } catch (e) { console.warn('未检测到 "is-changing" 状态，继续执行...'); }
                await waitForElementToDisappear(changingSlotSelector, document, 15000);
                const storyLink = await waitForElement('a.cursor-pointer[href="/"]');
                storyLink.click();
                console.log(`[成功] 为 ${qualityName} 换装完成！`);
                button.style.backgroundColor = 'lightgreen';
            } catch (error) {
                console.error('快速换装流程失败:', error);
                alert(`操作失败: ${error.message}`);
                button.style.backgroundColor = 'red';
            } finally {
                setTimeout(() => { button.style.backgroundColor = originalColor; }, 1500);
            }
        });

        return button;
    }
    
    function findAndManageButtons() {
        Object.keys(targetQualitiesConfig).forEach(qualityName => {
            const iconDiv = document.querySelector(`div[aria-label="${qualityName}"]`);
            if (!iconDiv) return;

            const qualityItemContainer = iconDiv.closest('.sidebar-quality');
            if (!qualityItemContainer) return;
            const existingButton = qualityItemContainer.querySelector('.fast-equip-button');
            const correctAnchor = qualityItemContainer.querySelector('.item__adjust') || qualityItemContainer.querySelector('.item__value');
            if (!correctAnchor) return;

            if (!existingButton) {
                const newButton = createEquipButton(qualityName);
                correctAnchor.insertAdjacentElement('afterend', newButton);
            } else {
                if (correctAnchor.nextElementSibling !== existingButton) {
                    correctAnchor.insertAdjacentElement('afterend', existingButton);
                }
            }
        });
    }
    // ======================================================================

    const observer = new MutationObserver(findAndManageButtons);
    observer.observe(document.body, { childList: true, subtree: true });
    findAndManageButtons(); // 初始执行
})();
