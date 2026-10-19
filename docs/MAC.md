# macOS 客户端指南（Tern）

本文档面向最终用户和本地开发者，说明 macOS 菜单栏客户端 **Tern** 的构建、安装、配置、Finder 集成、远程/HTTPS 使用、卸载与故障排查。

> 客户端不是同步盘，也不重复实现文件传输：它调用 macOS 自带的 `NetFSMountURLSync` 把 Tern 服务端的 WebDAV 端点挂载为**真正的网络卷**。因此卷会出现在 `/Volumes`、Finder 侧边栏的「位置（Locations）」中（与 iCloud Drive 并列），Finder、预览、终端、任何 App 都能像访问移动硬盘一样读写它。
>
> 不需要 Apple 开发者账号、不需要内核扩展，也不需要 File Provider 权限。

---

## 1. 系统要求

| 项目 | 要求 |
|---|---|
| 操作系统 | macOS 13 Ventura 或更高（在 macOS 27 arm64 上验证通过） |
| CPU | Apple Silicon（默认构建 arm64；Intel 可用 `ARCHS="x86_64"` 或通用二进制构建） |
| 构建工具 | Xcode **Command Line Tools**（`xcode-select --install`）即可，**不需要完整 Xcode，不需要 xcodebuild** |
| Swift | Swift 5.9 / 6.0 均可（`swiftc` 直接编译） |
| 账号 | 无需 Apple Developer 账号；应用使用 **ad-hoc 临时签名** |
| 服务端 | Tern 服务已启动，且 WebDAV 端点可访问（默认 `http://<host>:8080/Tern`） |

客户端已经用命令行工具链（CLT + `swiftc`）完整构建和验证，构建脚本会自动选择可用 SDK，避免 CLT 自带 SDK 与 Swift 版本不匹配的问题。

---

## 2. 构建

```bash
cd macos

./build.sh                # 默认：arm64，部署目标 macOS 13
./build.sh --clean        # 先清空 .build/ 与 dist/ 再构建
ARCHS="arm64 x86_64" ./build.sh        # 通用二进制（需要可用 SDK 支持两个架构）
DEPLOYMENT_TARGET=14.0 ./build.sh      # 自定义最低系统版本
SDK_PATH=/Library/Developer/CommandLineTools/SDKs/MacOSX14.5.sdk ./build.sh   # 指定 SDK
```

构建脚本会：

1. 自动探测 `swiftc` / `clang` / macOS SDK；若默认 SDK 与编译器模块版本不匹配（常见于只装了 Command Line Tools 的机器），会自动尝试其他已安装的 SDK，并支持 `SDK_PATH` / `MACOSX_SDK` 覆盖。
2. 用 `swiftc` 编译 SwiftUI + AppKit 应用和 `mount-smoke` CLI。
3. 组装 `Tern.app`（`Info.plist`、图标 `AppIcon.icns`、`PkgInfo`）。
4. 用 `codesign --sign -` 做 ad-hoc 签名并 `codesign --verify --deep --strict` 校验。
5. 生成可分发压缩包与 SHA-256：

```text
macos/dist/Tern.app                 # 可直接运行的菜单栏应用
macos/dist/Tern-1.1.0.zip           # 分发包（ditto 打包，保留符号链接与权限）
macos/dist/Tern-1.1.0.zip.sha256    # 校验和
macos/dist/mount-smoke                   # CLI 副本
macos/tools/mount-smoke                  # CLI 测试工具
```

构建成功时最后会打印：

```text
==> 构建完成
    应用:      /…/macos/dist/Tern.app (1.1M)
    Zip:       /…/macos/dist/Tern-1.1.0.zip (524K)
    签名:      ad-hoc（com.tern.menubar）
```

图标资源已随仓库提供（`macos/Resources/AppIcon.icns`）。修改图标后重新生成：

```bash
# 需要带 Pillow 的 Python
python3 macos/tools/make-icon.py
```

---

## 3. 安装与 Gatekeeper

把 `Tern.app` 拖到 `/Applications`（或任意固定位置，见第 6 节关于登录启动路径的说明）。

由于应用是 ad-hoc 签名、未经过苹果公证（没有开发者账号），从网上下载/通过聊天工具传输后首次打开会被 Gatekeeper 拦截：

- **方式一（推荐）**：在 Finder 中右键点 `Tern.app` →「打开」→ 在弹窗中再次点「打开」。
- **方式二（仅限你信任该压缩包）**：移除隔离属性：

