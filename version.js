// 脚本主函数，接收目标 button1
function startScript(button1) {
    // 询问用户输入的循环次数
    var userInput = prompt('请输入要循环点击的次数:', '10');
    var maxClicks = parseInt(userInput, 10);

    // 检查用户输入是否有效，如果无效则终止脚本
    if (isNaN(maxClicks) || maxClicks <= 0) {
        alert('输入无效，脚本已终止');
        console.error('输入无效，脚本终止');
    } else {
        var clickCount = 0;
        var mainInterval;
        var scriptRunning = true;

        function findButton2() {
            var buttons2 = document.querySelectorAll('.button.button--primary');
            var button2;
            buttons2.forEach(function(button) {
                if (button.textContent.trim() === 'Try again') {
                    button2 = button;
                }
            });
            return button2;
        }

        function clickButton1AndCheck() {
            if (!scriptRunning) return;

            if (button1 && !button1.disabled) {
                button1.click();
                clickButton2WhenAvailable();
            } else {
                alert('Button1 is disabled or not set. Terminating the script.');
                console.error('Button1 is disabled or not set, script terminates.');
                stopScript();
            }
        }

        function clickButton2WhenAvailable() {
            var checkButton2Interval = setInterval(function() {
                if (!scriptRunning) {
                    clearInterval(checkButton2Interval);
                    return;
                }

                var button2 = findButton2();
                if (button2) {
                    button2.click();
                    clearInterval(checkButton2Interval);
                    console.log('button2 clicked');
                    
                    // 延长检查button1出现的等待时间
                    setTimeout(() => {
                        var checkButton1Interval = setInterval(function() {
                            if (!scriptRunning) {
                                clearInterval(checkButton1Interval);
                                return;
                            }

                            if (button1 && !button1.disabled) {
                                clearInterval(checkButton1Interval);
                                clickCount++;
                                console.log('button1 is ready for next click');
                                
                                if (clickCount >= maxClicks) {
                                    stopScript();
                                    console.log('点击结束');
                                }
                            }
                        }, 2000); // 增加时间间隔：每 2000 毫秒检测一次

                    }, 5000); // 增加首次触发的延迟：延迟 5000 毫秒后开始检测
                } else {
                    console.log('Waiting for button2 to appear...');
                }
            }, 500); // 每 500 毫秒检测一次
        }

        // 主循环定时器启动
        mainInterval = setInterval(clickButton1AndCheck, 3000); // 每 3000 毫秒执行一次主函数

        function stopScript() {
            scriptRunning = false;
            if (mainInterval) {
                clearInterval(mainInterval);
                mainInterval = null;
            }
            console.log('脚本已手动停止');
        }
    }
}

// 执行函数以添加脚本按钮到所有目标按钮前
addScriptButtons();