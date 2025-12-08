// ==UserScript==
// @name         Fallen London Air Auto-Clicker
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  基于状态机的自动挂机脚本：搜索->换装->点击Go->点击Onward
// @author       Xeo
// @match        https://www.fallenlondon.com/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // ================= 配置区域 =================
  const TARGET_BRANCHES = [
    { title: "Haul well water to the roots", priority: 80 },
    { title: "Adjust the sentiment balance of the soil", priority: 100 },
    { title: "Sneak up on thieving urchins", priority: 80 },
    {
      title: "Call upon the Sneering Horticulturalist's knowledge",
      priority: 120,
    },
    {
      title: "Place blossoms on the boughs with the Wizened Botanist",
      priority: 120,
    },
    { title: "Rearrange existing decorations", priority: 100 },
    { title: "Ferry some state-sanctioned sunlight", priority: 120 },
  ];

  // ================= 状态定义 =================
  const STATES = {
    IDLE: "IDLE", // 停止状态
    SEARCH_BRANCH: "SEARCH_BRANCH", // 1. 寻找目标分支
    CHECK_OUTFIT: "CHECK_OUTFIT", // 2. 检查/切换装备
    CLICK_GO: "CLICK_GO", // 3. 点击 Go
    WAIT_ONWARD: "WAIT_ONWARD", // 4. 等待结果并点击 Onward
  };

  // ================= 全局变量 =================
  let currentState = STATES.IDLE;
  let isRunning = false;

  // 缓存当前要操作的目标信息
  let currentTarget = {
    title: null,
    challengeType: null,
    priority: 0,
  };

  let currentEquippedStat = null;

  // 记录进入 WAIT_ONWARD 状态的时间
  let waitOnwardStartTime = 0;
  const MIN_WAIT_ONWARD_TIME = 2000; // 最少等待2秒

  // ================= UI 界面 =================
  function createControlPanel() {
    const btn = document.createElement("button");
    btn.id = "fl-fsm-btn";
    btn.textContent = "启动挂机";
    Object.assign(btn.style, {
      position: "fixed",
      top: "120px",
      right: "20px",
      zIndex: "9999",
      padding: "10px 15px",
      backgroundColor: "#888",
      color: "white",
      border: "2px solid #fff",
      borderRadius: "5px",
      cursor: "pointer",
      fontWeight: "bold",
      boxShadow: "0 2px 5px rgba(0,0,0,0.5)",
    });

    btn.onclick = function () {
      isRunning = !isRunning;
      if (isRunning) {
        // 启动时重置装备记录（首次会换装）
        currentEquippedStat = null;
        console.log("[FSM] 脚本启动");
        // 启动时重置为搜索状态
        currentState = STATES.SEARCH_BRANCH;
        runStateMachine();
      } else {
        currentState = STATES.IDLE;
        console.log("[FSM] 脚本停止。");
      }
      updateButtonState(btn);
    };
    document.body.appendChild(btn);
  }

  function updateButtonState(btn) {
    if (isRunning) {
      const statInfo = currentEquippedStat ? ` [${currentEquippedStat}]` : "";
      btn.textContent = `运行中: ${currentStateToText()}${statInfo}`;
      btn.style.backgroundColor = "#2ecc71";
    } else {
      btn.textContent = "启动挂机 (已停止)";
      btn.style.backgroundColor = "#e74c3c";
    }
  }

  function currentStateToText() {
    switch (currentState) {
      case STATES.SEARCH_BRANCH:
        return "搜索中...";
      case STATES.CHECK_OUTFIT:
        return "换装中...";
      case STATES.CLICK_GO:
        return "点击GO...";
      case STATES.WAIT_ONWARD:
        return "等待结果...";
      default:
        return "停止";
    }
  }

  // ================= 辅助函数 =================

  function getChallengeType(branchElement) {
    const challengeImg = branchElement.querySelector(".challenge .js-icon img");
    if (challengeImg) {
      return (
        challengeImg.getAttribute("aria-label") ||
        challengeImg.getAttribute("alt")
      );
    }
    return null;
  }

  function findSidebarEquipButton(challengeType) {
    if (!challengeType) return null;
    const sidebarItems = Array.from(
      document.querySelectorAll(".sidebar-quality")
    );
    const targetItem = sidebarItems.find((item) => {
      const nameEl = item.querySelector(".item__name");
      return nameEl && nameEl.textContent.trim() === challengeType;
    });
    if (!targetItem) return null;
    return targetItem.querySelector(".fast-equip-button");
  }

  // ================= 状态机核心逻辑 =================

  function runStateMachine() {
    if (!isRunning || currentState === STATES.IDLE) return;

    // 更新按钮上的状态显示
    const btn = document.getElementById("fl-fsm-btn");
    if (btn) updateButtonState(btn);

    switch (currentState) {
      // --- 阶段 1: 搜索分支 ---
      case STATES.SEARCH_BRANCH:
        const branches = Array.from(document.querySelectorAll(".media.branch"));
        let candidates = [];

        branches.forEach((branch) => {
          const titleEl = branch.querySelector(".branch__title");
          if (!titleEl) return;
          const title = titleEl.textContent.trim();
          const goButton = branch.querySelector("button.button--go");
          // 确保按钮存在且未禁用
          if (!goButton || goButton.disabled) return;

          const config = TARGET_BRANCHES.find((t) => t.title === title);
          if (config) {
            candidates.push({ element: branch, ...config });
          }
        });

        if (candidates.length > 0) {
          // 排序并取最高优先级
          candidates.sort((a, b) => b.priority - a.priority);
          const best = candidates[0];

          // 记录目标信息
          currentTarget.title = best.title;
          currentTarget.challengeType = getChallengeType(best.element);

          console.log(
            `[FSM] 找到目标: "${best.title}" (挑战: ${currentTarget.challengeType})`
          );

          // 状态流转 -> 检查装备
          currentState = STATES.CHECK_OUTFIT;
          // 立即尝试下一阶段，不等待Observer
          runStateMachine();
        } else {
          // 没找到分支，可能还在结果页没出来？或者加载中
          // 安全机制：如果此时却出现了 ONWARD 按钮，说明状态机错位了（比如手动点了一下），强行跳转到处理Onward
          checkForStrayOnward();
        }
        break;

      // --- 阶段 2: 检查/切换装备 ---
      case STATES.CHECK_OUTFIT:
        // 如果不需要换装，直接跳过
        if (!currentTarget.challengeType) {
          console.log("[FSM] 无需换装（Luck挑战或其他）");
          currentState = STATES.CLICK_GO;
          runStateMachine();
          return;
        }

        // 核心优化：检查是否已经装备了正确的属性
        if (currentEquippedStat === currentTarget.challengeType) {
          console.log(
            `[FSM] 装备已是目标属性 (${currentTarget.challengeType})，跳过换装`
          );
          currentState = STATES.CLICK_GO;
          runStateMachine();
          return;
        }

        const equipBtn = findSidebarEquipButton(currentTarget.challengeType);
        if (!equipBtn) {
          console.log("[FSM] 没有找到换装按钮，直接进行");
          currentState = STATES.CLICK_GO;
          runStateMachine();
          return;
        }

        console.log(
          `[FSM] 需要换装: ${currentEquippedStat || "未知"} -> ${
            currentTarget.challengeType
          }`
        );
        equipBtn.click();

        // 记录当前装备的属性
        currentEquippedStat = currentTarget.challengeType;

        // 点击换装后，页面会刷新/加载，等待下次触发
        // 下次进入这个状态时，会因为 currentEquippedStat 匹配而直接跳过
        break;

      // --- 阶段 3: 点击 Go ---
      case STATES.CLICK_GO:
        const allBranches = Array.from(
          document.querySelectorAll(".media.branch")
        );
        const targetBranch = allBranches.find((b) => {
          const t = b.querySelector(".branch__title");
          return t && t.textContent.trim() === currentTarget.title;
        });

        if (targetBranch) {
          const goBtn = targetBranch.querySelector("button.button--go");
          if (goBtn && !goBtn.disabled) {
            console.log(`[FSM] 点击 GO -> "${currentTarget.title}"`);
            goBtn.click();
            // 状态流转 -> 等待结果
            currentState = STATES.WAIT_ONWARD;
            waitOnwardStartTime = Date.now(); // 记录进入等待状态的时间
          } else {
            console.log("[FSM] 异常：Go按钮不可用，重置回搜索");
            currentState = STATES.SEARCH_BRANCH;
          }
        } else {
          console.log("[FSM] 异常：目标分支消失，重置回搜索");
          currentState = STATES.SEARCH_BRANCH;
        }
        break;

      // --- 阶段 4: 等待 Onward ---
      case STATES.WAIT_ONWARD:
        // 检查是否已经等待足够的时间
        const elapsedTime = Date.now() - waitOnwardStartTime;
        if (elapsedTime < MIN_WAIT_ONWARD_TIME) {
          console.log(`[FSM] 等待结果页加载... (已等待 ${elapsedTime}ms)`);
          return; // 提前退出，等下次触发
        }

        // 查找主要的继续按钮
        const actionButtons = Array.from(
          document.querySelectorAll(
            ".buttons--storylet-exit-options .button--primary, .storylet__buttons .button--primary"
          )
        );
        const onwardBtn = actionButtons.find((btn) => {
          const text = btn.textContent.trim().toUpperCase();
          return (
            text.includes("ONWARDS") ||
            text.includes("CONTINUE") ||
            text.includes("RETURN") ||
            text.includes("PERHAPS NOT")
          );
        });

        if (onwardBtn) {
          console.log("[FSM] 结果页：点击 ONWARD");
          onwardBtn.click();
          // 状态流转 -> 循环结束，回到搜索
          currentState = STATES.SEARCH_BRANCH;
          waitOnwardStartTime = 0; // 重置计时器
        } else {
          // 如果等待超过10秒还没找到按钮，可能出问题了
          if (elapsedTime > 10000) {
            console.log("[FSM] 异常：等待超时（10秒），重置回搜索");
            currentState = STATES.SEARCH_BRANCH;
            waitOnwardStartTime = 0;
          }
        }
        break;
    }
  }

  // 补充：防止状态机卡死在搜索状态，如果当前已经在结果页了
  function checkForStrayOnward() {
    const actionButtons = Array.from(
      document.querySelectorAll(".storylet__buttons .button--primary")
    );
    const onwardBtn = actionButtons.find((btn) => {
      const text = btn.textContent.trim().toUpperCase();
      return text.includes("ONWARD") || text.includes("CONTINUE");
    });
    if (onwardBtn) {
      console.log("[FSM] 纠错：搜索模式下发现了 Onward 按钮，自动点击");
      onwardBtn.click();
    }
  }

  // ================= 初始化与监听 =================

  window.addEventListener("load", createControlPanel);

  // 备用：如果页面SPA跳转导致按钮消失
  setInterval(() => {
    if (!document.getElementById("fl-fsm-btn")) {
      createControlPanel();
      if (isRunning) {
        // 如果按钮重建，更新状态显示
        updateButtonState(document.getElementById("fl-fsm-btn"));
      }
    }
  }, 2000);

  // 核心驱动：DOM 变化驱动状态机
  let throttleTimer = null;
  const observer = new MutationObserver((mutations) => {
    if (!isRunning) return;

    if (throttleTimer) return;

    // 根据当前状态动态调整延迟
    let delay = 800;
    if (currentState === STATES.WAIT_ONWARD) {
      delay = 1500; // 等待结果时使用更长延迟
    }

    throttleTimer = setTimeout(() => {
      runStateMachine();
      throttleTimer = null;
    }, delay);
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