```bash
xattr -dr com.apple.quarantine /Applications/Tern.app
```

若提示「应用已损坏，无法打开」，通常是下载时被加上了 quarantine 属性，用上面的 `xattr` 命令或右键「打开」即可；它不是真正的损坏。可以在终端校验解压后的应用：

```bash
codesign --verify --deep --strict --verbose=2 /Applications/Tern.app
# => valid on disk / satisfies its Designated Requirement
```

ad-hoc 签名的两个实际影响（属正常现象）：

1. **钥匙串提示**：每次重新构建（二进制哈希变化）后，首次读取已保存的密码时 macOS 可能弹出「Tern 想要使用钥匙串中存储的机密信息」，选择「始终允许」即可；之后启动不再提示。
2. **每次重新构建都要重新「右键打开」**：若被重新下载/覆盖，Gatekeeper 可能再次要求确认。

没有开发者账号也可以正常使用全部功能（挂载、开机启动、钥匙串），只是不能做公证和 App Store 分发。

---

## 4. 首次运行与配置

启动后应用只出现在**菜单栏**（不会出现在 Dock，LSUIElement），图标为云朵：

- ☁️ 空心云 = 未连接
- 实心云 = 已连接
- 旋转箭头 = 正在连接/断开

点击图标 →「设置…」（或按 `⌘,`）：

| 设置项 | 说明 |
|---|---|
| 服务器地址 | 形如 `http://192.168.1.10:8080/Tern`。**路径必须使用 `/Tern`**（服务端同时提供 `/dav` 别名，但卷名会变成 `dav`，见第 5 节）。只填主机名时会自动补上 `/Tern`。默认值 `http://127.0.0.1:8080/Tern`（服务端默认端口 8080；本地开发联调常用 18080）。 |
| 用户名 | 与 Tern 网页登录账号相同。 |
| 密码 | 输入后点「保存」写入 **macOS 钥匙串**（`com.tern.menubar` 服务项），不会写入偏好设置、不会记录到日志。密码框留空保存时保留钥匙串里已有的密码。 |
| 测试服务器 | 用 WebDAV `OPTIONS` 探测地址与认证：✅ 正常 / ❌ 401 认证失败 / ❌ 连接被拒绝等。 |
| 登录时自动启动 | 写入 `~/Library/LaunchAgents/com.tern.menubar.plist`，详见第 6 节。 |
| 启动后自动连接 | 打开应用（包括登录启动）后自动挂载；默认开启。关闭后需手动点「连接」。 |

设置页也会显示派生出的卷名、默认挂载点（`/Volumes/Tern`）和当前挂载状态。

保存成功后回到菜单栏：

- 「连接」→ 调用 `NetFSMountURLSync` 挂载，成功后自动在 Finder 打开 `/Volumes/Tern`；
- 「断开连接」→ 干净卸载（优先 `unmount(2)`，必要时使用 DiskArbitration；卡住时可「强制断开」）；
- 「在 Finder 中打开」「复制服务器地址」「重新连接」；
- 「清理残留挂载点」：上一次异常退出留下空目录时出现；
- 「打开日志」：`~/Library/Logs/Tern.log`。

### 已挂载检测

应用每 3 秒轮询一次挂载状态（很轻量，只枚举卷，不读文件内容；在线状态约每 21 秒用 WebDAV `OPTIONS` 探测一次）：

- 连接前先检测 `/Volumes/Tern` 或匹配的 WebDAV 卷，已挂载则直接复用并显示「已连接」，不会重复挂载；
- 应用重启后自动接管已有挂载；
- 在 Finder 中手动推出卷后，菜单状态会自动变为「未连接」。

---

## 5. Finder 集成：位置栏与个人收藏

连接成功后：

1. 卷出现在 `/Volumes/Tern`；
2. Finder 侧边栏 **位置（Locations）** 中出现 `Tern`，与 iCloud Drive、外接磁盘并列——这是 macOS 对网络卷的标准行为，**不需要也无法通过接口直接写入侧边栏**；
3. Finder 窗口左侧拖动该卷到「个人收藏（Favorites）」区域，即可永久固定（推荐）；
4. 也可以使用「前往 → 连接服务器…」或 `⌘⇧G` 输入挂载路径。

卷名的来源：**macOS 从 WebDAV URL 的最后一段路径推导卷名**。

