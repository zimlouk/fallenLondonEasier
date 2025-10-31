// ==UserScript==
// @name         Fallen London - Fast Equip via UI
// @namespace    http://tampermonkey.net/
// @version      0.9
// @description  Adds an intelligent button to specific qualities to quickly equip gear
// @author       Xeo
// @match        https://www.fallenlondon.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // =================  配置区  =================
    const targetQualitiesConfig = {
        'Watchful': 209,
        'Shadowy': 210,
        'Dangerous': 211,
        'Persuasive': 212
    };
    // ===========================================

    // --- 辅助函数 ---
    function waitForElement(selector, parent = document, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const intervalTime = 100;
            let timeWaited = 0;
            const interval = setInterval(() => {
                const element = parent.querySelector(selector);
                if (element) {
                    clearInterval(interval);
                    resolve(element);
                } else {
                    timeWaited += intervalTime;
                    if (timeWaited >= timeout) {
                        clearInterval(interval);
                        reject(new Error(`等待元素 "${selector}" 出现超时`));
                    }
                }
            }, intervalTime);
        });
    }

    /**
     * [新增] 等待指定元素从DOM中消失
     * @param {string} selector - CSS选择器
     * @param {HTMLElement} parent - 父元素，默认为 document
     * @param {number} timeout - 超时时间 (毫秒)
     * @returns {Promise<void>} - 元素消失后 resolve
     */
    function waitForElementToDisappear(selector, parent = document, timeout = 15000) {
        return new Promise((resolve, reject) => {
            const intervalTime = 100;
            let timeWaited = 0;
            const interval = setInterval(() => {
                const element = parent.querySelector(selector);
                if (!element) {
                    clearInterval(interval);
                    resolve();
                } else {
                    timeWaited += intervalTime;
                    if (timeWaited >= timeout) {
                        clearInterval(interval);
                        reject(new Error(`等待元素 "${selector}" 消失超时`));
                    }
                }
            }, intervalTime);
        });
    }


    function simulateFullClick(element) {
        if (!element) throw new Error("尝试点击一个不存在的元素");
        const dispatch = (eventName) => {
            const event = new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window });
            element.dispatchEvent(event);
        };
        dispatch('mouseover');
        dispatch('mousedown');
        dispatch('mouseup');
        dispatch('click');
    }

    const delay = ms => new Promise(res => setTimeout(res, ms));


    // 创建并添加按钮的函数
    function addButtonTo(targetElement, qualityName, associatedValue) {
        if (targetElement.dataset.buttonAdded === 'true') return;

        const button = document.createElement('span');
        const originalColor = 'rgb(237, 227, 210)';
        // ... 样式
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

                // 1. 点击 "Possessions" 链接
                console.log('步骤 1: 点击 "Possessions"');
                const possessionsLink = document.querySelector('a.cursor-pointer[href="/possessions"]');
                if (!possessionsLink) throw new Error('找不到 "Possessions" 链接');
                possessionsLink.click();

                // 等待 possessions 页面加载
                await waitForElement('span.heading.heading--3');

                // 2. 定位 "items" 容器
                const containers = document.querySelectorAll('div[style^="align-items: baseline"]');
                const itemsContainer = Array.from(containers).find(c => c.querySelector('span.heading.heading--3')?.textContent.trim() === 'items');
                if (!itemsContainer) throw new Error('找不到 "items" 标题的容器');

                // --- 检查下拉菜单当前值 ---
                const currentValueDiv = itemsContainer.querySelector('.css-gj4dr3-singleValue');
                if (!currentValueDiv) throw new Error('找不到下拉菜单的当前值显示元素');
                const currentValueText = currentValueDiv.textContent.trim();

                if (currentValueText === qualityName) {
                    console.log(`优化：下拉菜单已是 "${qualityName}"，跳过选择步骤。`);
                } else {
                    console.log(`下拉菜单当前值为 "${currentValueText}"，需要更改为 "${qualityName}"。`);

                    // 2.1 打开下拉菜单
                    const categoryDropdown = itemsContainer.querySelector('div.css-f92gjm-control');
                    if (!categoryDropdown) throw new Error('在"items"容器中找不到下拉菜单');
                    const openEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
                    categoryDropdown.dispatchEvent(openEvent);
                    await delay(100);

                    // 3. 在下拉菜单中找到并点击选项
                    const listBox = await waitForElement('div[role="listbox"]');
                    const options = listBox.querySelectorAll('div[role="option"]');
                    const targetOption = Array.from(options).find(opt => opt.textContent.trim() === qualityName);
                    if (!targetOption) {
                        document.querySelector('a.cursor-pointer[href="/"]')?.click();
                        throw new Error(`在下拉菜单中找不到选项 "${qualityName}"`);
                    }
                    simulateFullClick(targetOption);
                }

                // 4. 等待并点击 "Equip Highest" 按钮
                console.log('步骤 4: 等待并点击 "Equip Highest"');
                await delay(200); // 等待页面状态更新
                const equipButton = await waitForElement('button.button--primary', document, 10000);
                if (!equipButton || !equipButton.textContent.includes('Equip Highest')) {
                    throw new Error('找不到 "Equip Highest" 按钮');
                }
                simulateFullClick(equipButton);

                // 4.5 等待换装完成
                console.log('步骤 4.5: 等待换装完成...');
                const changingSlotSelector = '.equipment-slot--is-changing';
                try {
                    // 等待换装动画开始（即出现 is-changing 状态），超时2秒
                    await waitForElement(changingSlotSelector, document, 2000);
                    console.log('检测到换装状态，正在等待完成...');
                } catch (e) {
                    // 如果2秒内没等到，可能换装瞬间完成或没有可换的装备。打印警告但继续执行。
                    console.warn('未检测到 "is-changing" 状态，可能换装极快或未发生。继续执行...');
                }
                // 等待 is-changing 状态消失
                await waitForElementToDisappear(changingSlotSelector, document, 15000);
                console.log('换装完成！');

                // 5. 点击 "Story" 链接返回主页
                console.log('步骤 5: 点击 "Story" 返回主页');
                const storyLink = await waitForElement('a.cursor-pointer[href="/"]');
                storyLink.click();

                console.log(`[成功] 为 ${qualityName} 换装完成！`);
                button.style.backgroundColor = 'lightgreen';

            } catch (error) {
                console.error('快速换装流程失败:', error);
                alert(`操作失败: ${error.message}`);
                button.style.backgroundColor = 'red';
            } finally {
                setTimeout(() => {
                    button.style.backgroundColor = originalColor;
                }, 1500);
            }
        });

        targetElement.insertAdjacentElement('afterend', button);
        targetElement.dataset.buttonAdded = 'true';
    }

    function findAndAddButtons() {
        Object.keys(targetQualitiesConfig).forEach(qualityName => {
            const iconDiv = document.querySelector(`div[aria-label="${qualityName}"]`);
            if (!iconDiv) return;
            const qualityItemContainer = iconDiv.closest('.sidebar-quality');
            if (!qualityItemContainer) return;
            const adjustSpan = qualityItemContainer.querySelector('.item__adjust');
            if (adjustSpan) {
                const associatedValue = targetQualitiesConfig[qualityName];
                addButtonTo(adjustSpan, qualityName, associatedValue);
            }
        });
    }

    const observer = new MutationObserver(findAndAddButtons);
    observer.observe(document.body, { childList: true, subtree: true });
    findAndAddButtons();
})();
