// ==UserScript==
// @name         Fallen London - Fast Equip via UI
// @namespace    http://tampermonkey.net/
// @version      0.8
// @description  Adds a button to specific qualities to quickly equip the highest bonus gear by automating UI clicks.
// @description:zh-CN 通过模拟UI点击，为Fallen London侧边栏的特定属性添加按钮，实现全自动快速换装。
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
                        reject(new Error(`等待元素 "${selector}" 超时`));
                    }
                }
            }, intervalTime);
        });
    }

    /**
     * @param {Element} element - 要点击的元素
     */
    function simulateFullClick(element) {
        if (!element) throw new Error("尝试点击一个不存在的元素");

        const dispatch = (eventName) => {
            const event = new MouseEvent(eventName, {
                bubbles: true,
                cancelable: true,
                view: window
            });
            element.dispatchEvent(event);
        };

        dispatch('mouseover'); // 鼠标悬浮
        dispatch('mousedown'); // 按下
        dispatch('mouseup');   // 抬起
        dispatch('click');     // 完成点击
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

                // 2. 定位并点击正确的下拉菜单
                console.log('步骤 2: 等待并定位正确的下拉菜单');
                await waitForElement('div.css-13ab8kc-container');
                const containers = document.querySelectorAll('div[style^="align-items: baseline"]');
                const itemsContainer = Array.from(containers).find(c => c.querySelector('span.heading.heading--3')?.textContent.trim() === 'items');
                if (!itemsContainer) throw new Error('找不到 "items" 标题的容器');

                const categoryDropdown = itemsContainer.querySelector('div.css-f92gjm-control');
                if (!categoryDropdown) throw new Error('在"items"容器中找不到下拉菜单');

                console.log('步骤 2.1: 点击下拉菜单');
                // 打开下拉菜单通常只需要一个简单的 mousedown
                const openEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
                categoryDropdown.dispatchEvent(openEvent);
                await delay(100);

                // 3. 在下拉菜单中找到并【完整点击】对应的选项
                console.log(`步骤 3: 寻找并点击 "${qualityName}" 选项`);
                const listBox = await waitForElement('div[role="listbox"]');
                const options = listBox.querySelectorAll('div[role="option"]');
                const targetOption = Array.from(options).find(opt => opt.textContent.trim() === qualityName);
                if (!targetOption) {
                    document.querySelector('a.cursor-pointer[href="/"]')?.click();
                    throw new Error(`在下拉菜单中找不到选项 "${qualityName}"`);
                }
                simulateFullClick(targetOption);

                // 4. 等待并点击 "Equip Highest" 按钮
                console.log('步骤 4: 等待并点击 "Equip Highest"');
                await delay(200); // 等待选项点击后页面状态更新
                const equipButton = await waitForElement('button.button--primary', document, 10000);
                if (!equipButton || !equipButton.textContent.includes('Equip Highest')) {
                    throw new Error('找不到 "Equip Highest" 按钮');
                }
                simulateFullClick(equipButton);

                await delay(500);

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