| 服务器地址 | 卷名 |
|---|---|
| `http://host:8080/Tern` | `Tern` ✅ 推荐 |
| `http://host:8080/dav` | `dav`（功能相同但名字不好看） |
| `http://host:8080/` | 主机名等（不推荐） |

Finder 挂载为读写的条件由服务端保证：WebDAV `DAV: 1, 2`、`PROPFIND`、`LOCK/UNLOCK`、`MOVE/COPY`、Range `GET`。服务端已实现这些能力，因此 Finder 中可以正常新建文件夹、拖放、重命名、删除、预览。

> 应用本身不写 Finder 侧边栏配置（`com.apple.sidebarlists.plist`），因为那属于系统私有偏好。首次连接后 Finder 会自动把网络卷放入「位置」，用户拖入「个人收藏」即可长期保留。

---

## 6. 登录启动（LaunchAgent）

实现方式：应用把下面这个 plist 写入 `~/Library/LaunchAgents/com.tern.menubar.plist`，并用 `launchctl bootstrap gui/<uid>` 加载：

```xml
<key>Label</key><string>com.tern.menubar</string>
<key>ProgramArguments</key>
<array>
  <string>/usr/bin/open</string><string>-g</string><string>-a</string>
  <string>/Applications/Tern.app</string>
</array>
<key>RunAtLoad</key><true/>
<key>LimitLoadToSessionType</key><string>Aqua</string>
```

为什么用 LaunchAgent 而不是 `SMAppService`/登录项：ad-hoc 签名、未公证的本地构建应用用 `SMAppService.mainApp.register()` 经常受限；LaunchAgent 不依赖签名身份、可审计、删除即彻底关闭。

- 打开设置里的「登录时自动启动」即安装并加载；关闭即 `launchctl bootout` 并删除 plist。
- **移动应用后会自动修复**：应用每次启动都会检查 plist 里记录的路径，若与当前 `Tern.app` 位置不同就自动重写并重新加载。移动后请至少手动启动一次应用。
- 登录启动以 `/usr/bin/open -g -a` 启动（不抢焦点、不弹 Dock），随后按「启动后自动连接」决定是否挂载。
- 手工查看状态：

```bash
launchctl print gui/$(id -u)/com.tern.menubar
cat ~/Library/LaunchAgents/com.tern.menubar.plist
```

- 若系统策略禁止加载 LaunchAgent（如 MDM 管控），设置页会显示错误信息，可改用「系统设置 → 通用 → 登录项」手动添加，或直接在登录时手动打开应用。

---

## 7. 命令行工具与自动化

### 7.1 `mount-smoke`：端到端验证挂载

`macos/tools/mount-smoke` 与 `Tern.app` 使用同一份挂载代码（`Sources/Shared/MountClient.swift`），可用于排查、CI 或验收。它会依次执行：

**探测 → 挂载 → 列根目录 → 写入测试文件 → 读回校验 → 删除 → 卸载 → 确认无残留**，并以退出码表示结果。

```bash
./tools/mount-smoke --url http://127.0.0.1:18080/Tern --user admin --password '密码'

# 密码也可从环境变量/标准输入读取，避免出现在 shell history 中
TERN_PASSWORD='密码' ./tools/mount-smoke --url FULL_URL --user admin
./tools/mount-smoke --url FULL_URL --user admin --password-stdin

# 从钥匙串读取（先由 Tern.app 保存过密码）
./tools/mount-smoke --url FULL_URL --user admin --keychain

# 只探测服务器（不挂载）
./tools/mount-smoke --check --url FULL_URL --user admin --password '密码'

# 断言根目录存在某条目（便于验收）
./tools/mount-smoke --url FULL_URL --user admin --password '密码' --expect-item '使用指南.md'

# JSON 结果（最后的 SMOKE_JSON 行）+ 日志写入文件
./tools/mount-smoke --url FULL_URL --user admin --password '密码' --json --result /tmp/smoke.log

# 只卸载（--force 用于卡住的卷）
./tools/mount-smoke --unmount /Volumes/Tern --force
```

成功输出示例（针对真实服务端验证）：

```text
== Tern mount-smoke 1.1.0 ==
url: http://127.0.0.1:18080/Tern
user: admin
volume: Tern
expected mount path: /Volumes/Tern
probe: 在线
mount: OK -> /Volumes/Tern (0.10s)
mount: fs type = webdav
list: OK, 4 个条目
list: 产品设计/, 旅行相册/, 使用指南.md, 项目资料/
write: OK tern-smoke-20261019-130623-361C3A.txt (132 bytes)
read: OK (132 chars, 内容校验通过)
cleanup: OK 测试文件已删除
unmount: OK (0.27s)
RESULT: PASS (exit 0)
挂载路径: /Volumes/Tern
```

