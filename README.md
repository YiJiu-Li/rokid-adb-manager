# 🔧 Rokid ADB Manager

基于 **WebUSB + ADB 协议**的 Rokid 设备网页管理工具，无需安装任何客户端，直接在浏览器中通过 USB 管理设备。

## ✨ 功能

| 功能 | 说明 |
|------|------|
| 📱 设备连接 | WebUSB 一键连接，密钥持久化（无需重复授权） |
| 🚀 自启动管理 | 查看 / 备份 / 删除 `/sdcard/init.json` |
| 🎬 录屏文件管理 | 列出 ScreenRecorder 文件夹，多选打包下载为 ZIP |
| 📦 APK 安装 | 选择本地 APK 文件，自动上传并安装到设备 |
| 🗑️ APK 卸载 | 输入包名卸载，支持列出已安装第三方应用 |
| 📸 截图 | 截图并保存到设备 `/sdcard/` |
| ℹ️ 设备信息 | 查看品牌、型号、Android 版本、电量、存储等 |
| ⌨️ 自定义命令 | 直接执行任意 ADB Shell 命令 |
| 🔄 重启设备 | 一键重启 |

## 🖥️ 兼容性

| 平台 | 浏览器 | 支持 |
|------|--------|------|
| Windows | Chrome / Edge | ✅ |
| macOS | Chrome | ✅ |
| Linux | Chrome | ✅ |
| iPhone / iPad | 任意 | ❌ |
| Android 手机 | 任意 | ❌ |

> WebUSB API 仅支持桌面端 Chromium 系浏览器（Chrome 89+ / Edge 89+）

## 🚀 快速开始

### 设备准备

1. 在 Rokid 设备上开启 **USB 调试**
2. 用数据线连接电脑（需支持数据传输，非仅充电线）
3. 设备弹出授权框时点击 **允许**

### 本地运行

```bash
npm install
npm run dev
```

打开 http://localhost:5173，点击「连接设备」选择设备即可。

### 常见问题

**提示 `claimInterface` / USB 接口被占用**

本机 ADB 进程占用了 USB 接口，在终端执行：

```bash
# Windows
adb kill-server
taskkill /F /IM adb.exe

# macOS / Linux
adb kill-server
killall adb
```

刷新页面后重新连接。（页面也会自动复制命令到剪贴板）

**安装 APK 失败**

- 确保设备已开启「允许未知来源」
- 检查 APK 与设备 CPU 架构是否匹配（arm64-v8a）
- 若签名冲突，先卸载旧版本再安装

## 🛠️ 技术栈

- [`@yume-chan/adb`](https://github.com/yume-chan/ya-webadb) — WebADB 核心协议
- [`@yume-chan/adb-backend-webusb`](https://github.com/yume-chan/ya-webadb) — WebUSB 传输后端
- [`@yume-chan/stream-extra`](https://github.com/yume-chan/ya-webadb) — 流处理工具
- [JSZip](https://stuk.github.io/jszip/) — 客户端 ZIP 打包
- [Tailwind CSS](https://tailwindcss.com/) — UI 样式
- [Vite](https://vitejs.dev/) — 构建工具

## 📄 License

MIT
