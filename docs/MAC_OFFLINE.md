# macOS 离线位置（File Provider，Phase 1）

> 状态：**实验性、Phase 2**。已支持在线写入、离线写队列和按需下载；
> 冲突自动拆分、缩略图和正式公证仍在后续阶段。

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

## Phase 2 当前能力

- 新建文件夹、上传文件；
- 修改文件内容（带 `If-Match`，服务端返回 412 时当前会保留待同步状态）；
- 重命名、移动（包括移动到根目录）；
- 删除（进入服务端回收站）；
- 离线写队列：网络不可用时本地保存内容/操作，Finder 中标记为待上传；下次枚举时重试；
- 新建文件使用客户端生成的 ID，联网后不会发生 ID 变化。

## 仍待完成

- 412 冲突时自动生成冲突副本；
- 缩略图、Spotlight、同步进度 UI；
- 正式签名与公证分发；
- 迁移旧 WebDAV 网络卷，避免 Finder 中出现两个 Tern；
- 扩展必须由 Xcode 构建并正确签名，旧版 `build.sh`（CLT + ad-hoc）不能注册它。

## Phase 3 计划

- 冲突副本和合并 UI；
- 「保持下载 / 移除下载」；
- 缩略图、Spotlight；
- 失败重试与同步状态页；
- 安装包、公证、升级流程。
