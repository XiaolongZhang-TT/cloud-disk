# macOS 离线位置（File Provider）

> 状态：**实验性、Phase 3 已验收**。已支持按需下载、在线/离线写入、冲突副本、
> 缩略图、保持下载和网络恢复重连；Personal Team 签名可用，Developer ID
> 公证/分发仍需付费账号。

## 最终形态

Finder 左侧「位置」出现 **Tern**（与 iCloud Drive 同级），支持：

- 按需下载：打开文件时才拉取内容；
- 本地缓存：打开过的文件断网仍可读；
- 在线新建、修改、重命名、移动、删除；
- 离线写队列：断网时的本地操作会在网络恢复后自动上传；
- 冲突副本：服务端文件已被修改时，本地内容保存为
  `name (conflicted copy).ext`；
- Quick Look / 缩略图；
- 「保持下载」/「移除下载」Finder 右键动作；
- 网页/WebDAV/其他 Mac 的改动通过长轮询实时出现在 Finder；
- 网络恢复后自动重连并 flush 待上传队列。

它 **不是** `/Volumes/Tern` 网络卷；macOS 原生云盘体验使用 File Provider 位置。

## 架构

```text
Tern.app (menu bar)
  └── TernFileProvider.appex
        ├── FileProviderExtension
        ├── TernEnumerator
        └── FileProviderStore (extension-local JSON cache)

        HTTPS
          │
          ▼
GET /api/sync/changes?cursor=...
GET /api/nodes/:id/content
PUT /api/nodes/:id/content
POST /api/auth/login
```

- 首轮 `cursor=0` 返回完整 live tree 快照 + 当前 cursor；
- 之后返回增量 upsert / tombstone；
- 扩展内容缓存、待上传队列放在扩展自己的容器里，不依赖 App Group；
- 连接信息、密码、同步状态和「保持下载」标记放在共享 Keychain；
- 内容下载成功后交给 File Provider 系统缓存。

## 服务端 API

详见 [API.md](API.md) 的 Sync 章节。

```text
GET /api/sync/changes?cursor=0
GET /api/sync/changes?cursor=123&limit=500
PUT /api/nodes/:id/content
```

## 构建

需要完整 Xcode（不是只有 Command Line Tools）：

```bash
cd macos
TEAM=你的TeamID ./build-xcode.sh       # 自动签名并生成 provisioning profile
```

没有 Team 时 `./build-xcode.sh` 会编译但不签名，无法注册 File Provider 扩展。

### 免费 Personal Team

本项目已经适配免费 Personal Team：

- **不需要 App Groups**。Personal Team 不支持 App Group capability，因此
  共享配置改存 Keychain；
- 只需 **Keychain Sharing**，entitlement 使用
  `$(AppIdentifierPrefix)com.tern.menubar.shared`；
- File Provider 扩展使用 `com.apple.fileprovider-nonui`；
- `com.apple.developer.fileprovider.testing-mode` **不可用**（Personal Team
  明确不支持），所以第一次添加 domain 后需要在系统设置里手动启用一次。

### 首次启用

1. 构建并打开 `Tern.app`；
2. 在设置里保存服务器地址、用户名和密码；
3. 点击 **在 Finder 中启用 Tern**；
4. 打开 **系统设置 → 通用 → 登录项与扩展**，向下滚动到
   **文件提供程序 / File Providers**，启用 **Tern**；
5. 打开 Finder →「位置」→ Tern。

如果系统弹出「`Tern` 想访问受 `Tern` 管理的文件」，点 **允许**。

如果提示 `添加 File Provider 失败`：

- 检查两个 target 是否都使用同一 Team；
- 检查 Keychain Sharing entitlement；
- 确认 `TernFileProvider.appex` 已嵌入 `Tern.app/Contents/PlugIns`；
- 查看 Console.app 中 `TernFileProvider` 的日志；
- 运行 `./build-xcode.sh` 时确认带上了 `TEAM=...`。

