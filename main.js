import { Adb, ADB_DEFAULT_AUTHENTICATORS } from "@yume-chan/adb";
import { AdbWebUsbBackendManager } from "@yume-chan/adb-backend-webusb";
import { WrapConsumableStream } from "@yume-chan/stream-extra";

let adb = null;
const Manager = AdbWebUsbBackendManager.BROWSER;

// init.json 路径（根目录）
const INIT_JSON_PATH = "/sdcard/init.json";
// 录屏文件夹路径
const SCREEN_RECORDER_PATH = "/sdcard/ScreenRecorder";

// 存储视频文件列表
let videoFiles = [];

// 密钥存储（持久化到 localStorage，避免每次连接都要重新授权）
const CredentialStore = {
    async generateKey() {
        const keyPair = await crypto.subtle.generateKey(
            {
                name: "RSASSA-PKCS1-v1_5",
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: "SHA-1",
            },
            true,
            ["sign"]
        );
        const privateKey = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
        const keyBytes = new Uint8Array(privateKey);
        localStorage.setItem("adb_private_key", JSON.stringify(Array.from(keyBytes)));
        return keyBytes;
    },
    *iterateKeys() {
        const stored = localStorage.getItem("adb_private_key");
        if (stored) {
            yield new Uint8Array(JSON.parse(stored));
        }
    },
};

// ========== 平台检测 ==========

// 获取当前平台信息
function getPlatformInfo() {
    const ua = navigator.userAgent;
    const platform = navigator.userAgentData?.platform || navigator.platform || '';

    return {
        isIOS: /iPhone|iPad|iPod/.test(ua),
        isMac: /Mac/.test(platform),
        isWindows: /Win/.test(platform),
        isLinux: /Linux/.test(platform) && !/Android/.test(ua),
        isAndroid: /Android/.test(ua),
        isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua),
        supportsWebUSB: !!navigator.usb,
        browser: (() => {
            if (ua.includes('Edg/')) return 'Edge';
            if (ua.includes('Chrome/')) return 'Chrome';
            if (ua.includes('Safari/') && !ua.includes('Chrome')) return 'Safari';
            if (ua.includes('Firefox/')) return 'Firefox';
            return 'Unknown';
        })()
    };
}

// 获取针对当前平台的 ADB kill 命令
function getKillAdbCommand() {
    const info = getPlatformInfo();

    if (info.isMac) {
        return {
            commands: 'adb kill-server && killall adb',
            commandsArray: ['adb kill-server', 'killall adb'],
            instructions: `⚠️ USB 接口被占用！

🔧 macOS 解决方案：
1️⃣ 打开"终端"（Terminal）
   快捷键：Command + Space，输入 Terminal

2️⃣ 粘贴运行以下命令：
   adb kill-server
   
3️⃣ 如果还不行，再运行：
   killall adb

4️⃣ 关闭这些程序（如果在运行）：
   • Android Studio
   • Vysor
   • scrcpy

5️⃣ 刷新网页后重新连接

✅ 命令已复制到剪贴板！`
        };
    } else if (info.isWindows) {
        return {
            commands: 'adb kill-server\ntaskkill /F /IM adb.exe',
            commandsArray: ['adb kill-server', 'taskkill /F /IM adb.exe'],
            instructions: `⚠️ USB 接口被占用！

🔧 Windows 解决方案：
1️⃣ 打开"命令提示符"（CMD）
   快捷键：Win + R，输入 cmd，回车

2️⃣ 粘贴运行以下命令：
   adb kill-server
   
3️⃣ 如果还不行，再运行：
   taskkill /F /IM adb.exe

4️⃣ 关闭这些程序（如果在运行）：
   • Android Studio
   • Vysor
   • scrcpy

5️⃣ 刷新网页后重新连接

✅ 命令已复制到剪贴板！`
        };
    } else if (info.isLinux) {
        return {
            commands: 'adb kill-server\nkillall adb',
            commandsArray: ['adb kill-server', 'killall adb'],
            instructions: `⚠️ USB 接口被占用！

🔧 Linux 解决方案：
1️⃣ 打开终端
   快捷键：Ctrl + Alt + T

2️⃣ 粘贴运行以下命令：
   adb kill-server
   
3️⃣ 如果还不行，再运行：
   killall adb

4️⃣ 刷新网页后重新连接

✅ 命令已复制到剪贴板！`
        };
    } else {
        return {
            commands: 'adb kill-server',
            commandsArray: ['adb kill-server'],
            instructions: `⚠️ USB 接口被占用！

请在终端运行：adb kill-server
然后刷新网页重新连接`
        };
    }
}