退出码：

| 退出码 | 含义 |
|---|---|
| 0 | 全部成功 |
| 1 | 参数错误/缺少密码 |
| 2 | 挂载失败（认证、连接、协议错误等，输出里有错误码与中文解释） |
| 3 | NetFS 报告成功但找不到卷 |
| 4 | 列目录失败（含 `--expect-item` 断言失败） |
| 5 | 写入失败 |
| 6 | 读取内容校验失败 |
| 7 | 卸载失败 |
| 9 | `--check` 探测失败 |

> 注意：macOS 的网络卷挂载需要图形登录会话（Aqua）。在 SSH、CI 或**沙箱化的终端**里直接运行可能得到 `EPERM`（没有挂载权限）。此时可用应用内建的无界面模式，让 LaunchServices 在正常用户会话中执行：
>
> ```bash
> open -n /Applications/Tern.app --args --smoke \
>   --url http://127.0.0.1:18080/Tern --user admin --password '密码' \
>   --result /tmp/tern-smoke.log
> cat /tmp/tern-smoke.log
> ```
>
> 该模式与 CLI 完全同逻辑；`--result` 用于在无终端环境中保存输出。

### 7.2 应用二进制的其它隐藏模式

```bash
APP=/Applications/Tern.app/Contents/MacOS/Tern

$APP --version                     # 版本
$APP --diagnose                    # 诊断报告（路径/默认值/钥匙串/挂载/在线状态）
$APP --set-password --url URL --user NAME --password PASS   # 以应用身份写入钥匙串
$APP --delete-password --url URL --user NAME                # 删除钥匙串密码
$APP --login-item status|enable|disable                     # 登录启动的查看/启用/关闭
$APP --help
```

这些模式都不显示界面，方便自动化。`--set-password` 由应用二进制自己执行，因此写入的钥匙串条目与随后的正常启动属于同一签名身份，不会触发跨应用钥匙串提示。

### 7.3 本地 WebDAV 测试桩

`macos/tools/webdav_stub.py` 是一个零依赖的最小 WebDAV 服务器（Basic 认证、PROPFIND、GET/PUT/DELETE/MKCOL/COPY/MOVE/LOCK/UNLOCK），用于在真实服务端不可用时自测客户端：

```bash
python3 macos/tools/webdav_stub.py --port 18888 --user admin --password tern
# 端点 http://127.0.0.1:18888/Tern
./macos/tools/mount-smoke --url http://127.0.0.1:18888/Tern --user admin --password tern
```

测试结束请务必卸载：`./tools/mount-smoke --unmount /Volumes/Tern --force`。

---

## 8. 远程访问与 HTTPS

服务端与客户端之间使用 **HTTP Basic 认证**。基本原则：

- **同一台 Mac 本机 / 可信局域网**：`http://` 可以接受，但不要用管理员密码；建议为挂载单独使用账号（服务端支持多用户）。
- **公网 / 跨网络访问：必须使用 HTTPS**（Nginx、Caddy、Synology 反向代理均可），把 `/Tern`（以及 `/dav`、`/api`、`/`）转发到容器端口。服务端文档见 `docs/DEPLOY.md` 与 `docs/ARCHITECTURE.md`。
- 使用 HTTPS 时把服务器地址写成 `https://disk.example.com/Tern`。macOS 的 WebDAV 客户端会按系统信任链校验证书：
  - 正式证书（Let's Encrypt 等）：开箱可用；
  - 自签名证书：在「钥匙串访问」中把证书导入「系统」钥匙串并设为「始终信任」，否则 NetFS 会报认证/证书错误。
- 客户端为自托管场景放开了 App Transport Security（`NSAllowsArbitraryLoads`），以便连接局域网 HTTP 或自签名 HTTPS；请自行承担 HTTP 的明文风险。
- WebDAV 的 Basic 认证在 HTTP 下是明文传输的（Base64 不是加密）。公网务必 HTTPS。

---

## 9. 卸载