### 手动维护命令

菜单栏 App 也提供调试入口（通常不需要手动使用）：

```bash
"/Applications/Tern.app/Contents/MacOS/Tern" --file-provider-setup
"/Applications/Tern.app/Contents/MacOS/Tern" --file-provider-remove
```

## Phase 2 能力

- 新建文件夹、上传文件；
- 修改文件内容（带 `If-Match`，服务端返回 412 时生成冲突副本）；
- 重命名、移动（包括移动到根目录）；
- 删除（进入服务端回收站）；
- 离线写队列：网络不可用时本地保存内容/操作，Finder 中标记为待上传；
  下次枚举或网络恢复时重试；
- 新建文件使用客户端生成的 ID，联网后不会发生 ID 变化。

## Phase 3 能力

- **冲突副本**：服务端返回 412 时，把本地内容保存为
  `name (conflicted copy).ext`，不静默覆盖远端文件；
- **缩略图**：图片文件通过 ImageIO 在本地生成缩略图；
- **同步状态**：菜单栏显示待上传数量和最近一次冲突/错误；
- **内容策略**：默认 `downloadLazily`，由系统按需下载/缓存；
- **保持下载 / 移除下载**：Finder 右键自定义动作；「保持下载」把 item 标记为
  `downloadEagerlyAndKeepDownloaded` 并通知 File Provider，「移除下载」清除固定
  标记并调用 evict；
- **实时 watcher**：菜单栏 App 持有 `/api/sync/watch` 长轮询，收到变化后
  `signalEnumerator`，让 File Provider 增量同步网页/其他客户端的改动；
- **Mac 客户端不再使用 WebDAV**：服务端 WebDAV 仍保留给 Windows/rclone，
  但菜单栏 App 只使用 REST + File Provider；
- **网络变化自动重连**：File Provider 扩展使用 `NWPathMonitor`；
  - 网络恢复时自动 flush 离线写队列；
  - 菜单栏 watcher 自动重连长轮询；
- **签名脚本**：`package-release.sh` 使用 Developer ID 归档、公证、staple。

## 已验证

在 macOS 27.0.1、Personal Team 签名下实际验证：

- Finder 位置出现并可枚举根目录；
- PDF 按需下载，文件内容 checksum 与服务端一致；
- 在线新建、修改、重命名、移动、删除同步到服务端；
- 断网创建文件后恢复 Wi-Fi，文件自动上传到服务端；
- 远端和本地同时修改同一文件时生成 `(conflicted copy)`，远端原文件不被覆盖；
- 网页/REST 上传新文件后，Finder 在约 1 秒内自动出现该文件；
- 卸载 WebDAV 后 File Provider 和 watcher 仍然正常工作；
- App 重启后 File Provider domain 保持注册。

## 仍待完成

- Spotlight 索引、同步进度页、失败重试 UI；
- 自动合并/冲突解决 UI（目前只生成冲突副本）；
- 正式 Developer ID 签名、公证、发布和升级流程；
- 扩展必须由 Xcode 构建并正确签名，旧版 `build.sh`（CLT + ad-hoc）不能注册它。

## 与 WebDAV 的关系

macOS 客户端不挂载 WebDAV。服务端 `/Tern` 和 `/dav` 仍可供 Windows、rclone
等客户端使用；macOS 的 Finder 访问全部经过 File Provider 的 REST 通道。

## 签名与公证

```bash
cd macos
TEAM=你的TeamID ./build-xcode.sh
```

正式分发：

```bash
TEAM=你的TeamID APPLE_ID=你的AppleID APPLE_TEAM_ID=你的TeamID APPLE_APP_PASSWORD='app-specific-password' ./package-release.sh
```

`package-release.sh` 会归档、导出 Developer ID 应用、提交 notarytool、staple，
并生成 `dist/Tern-FileProvider-<version>.zip`。没有付费开发者账号时，只能做本机
Xcode 签名构建，不能完成公证分发。