// 检查浏览器兼容性
function checkCompatibility() {
    const info = getPlatformInfo();

    // iOS 设备完全不支持
    if (info.isIOS) {
        return {
            supported: false,
            title: '⚠️ iOS 设备不支持',
            message: `很抱歉，此工具无法在 iPhone/iPad 上使用。

❌ 原因：
• iOS Safari 不支持 WebUSB API
• iOS 系统禁止直接访问 USB 设备
• 苹果安全策略限制

✅ 请使用以下设备访问：
• Windows 电脑 + Chrome/Edge 浏览器
• macOS 电脑 + Chrome 浏览器  
• Linux 电脑 + Chrome 浏览器

💡 然后通过 USB 连接你的 Android 设备`
        };
    }

    // Android 手机
    if (info.isAndroid) {
        return {
            supported: false,
            title: '⚠️ Android 手机不支持',
            message: `此工具需要在电脑上使用。

❌ 原因：
• 移动浏览器功能受限
• 无法通过手机连接另一个设备

✅ 请使用电脑访问：
• Windows 电脑 + Chrome/Edge 浏览器
• macOS 电脑 + Chrome 浏览器
• Linux 电脑 + Chrome 浏览器`
        };
    }

    // 其他移动设备
    if (info.isMobile) {
        return {
            supported: false,
            title: '⚠️ 移动设备不支持',
            message: `此工具需要在电脑上使用。

✅ 请使用：
• Windows/Mac/Linux 电脑
• Chrome 或 Edge 浏览器`
        };
    }

    // 检查 WebUSB 支持
    if (!info.supportsWebUSB) {
        return {
            supported: false,
            title: '⚠️ 浏览器不支持 WebUSB',
            message: `当前浏览器：${info.browser}

✅ 请使用以下浏览器：
• Google Chrome 89+
• Microsoft Edge 89+
• Opera 75+

❌ 不支持的浏览器：
• Firefox（暂不支持 WebUSB）
• Safari（不支持 WebUSB）
• IE（已停止支持）

💡 推荐：下载安装 Google Chrome 浏览器`
        };
    }

    return { supported: true };
}

// 执行 shell 命令
async function execCommand(cmd) {
    if (!adb) throw new Error("请先连接设备");

    const socket = await adb.createSocket(`shell:${cmd}`);
    let result = "";
    const reader = socket.readable.getReader();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += new TextDecoder().decode(value);
    }

    return result.trim();
}

// 更新输出
function output(text) {
    document.getElementById("output").textContent = text;
}

// 更新选中数量
function updateSelectedCount() {
    const checkboxes = document.querySelectorAll('.video-checkbox:checked');
    const count = checkboxes.length;
    document.getElementById("selectedCount").textContent = count;
    document.getElementById("exportVideosBtn").disabled = count === 0;
}

// ========== 连接设备 ==========
async function connectADB() {
    try {
        const statusEl = document.getElementById("status");
        statusEl.textContent = "🔄 连接中...";
        statusEl.style.color = "#0078d4";

        const device = await Manager.requestDevice();
        if (!device) throw new Error("未选择设备");

        const streams = await device.connect();
        adb = await Adb.authenticate(streams, CredentialStore, ADB_DEFAULT_AUTHENTICATORS);

        statusEl.textContent = `✅ 已连接: ${adb.product}`;
        statusEl.style.color = "#107c10";

        output(`✅ 连接成功！\n\n设备: ${adb.product}\n型号: ${adb.model}\n名称: ${adb.device}`);
    } catch (err) {
        document.getElementById("status").textContent = "❌ 连接失败";
        document.getElementById("status").style.color = "#d83b01";

        let msg = err.message;

        // 检测是否是 USB 接口被占用
        if (msg.includes("claimInterface") || msg.includes("claim interface")) {
            const { commands, instructions } = getKillAdbCommand();

            // 静默复制命令到剪贴板
            try {
                await navigator.clipboard.writeText(commands);
                output(instructions + `\n\n✅ 命令已自动复制到剪贴板，粘贴到终端运行即可。`);
            } catch (clipErr) {
                output(instructions + `\n\n📋 请手动复制以下命令到终端：\n${commands}`);
            }
        } else if (msg.includes("No device selected") || msg.includes("No device")) {
            output(`❌ 未选择设备\n\n💡 操作步骤：\n1. 点击"连接设备"按钮\n2. 在弹出的窗口中选择你的 Android 设备\n3. 点击"连接"\n\n⚠️ 注意事项：\n• 确保 USB 调试已开启\n• 确保已授权此电脑进行调试\n• 确保 USB 线支持数据传输（不是仅充电线）`);
        } else {
            output(`❌ 连接失败\n\n错误信息：${msg}\n\n💡 请检查：\n• USB 调试是否已开启\n• 是否已授权此电脑\n• USB 线是否支持数据传输\n• 尝试重新拔插 USB 线\n• 尝试更换 USB 接口`);
            console.error(err);
        }
    }
}