```bash
# 1. 菜单栏图标 →「断开连接」（或在终端强制卸载）
/Applications/Tern.app/Contents/MacOS/Tern --login-item disable
umount /Volumes/Tern 2>/dev/null || diskutil unmount force /Volumes/Tern

# 2. 退出应用
osascript -e 'tell application "Tern" to quit' 2>/dev/null   # 或菜单栏 →「退出」
# 若菜单栏无法点击：
killall Tern

# 3. 删除应用
rm -rf /Applications/Tern.app

# 4. （可选）清理登录启动（通常在设置里关闭即可）
rm -f ~/Library/LaunchAgents/com.tern.menubar.plist
launchctl bootout gui/$(id -u)/com.tern.menubar 2>/dev/null

# 5. （可选）清理钥匙串与偏好设置、日志
/Applications/Tern.app/Contents/MacOS/Tern --delete-password --url URL --user NAME  # 删除前先运行
security delete-generic-password -s com.tern.menubar 2>/dev/null
defaults delete com.tern.menubar 2>/dev/null
rm -f ~/Library/Logs/Tern.log ~/Library/Logs/Tern.previous.log ~/Library/Logs/Tern-launchd.log
rm -rf ~/Library/Application\ Support/Tern
```

卸载应用**不会**删除服务器上的任何文件；卸载/推出卷也不会。

---

## 10. 故障排查

### 10.1 按错误提示

| 现象 / 错误码 | 原因与处理 |
|---|---|
| `挂载失败（错误码 80）` / `EAUTH` | 用户名或密码错误、账号被禁用，或服务端未开启 WebDAV。先用网页登录确认账号，再点「测试服务器」。 |
| `错误码 13` / `EACCES` | 认证失败或服务器拒绝访问；也可能是反向代理未转发 `Authorization` 头。 |
| `错误码 61` / `ECONNREFUSED` | 服务未启动、端口错误、防火墙拦截。`curl -u user:pass http://host:8080/Tern` 验证。 |
| `错误码 60` / `ETIMEDOUT` | 网络不通或服务器地址错误；确认 VPN/防火墙。 |
| `错误码 2` / `ENOENT` | URL 路径不存在。路径必须是 `/Tern`（或 `/dav`），不要少了前缀。 |
| `错误码 1` / `EPERM` | 当前进程没有挂载权限：常见于 SSH 会话、CI、沙箱终端。请在图形桌面会话中运行，或用 `open -n Tern.app --args --smoke …`。 |
| `错误码 -6602` / `-5996` | 服务器 WebDAV 响应不完整（PROPFIND/LOCK 缺失或返回格式错误）。用 `mount-smoke` 的输出与 `~/Library/Logs/Tern.log` 对照服务端日志。 |
| `错误码 -5045/-5046/-5999` | 账号策略问题（要求改密/权限受限），按服务端提示处理。 |
| `错误码 -128` | 在系统认证弹窗中点了取消。 |
| `无法断开：卷忙（EBUSY）` | 有程序占用卷。关闭 Finder 窗口/终端 `cd` 到该卷的会话/预览/索引后重试；菜单栏「强制断开」。仍不行：`sudo diskutil unmount force /Volumes/Tern`。 |
| 提示「系统报告挂载成功但找不到卷」 | `mountedVolumeURLs` 可能滞后；客户端已内置最多 3 秒等待。若持续出现，检查是否有同名卷 `Tern-1`，或清理残留挂载点。 |

### 10.2 常见问题

- **Finder 侧边栏没有出现 Tern**：确认卷确实在 `/Volumes/Tern`（`mount | grep Tern`）；在 Finder「显示 → 显示侧边栏」；重新打开一个 Finder 窗口；网络卷可能被 Finder 设置隐藏（Finder 设置 → 侧边栏）。也可以手动拖入「个人收藏」。
- **卷名不是 Tern**：URL 最后一段不是 `Tern`。把服务器地址改成 `http://host:port/Tern`。
- **钥匙串反复提示**：每次重新构建应用后首次访问会提示一次（ad-hoc 签名限制）。选择「始终允许」。若每次都提示，可删除旧条目后重新在设置里保存密码。
- **登录启动没有生效**：查看 `launchctl print gui/$(id -u)/com.tern.menubar`；确认 plist 中的路径与当前应用位置一致（应用启动时会自动修复；移动后请手动启动一次）。MDM 策略可能禁止 LoginItems/LaunchAgents。
- **应用打开了但菜单栏没图标**：确认是 `Tern.app`（bundle id `com.tern.menubar`）；删除旧实例后重开：`killall Tern`。菜单栏图标过多时 macOS 可能自动隐藏，检查「系统设置 → 控制中心」或使用菜单栏管理工具。
- **连接时卡住**：服务器不可达时 NetFS 可能等待较久。应用内「强制断开」；之后先点「测试服务器」定位网络问题。日志：`~/Library/Logs/Tern.log`。
- **只能读不能写**：服务端 `LOCK/UNLOCK` 或权限配置问题（客户端要求 `DAV: 1, 2`）。用 `mount-smoke --expect-item` 只验证读；写失败时看服务端日志与返回码。
- **中文文件名**：服务端以 UTF-8 + 百分号编码；客户端无需特殊配置。若出现乱码，检查反向代理是否改写/转码路径。
- **构建时报 SDK/编译器版本不匹配**：`build.sh` 会自动探测可用 SDK；仍失败时指定 `SDK_PATH=/Library/Developer/CommandLineTools/SDKs/MacOSX14.5.sdk ./build.sh`。
- **系统提示「Tern 已损坏」**：见第 3 节 Gatekeeper 处理。
- **SSH/无图形会话挂载失败（EPERM）**：macOS 限制非 Aqua 会话的 `NetFS` 挂载；请在已登录桌面用户下运行，或使用 `open` 让 LaunchServices 代执行。

