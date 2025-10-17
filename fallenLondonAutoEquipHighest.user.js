// ==UserScript==
// @name         fallenLondonAutoEquipHighest
// @namespace    http://tampermonkey.net/
// @version      0.5
// @description  Adds a button to specific qualities to automatically equip the highest bonus gear and then reloads the page.
// @description:zh-CN 为Fallen London侧边栏的特定属性添加按钮，点击后自动换装并刷新页面。
// @author       xeo
// @match        https://www.fallenlondon.com/*
// @grant        GM_xmlhttpRequest
// @connect      api.fallenlondon.com
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

    // 创建并添加按钮的函数
    function addButtonTo(targetElement, qualityName, associatedValue) {
        if (targetElement.dataset.buttonAdded === 'true') {
            return;
        }

        const button = document.createElement('span');
        const originalColor = 'rgb(237, 227, 210)';
        button.style.backgroundColor = originalColor;
        button.style.border = '1px solid #999';
        button.style.display = 'inline-block';
        button.style.width = '12px';
        button.style.height = '12px';
        button.style.marginLeft = '5px';
        button.style.cursor = 'pointer';
        button.style.verticalAlign = 'middle';
        button.title = `点击为 '${qualityName}' 自动换装`;
        button.style.transition = 'background-color 0.3s ease';


        button.addEventListener('click', (event) => {
            event.stopPropagation();

            const authToken = localStorage.getItem('access_token');
            if (!authToken) {
                console.error('无法在 localStorage 中找到 "access_token"');
                alert('自动换装失败：找不到用户授权信息(access_token)，请确保您已登录。');
                return;
            }

            console.log(`准备为 ${qualityName} (ID: ${associatedValue}) 换装...`);
            button.style.backgroundColor = 'orange'; // 等待状态

            GM_xmlhttpRequest({
                method: "POST",
                url: "https://api.fallenlondon.com/api/outfit/equipHighest",
                headers: {
                    "Authorization": `Bearer ${authToken}`,
                    "Content-Type": "application/json",
                    "Accept": "application/json, */*"
                },
                data: JSON.stringify({ "qualityId": associatedValue }),
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        console.log(`为 ${qualityName} 换装成功!`);
                        button.style.backgroundColor = 'lightgreen'; // 成功状态
                        setTimeout(() => {
                            location.reload();
                        }, 500); // 延迟0.5秒后刷新

                    } else {
                        console.error(`换装请求失败，状态码: ${response.status}`, response.responseText);
                        button.style.backgroundColor = 'red'; // 失败状态
                        // 失败后1.5秒恢复原色
                        setTimeout(() => { button.style.backgroundColor = originalColor; }, 1500);
                    }
                },
                onerror: function(response) {
                    console.error('网络请求错误:', response);
                    alert(`网络请求错误: ${response.statusText}`);
                    button.style.backgroundColor = 'red'; // 失败状态
                    setTimeout(() => { button.style.backgroundColor = originalColor; }, 1500);
                }
            });
        });

        targetElement.insertAdjacentElement('afterend', button);
        targetElement.dataset.buttonAdded = 'true';
    }

    // 查找并添加按钮的函数
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

    // MutationObserver
    const observer = new MutationObserver(findAndAddButtons);
    observer.observe(document.body, { childList: true, subtree: true });
    findAndAddButtons();

})();