// 复制 ADB Kill 命令（独立功能）
async function copyKillAdbCommand() {
    const { commands, instructions } = getKillAdbCommand();

    try {
        await navigator.clipboard.writeText(commands);
        output(instructions + `\n\n✅ 命令已复制到剪贴板，粘贴到终端运行即可。`);
    } catch (err) {
        output(`📋 请手动复制以下命令到终端运行：\n\n${commands}\n\n` + instructions);
    }
}

// ========== init.json 管理 ==========

// 查看 init.json
async function viewInitJson() {
    if (!adb) return alert("请先连接设备");

    try {
        output("📄 读取 init.json...");
        const result = await execCommand(`cat ${INIT_JSON_PATH}`);

        if (result.includes("No such file")) {
            output("❌ init.json 不存在（自启动已禁用）");
        } else {
            output(`📄 init.json 内容:\n\n${result}`);
        }
    } catch (err) {
        output(`❌ 错误: ${err.message}`);
    }
}

// 备份 init.json
async function backupInitJson() {
    if (!adb) return alert("请先连接设备");

    try {
        output("💾 备份 init.json...");
        const backupPath = `/sdcard/init.json.backup.${Date.now()}`;
        const result = await execCommand(`cp ${INIT_JSON_PATH} ${backupPath} 2>&1`);

        if (result.includes("No such file")) {
            output("❌ init.json 不存在，无法备份");
        } else {
            output(`✅ 已备份到:\n${backupPath}`);
        }
    } catch (err) {
        output(`❌ 备份失败: ${err.message}`);
    }
}

// 删除 init.json
async function deleteInitJson() {
    if (!adb) return alert("请先连接设备");

    if (!confirm("⚠️ 确定要删除 init.json 吗？\n\n这将禁用自启动应用！")) {
        return;
    }

    try {
        output("🗑️ 删除 init.json...");
        await execCommand(`rm ${INIT_JSON_PATH}`);

        // 验证删除
        const check = await execCommand(`ls ${INIT_JSON_PATH} 2>&1`);
        if (check.includes("No such file")) {
            output("✅ init.json 已删除！\n\n自启动已禁用，重启设备生效。");
        } else {
            output("⚠️ 删除可能失败，请检查");
        }
    } catch (err) {
        output(`❌ 删除失败: ${err.message}`);
    }
}

// ========== 录屏文件管理 ==========

