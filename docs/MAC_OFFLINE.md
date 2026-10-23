# macOS 离线位置（File Provider，Phase 1）

> 状态：**实验性、Phase 3**。已支持在线写入、离线写队列、冲突副本、缩略图和同步状态；
> 签名/公证脚本已提供，但真实 Finder 行为仍需要在签名的 Mac 上验收。

## 最终形态

Finder 左侧「位置」出现 **Tern**（与 iCloud Drive 同级），支持：

- 按需下载：打开文件时才拉取内容；
- 本地缓存：打开过的文件断网仍可读；
- 系统管理缓存和云/已下载状态；
- Quick Look、缩略图、Spotlight（后续打磨）；
- 后续增加离线写入队列、冲突副本和「保持下载」。

它 **不是** `/Volumes/Tern` 网络卷；macOS 原生云盘体验使用 File Provider 位置。

## 架构

```text
Tern.app (menu bar)
  └── TernFileProvider.appex
        ├── FileProviderExtension
        ├── TernEnumerator
        └── FileProviderStore (app-group JSON cache)

        HTTPS
          │
          ▼
GET /api/sync/changes?cursor=...
GET /api/nodes/:id/content
POST /api/auth/login
```

- 首轮 `cursor=0` 返回完整 live tree 快照 + 当前 cursor；
- 之后返回增量 upsert / tombstone；
- 密码保存在 App Group 共享 Keychain；扩展不通过 XPC 接收密码；
- 内容下载成功后交给 File Provider 系统缓存。

## 服务端 API

详见 [API.md](API.md) 的 Sync 章节。

```text
GET /api/sync/changes?cursor=0
GET /api/sync/changes?cursor=123&limit=500
```

## 构建

需要完整 Xcode（不是只有 Command Line Tools）：

```bash
cd macos
xcodegen generate --spec project.yml   # 或者使用已提交的 Tern.xcodeproj
TEAM=你的TeamID ./build-xcode.sh       # 签名运行
```

没有 Team 时 `./build-xcode.sh` 会编译但不签名，无法注册 File Provider 扩展。

### 签名配置

在 Xcode 中为 `Tern` 和 `TernFileProvider` 两个 target：

1. 选择同一个 Team；
2. 启用 **App Groups**：`group.com.tern.menubar`；
3. 启用 **Keychain Sharing**：在 entitlements 中使用
   `$(AppIdentifierPrefix)com.tern.menubar.shared`；
4. File Provider 扩展使用 `com.apple.fileprovider-nonui`。

自用可以不公证；如果要分发给别人，需要 Developer ID + notarization。

## 使用

1. 构建并打开 `Tern.app`；
2. 在设置里保存服务器地址、用户名和密码；
3. 点击 **在 Finder 中启用 Tern（只读预览）**；
4. 打开 Finder →「位置」→ Tern；
5. 文件会按需下载，打开过的文件可在断网时读取。

如果提示 `添加 File Provider 失败`：

- 检查两个 target 是否都使用同一 Team；
- 检查 App Group 和 Keychain Sharing entitlement；
- 确认 `TernFileProvider.appex` 已嵌入 `Tern.app/Contents/PlugIns`；
- 查看 Console.app 中 `TernFileProvider` 的日志。

## Phase 2 能力

- 新建文件夹、上传文件；
- 修改文件内容（带 `If-Match`，服务端返回 412 时当前会保留待同步状态）；
- 重命名、移动（包括移动到根目录）；
- 删除（进入服务端回收站）；
- 离线写队列：网络不可用时本地保存内容/操作，Finder 中标记为待上传；下次枚举时重试；
- 新建文件使用客户端生成的 ID，联网后不会发生 ID 变化。

## Phase 3 当前能力

- **冲突副本**：服务端返回 412 时，把本地内容保存为
  `name (conflicted copy).ext`，不静默覆盖远端文件；
- **缩略图**：图片文件通过 ImageIO 在本地生成缩略图；
- **同步状态**：菜单栏显示待上传数量和最近一次冲突/错误；
- **内容策略**：默认 `downloadLazily`，由系统按需下载/缓存；
- **保持下载 / 移除下载**：Finder 右键自定义动作；「保持下载」把 item 标记为
  `downloadEagerlyAndKeepDownloaded` 并通知 File Provider，「移除下载」清除固定
  标记并调用 evict；
- **从 WebDAV 迁移**：设置页提供「断开 WebDAV 网络盘并关闭自动连接」；
- **签名脚本**：`package-release.sh` 使用 Developer ID 归档、公证、staple。

## 仍待完成

- Spotlight 索引、同步进度页、失败重试 UI；
- 自动合并/冲突解决 UI（目前只生成冲突副本）；
- 正式签名、公证、发布和升级流程；
- 扩展必须由 Xcode 构建并正确签名，旧版 `build.sh`（CLT + ad-hoc）不能注册它。

## 从 WebDAV 迁移

1. 先在设置中启用 File Provider；
2. 确认 Finder「位置」中的 Tern 可以浏览和下载；
3. 点击设置里的 **「断开 WebDAV 网络盘并关闭自动连接」**；
4. 应用会卸载旧的 `/Volumes/Tern` 挂载并移除 LaunchAgent，但菜单栏 App 和
   File Provider 位置会继续保留。

不要同时保留两个 Tern 入口，否则 Finder 里会出现两个位置。

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