### 10.3 诊断信息

```bash
/Applications/Tern.app/Contents/MacOS/Tern --diagnose
tail -n 100 ~/Library/Logs/Tern.log
mount | grep -i cloud
launchctl print gui/$(id -u)/com.tern.menubar
```

---

## 11. 安全说明

- 密码只保存在 **登录钥匙串**（generic password，service `com.tern.menubar`，账号形如 `用户名@主机:端口`），不写入 `UserDefaults`、不进入日志、不出现在应用命令行中。
- 应用不申请任何特权、不安装内核扩展、不静默修改系统设置；登录启动仅是一个可删除的 per-user LaunchAgent。
- 挂载使用 WebDAV Basic 认证；局域网 HTTP 可接受，公网请务必 HTTPS。
- ad-hoc 签名意味着无法校验发布者身份；请只从可信来源获取 `Tern-1.1.0.zip`，并用随附的 `.sha256` 校验：
  ```bash
  shasum -a 256 -c Tern-1.1.0.zip.sha256
  ```
- 卸载卷不会删除服务器数据；服务端软删除/回收站策略见 `docs/API.md`。

---

## 12. 源码结构（开发者）

```text
macos/
  build.sh                     # 一键构建：swiftc → .app → ad-hoc 签名 → zip
  Resources/Info.plist         # LSUIElement 菜单栏应用、ATS、版本号
  Resources/AppIcon.icns       # 应用图标
  Sources/
    Shared/                    # 应用与 CLI 共用
      MountClient.swift        # NetFSMountURLSync 挂载、卷检测、卸载、错误码中文化、HTTP 探测
      SmokeRunner.swift        # mount-smoke 逻辑（mount/list/write/read/unmount + 退出码）
      KeychainStore.swift      # Security.framework 钥匙串读写
      TernInfo.swift      # 版本信息
      Log.swift                # 文件 + os_log 日志（自动轮转）
    App/                       # SwiftUI 菜单栏应用
      TernApp.swift       # @main、MenuBarExtra、Settings scene、单实例、隐藏 CLI 模式
      AppModel.swift           # 状态机、轮询、自动连接、错误提示
      SettingsStore.swift      # UserDefaults 偏好与地址校验
      LaunchAgentManager.swift # 登录启动
      MenuBarView.swift        # 菜单
      SettingsView.swift       # 设置窗口
    CLI/MountSmokeMain.swift   # tools/mount-smoke 入口
  tools/
    mount-smoke                # 构建产物（构建后生成）
    webdav_stub.py             # 本地 WebDAV 测试桩
    make-icon.py               # 生成 AppIcon.icns
  dist/                        # 构建产物：Tern.app / zip / sha256 / mount-smoke
  .build/                      # 中间产物（可删除）
```

自测清单（本机验证通过）：

1. `./build.sh` 成功，`codesign --verify --deep --strict` 通过；
2. `mount-smoke` 对 `http://127.0.0.1:18080/Tern` 执行 mount → list → write → read → unmount，全部 PASS；
3. 应用通过 LaunchServices 启动后自动连接，1 秒内挂载到 `/Volumes/Tern`（`webdav` 文件系统），Finder 位置栏可见；
4. 登录启动启用/禁用可正常写入/删除 LaunchAgent；
5. 测试结束后无残留卷、无残留 LaunchAgent、无应用进程。