// 列出录屏文件（按时间排序）
async function listVideos() {
    if (!adb) return alert("请先连接设备");

    try {
        output("📂 正在查找录屏文件...\n");

        // 1. 查找所有视频文件并获取详细信息（包含修改时间）
        output("📂 扫描 ScreenRecorder 文件夹...");

        const findCmd = `find ${SCREEN_RECORDER_PATH} -type f \\( -iname "*.mp4" -o -iname "*.mov" -o -iname "*.avi" -o -iname "*.mkv" -o -iname "*.3gp" -o -iname "*.webm" \\) 2>/dev/null`;
        const allFiles = await execCommand(findCmd);

        if (!allFiles || allFiles.trim() === "") {
            output("❌ 没有找到视频文件\n\n可能原因:\n1. 文件夹为空\n2. 还没有录屏\n3. 视频格式不支持");
            document.getElementById("videoListContainer").style.display = "none";
            return;
        }

        const files = allFiles.split('\n').filter(f => f.trim());
        output(`找到 ${files.length} 个视频文件，正在获取详细信息...\n`);

        // 2. 获取每个文件的详细信息（包含时间戳）
        videoFiles = [];
        for (const filePath of files) {
            try {
                // 使用 stat 命令获取文件信息，包括时间戳
                const stat = await execCommand(`stat -c "%s %Y %n" "${filePath}" 2>/dev/null || ls -l "${filePath}"`);

                let size, timestamp, name;

                // 尝试解析 stat 输出 (格式: 字节数 时间戳 文件名)
                const statParts = stat.trim().split(/\s+/);
                if (statParts.length >= 3 && !stat.includes('total')) {
                    const bytes = parseInt(statParts[0]);
                    timestamp = parseInt(statParts[1]);
                    name = statParts.slice(2).join(' ').split('/').pop();

                    // 将字节转为可读格式
                    if (bytes < 1024) {
                        size = bytes + 'B';
                    } else if (bytes < 1024 * 1024) {
                        size = (bytes / 1024).toFixed(1) + 'K';
                    } else if (bytes < 1024 * 1024 * 1024) {
                        size = (bytes / 1024 / 1024).toFixed(1) + 'M';
                    } else {
                        size = (bytes / 1024 / 1024 / 1024).toFixed(1) + 'G';
                    }
                } else {
                    // 降级到 ls -l
                    const lsParts = stat.trim().split(/\s+/);
                    size = lsParts[4] || '?';
                    timestamp = 0; // 无法获取精确时间戳
                    name = filePath.split('/').pop();
                }

                // 格式化日期
                const date = timestamp ? new Date(timestamp * 1000).toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                }) : '未知';

                videoFiles.push({
                    path: filePath,
                    name,
                    size,
                    timestamp,
                    date
                });

            } catch (err) {
                console.error(`获取文件信息失败: ${filePath}`, err);
            }
        }

        if (videoFiles.length === 0) {
            output("\n❌ 无法获取文件详细信息");
            document.getElementById("videoListContainer").style.display = "none";
            return;
        }

        // 3. 按时间戳排序（新的在前）
        videoFiles.sort((a, b) => b.timestamp - a.timestamp);

        output(
            `✅ 找到 ${videoFiles.length} 个视频文件（已按时间排序）\n\n` +
            videoFiles.map((f, i) => `${i + 1}. ${f.name} (${f.size}) - ${f.date}`).join('\n') +
            `\n\n点击复选框选择要下载的视频`
        );

        // 4. 渲染文件列表（使用 Tailwind 样式）
        const videoListEl = document.getElementById("videoList");
        videoListEl.innerHTML = videoFiles.map((file, index) => `
        <div class="flex items-center gap-3 bg-white rounded p-2.5 mb-2 border-l-4 border-blue-600 hover:bg-blue-50 transition-colors">
            <input type="checkbox" class="video-checkbox w-5 h-5 cursor-pointer accent-blue-600" 
            id="video-${index}" data-index="${index}">
            <label for="video-${index}" class="flex-1 cursor-pointer text-sm">
            🎬 ${file.name}
            <span class="text-gray-600 text-xs ml-2">(${file.size} | ${file.date})</span>
            </label>
        </div>
        `).join('');

        // 添加复选框事件
        document.querySelectorAll('.video-checkbox').forEach(cb => {
            cb.addEventListener('change', updateSelectedCount);
        });

        document.getElementById("videoListContainer").style.display = "block";
        document.getElementById("selectAllVideos").checked = false;
        updateSelectedCount();

    } catch (err) {
        output(`❌ 错误: ${err.message}`);
        console.error(err);
    }
}

// 导出选中的视频（打包下载）
async function exportVideos() {
    if (!adb) return alert("请先连接设备");

    const selectedCheckboxes = document.querySelectorAll('.video-checkbox:checked');
    if (selectedCheckboxes.length === 0) {
        return alert("请先选择要下载的视频");
    }

    try {
        const selectedFiles = Array.from(selectedCheckboxes).map(cb => {
            const index = parseInt(cb.dataset.index);
            return videoFiles[index];
        });

        output(`📦 开始打包 ${selectedFiles.length} 个视频文件...\n`);

        const zip = new JSZip();
        const sync = await adb.sync();

        for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];

            try {
                output(`[${i + 1}/${selectedFiles.length}] 下载中: ${file.name}...`);

                // 下载文件
                const chunks = [];
                const stream = sync.read(file.path);
                const reader = stream.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                }

                // 添加到压缩包
                const blob = new Blob(chunks);
                zip.file(file.name, blob);

                output(`[${i + 1}/${selectedFiles.length}] ✅ ${file.name} (${file.size})`);

            } catch (err) {
                output(`[${i + 1}/${selectedFiles.length}] ❌ ${file.name} 失败: ${err.message}`);
            }
        }

        await sync.dispose();

        output(`\n📦 正在压缩文件...`);

        // 生成压缩包
        const zipBlob = await zip.generateAsync({
            type: "blob",
            compression: "DEFLATE",
            compressionOptions: { level: 6 }
        }, (metadata) => {
            output(`📦 压缩进度: ${metadata.percent.toFixed(1)}%`);
        });

        // 下载压缩包
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ScreenRecorder_${timestamp}.zip`;
        a.click();
        URL.revokeObjectURL(url);

        output(`\n✅ 打包完成！\n\n文件: ScreenRecorder_${timestamp}.zip\n大小: ${(zipBlob.size / 1024 / 1024).toFixed(2)} MB\n\n💡 检查浏览器下载文件夹`);

    } catch (err) {
        output(`❌ 导出失败: ${err.message}`);
        console.error(err);
    }
}


// ========== APK 管理 ==========

// 安装 APK
async function installApk() {
    if (!adb) return alert("请先连接设备");

    const fileInput = document.getElementById("apkFile");
    const file = fileInput.files[0];
    if (!file) return alert("请先选择 APK 文件");

    try {
        output(`⬆️ 正在上传: ${file.name}\n文件大小: ${(file.size / 1024 / 1024).toFixed(2)} MB\n`);

        // 1. 将 APK 推送到设备临时目录
        const remotePath = `/sdcard/tmp_install_${Date.now()}.apk`;
        const sync = await adb.sync();

        output(`📤 上传中，请稍候...`);
        // file.stream() 是浏览器原生分块 ReadableStream<Uint8Array>
        // WrapConsumableStream 将其转为 ReadableStream<Consumable<Uint8Array>>
        // 这是 sync 内部 DistributionStream 所期望的格式
        const stream = file.stream().pipeThrough(new WrapConsumableStream());
        await sync.write({
            filename: remotePath,
            file: stream,
            mode: 0o644,
            mtime: Math.floor(Date.now() / 1000),
        });
        await sync.dispose();

        output(`✅ 上传完成\n\n📦 正在安装...`);

        // 2. 通过 shell 安装
        const result = await execCommand(`pm install -r "${remotePath}"`);

        // 3. 清理临时文件
        await execCommand(`rm "${remotePath}"`);

        if (result.includes("Success")) {
            output(`✅ 安装成功！\n\n${file.name}`);
        } else {
            output(`❌ 安装失败\n\n${result}\n\n💡 常见原因：\n• 未开启「允许未知来源」\n• APK 与设备架构不兼容\n• 签名冲突（尝试先卸载旧版）`);
        }
    } catch (err) {
        output(`❌ 安装失败: ${err.message}`);
        console.error(err);
    }
}

// 卸载 APK
async function uninstallApk() {
    if (!adb) return alert("请先连接设备");

    const pkg = document.getElementById("uninstallPkg").value.trim();
    if (!pkg) return alert("请输入包名");

    if (!confirm(`⚠️ 确定要卸载 ${pkg} 吗？\n\n应用数据也将被删除！`)) return;

    try {
        output(`🗑️ 正在卸载: ${pkg}...`);
        const result = await execCommand(`pm uninstall ${pkg}`);

        if (result.includes("Success")) {
            output(`✅ 卸载成功！\n\n已卸载: ${pkg}`);
        } else {
            output(`❌ 卸载失败\n\n${result}\n\n💡 请确认包名是否正确，可点击「列出已安装应用」查看`);
        }
    } catch (err) {
        output(`❌ 卸载失败: ${err.message}`);
    }
}

// 列出已安装的第三方应用
async function listPackages() {
    if (!adb) return alert("请先连接设备");

    try {
        output(`📋 获取已安装应用列表...`);
        const result = await execCommand(`pm list packages -3`);

        if (!result) {
            output(`📋 没有找到第三方应用`);
            return;
        }

        const packages = result.split('\n')
            .map(line => line.replace('package:', '').trim())
            .filter(p => p)
            .sort();

        output(`📋 已安装第三方应用 (${packages.length} 个):\n\n` + packages.join('\n'));
    } catch (err) {
        output(`❌ 错误: ${err.message}`);
    }
}

// ========== 其他功能 ==========

// 执行自定义命令
async function runCommand() {
    if (!adb) return alert("请先连接设备");

    const cmd = document.getElementById("command").value.trim();
    if (!cmd) return alert("请输入命令");

    try {
        output(`⏳ 执行: ${cmd}`);
        const result = await execCommand(cmd);
        output(result || "(无输出)");
    } catch (err) {
        output(`❌ 错误: ${err.message}`);
    }
}

// 截图
async function takeScreenshot() {
    if (!adb) return alert("请先连接设备");

    try {
        output("📸 截图中...");
        const filename = `/sdcard/screenshot_${Date.now()}.png`;
        await execCommand(`screencap -p ${filename}`);
        output(`✅ 截图已保存:\n${filename}`);
    } catch (err) {
        output(`❌ 截图失败: ${err.message}`);
    }
}

// 重启设备
async function rebootDevice() {
    if (!adb) return alert("请先连接设备");

    if (!confirm("⚠️ 确定要重启设备吗？")) return;

    try {
        output("🔄 正在重启...");
        await execCommand("reboot");
        output("✅ 重启命令已发送");
        document.getElementById("status").textContent = "设备重启中...";
    } catch (err) {
        output(`❌ 重启失败: ${err.message}`);
    }
}

// 列出文件
async function listFiles() {
    if (!adb) return alert("请先连接设备");

    try {
        output("📁 读取文件列表...");
        const result = await execCommand("ls -lh /sdcard/");
        output(`📁 /sdcard/ 目录:\n\n${result}`);
    } catch (err) {
        output(`❌ 错误: ${err.message}`);
    }
}

// 设备信息
async function deviceInfo() {
    if (!adb) return alert("请先连接设备");

    try {
        output("ℹ️ 获取设备信息...");

        const model = await execCommand("getprop ro.product.model");
        const brand = await execCommand("getprop ro.product.brand");
        const android = await execCommand("getprop ro.build.version.release");
        const sdk = await execCommand("getprop ro.build.version.sdk");
        const serial = await execCommand("getprop ro.serialno");
        const battery = await execCommand("dumpsys battery | grep level");
        const storage = await execCommand("df -h /sdcard/ | tail -1");

        output(
            `📱 设备信息\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `品牌: ${brand}\n` +
            `型号: ${model}\n` +
            `Android: ${android} (SDK ${sdk})\n` +
            `序列号: ${serial}\n` +
            `电量: ${battery.replace(/[^0-9]/g, '')}%\n` +
            `存储: ${storage}`
        );
    } catch (err) {
        output(`❌ 错误: ${err.message}`);
    }
}

// ========== 页面初始化 ==========
window.addEventListener('DOMContentLoaded', () => {
    const compat = checkCompatibility();

    if (!compat.supported) {
        // 不支持的设备/浏览器，显示警告页面
        document.body.innerHTML = `
            <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; 
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px;">
                <div style="max-width: 600px; background: white; border-radius: 15px; 
                           box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
                    <div style="background: #ffc107; padding: 30px; text-align: center;">
                        <h1 style="margin: 0; font-size: 32px; color: #000;">${compat.title}</h1>
                    </div>
                    <div style="padding: 40px;">
                        <pre style="white-space: pre-wrap; line-height: 1.8; font-size: 14px; 
                                   font-family: system-ui, -apple-system, sans-serif; 
                                   background: #f5f5f5; padding: 20px; border-radius: 8px; 
                                   border-left: 4px solid #ffc107;">${compat.message}</pre>
                        <div style="margin-top: 30px; padding: 20px; background: #e3f2fd; 
                                   border-radius: 8px; border-left: 4px solid #2196f3;">
                            <strong style="color: #1976d2;">📋 兼容性列表</strong>
                            <table style="width: 100%; margin-top: 15px; font-size: 13px;">
                                <tr style="background: white;">
                                    <td style="padding: 8px; border: 1px solid #ddd;"><strong>Windows 电脑</strong></td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">Chrome / Edge</td>
                                    <td style="padding: 8px; border: 1px solid #ddd; color: green;"><strong>✅ 支持</strong></td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #ddd;"><strong>macOS 电脑</strong></td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">Chrome</td>
                                    <td style="padding: 8px; border: 1px solid #ddd; color: green;"><strong>✅ 支持</strong></td>
                                </tr>
                                <tr style="background: white;">
                                    <td style="padding: 8px; border: 1px solid #ddd;"><strong>Linux 电脑</strong></td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">Chrome</td>
                                    <td style="padding: 8px; border: 1px solid #ddd; color: green;"><strong>✅ 支持</strong></td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #ddd;"><strong>iPhone / iPad</strong></td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">Safari / Chrome</td>
                                    <td style="padding: 8px; border: 1px solid #ddd; color: red;"><strong>❌ 不支持</strong></td>
                                </tr>
                                <tr style="background: white;">
                                    <td style="padding: 8px; border: 1px solid #ddd;"><strong>Android 手机</strong></td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">任意浏览器</td>
                                    <td style="padding: 8px; border: 1px solid #ddd; color: red;"><strong>❌ 不支持</strong></td>
                                </tr>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        `;
        return;
    }

    // 显示平台信息
    const info = getPlatformInfo();
    console.log('🖥️ 平台信息:', info);
    console.log("✅ Rokid ADB Manager 已加载");

    // 在页面顶部添加平台提示（可选）
    const platformBadge = document.createElement('div');
    platformBadge.style.cssText = 'position: fixed; top: 10px; right: 10px; background: rgba(0,0,0,0.7); color: white; padding: 8px 15px; border-radius: 20px; font-size: 12px; z-index: 9999;';

    let platformText = '';
    if (info.isWindows) platformText = '🖥️ Windows';
    else if (info.isMac) platformText = '🍎 macOS';
    else if (info.isLinux) platformText = '🐧 Linux';

    platformBadge.textContent = `${platformText} • ${info.browser}`;
    document.body.appendChild(platformBadge);
});

// ========== 绑定事件 ==========
document.getElementById("connectBtn").addEventListener("click", connectADB);

// 添加"复制关闭 ADB 命令"按钮（如果 HTML 中有的话）
const killAdbBtn = document.getElementById("killAdbBtn");
if (killAdbBtn) {
    killAdbBtn.addEventListener("click", copyKillAdbCommand);
}

// init.json 管理
document.getElementById("viewInitBtn").addEventListener("click", viewInitJson);
document.getElementById("backupInitBtn").addEventListener("click", backupInitJson);
document.getElementById("deleteInitBtn").addEventListener("click", deleteInitJson);

// 录屏文件管理
document.getElementById("listVideosBtn").addEventListener("click", listVideos);
document.getElementById("exportVideosBtn").addEventListener("click", exportVideos);

// 全选复选框
document.getElementById("selectAllVideos").addEventListener("change", (e) => {
    const checkboxes = document.querySelectorAll('.video-checkbox');
    checkboxes.forEach(cb => cb.checked = e.target.checked);
    updateSelectedCount();
});

// APK 管理
document.getElementById("apkFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    const nameEl = document.getElementById("apkFileName");
    const btn = document.getElementById("installApkBtn");
    if (file) {
        nameEl.textContent = file.name;
        nameEl.classList.remove("text-gray-500");
        btn.disabled = false;
    } else {
        nameEl.textContent = "点击选择 .apk 文件";
        nameEl.classList.add("text-gray-500");
        btn.disabled = true;
    }
});
document.getElementById("installApkBtn").addEventListener("click", installApk);
document.getElementById("uninstallApkBtn").addEventListener("click", uninstallApk);
document.getElementById("listPkgsBtn").addEventListener("click", listPackages);

// 其他功能
document.getElementById("runBtn").addEventListener("click", runCommand);
document.getElementById("screenshotBtn").addEventListener("click", takeScreenshot);
document.getElementById("rebootBtn").addEventListener("click", rebootDevice);
document.getElementById("listFilesBtn").addEventListener("click", listFiles);
document.getElementById("deviceInfoBtn").addEventListener("click", deviceInfo);

// 回车执行命令
document.getElementById("command").addEventListener("keypress", (e) => {
    if (e.key === "Enter") runCommand();
});