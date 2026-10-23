# Windows 客户端（Tern for Windows）

Tern for Windows 是托盘应用，使用 **Windows Cloud Files API** 提供类似
OneDrive 的离线位置。文件在资源管理器里是占位符，打开时才下载；支持离线
读取、离线写入、冲突副本和可选的 `T:` 盘符。

> **不再使用 WebDAV / WebClient**。服务端仍保留 WebDAV 端点给其他客户端，
> 但 Windows 客户端只走 REST API + Cloud Files。

## 1. 安装

从 Releases 下载 `Tern-Windows-Setup.exe`（推荐）或 `Tern-Windows-x64.zip`。
当前构建未做代码签名，SmartScreen 提示时选择「更多信息 → 仍要运行」。

需要：

- Windows 10 1709+ / Windows 11 x64；
- 本地 NTFS 磁盘上的同步文件夹（默认 `%USERPROFILE%\Tern`）；
- 不需要开启 WebClient 服务，也不需要映射网络驱动器。

## 2. 第一次连接

1. 托盘 Tern → **设置**；
2. 填写：
   - 服务器地址：`https://<NAS>:<PORT>/Tern`
   - 用户名 / 密码：与网页端一致
   - 同步文件夹：默认 `%USERPROFILE%\Tern`
   - 盘符：可选，默认 `T:`；也可以选「不映射盘符」
3. 点 **测试连接**；
4. 点 **保存并启用**；
5. 资源管理器左侧会出现 **Tern**；如果选择了盘符，也会出现 `T:`。

首次启用后，资源管理器可能需要几秒刷新出云文件图标。

## 3. 文件和离线行为

- **按需下载**：文件默认只显示元数据，打开时下载内容；
- **始终保留在此设备上**：Windows 原生右键菜单，文件固定到本地；
- **释放空间**：Windows 原生右键菜单，删除本地内容但保留云端占位符；
- **离线读取**：已下载/固定的文件断网可打开；
- **离线写入**：断网时新建或修改的文件留在本地，网络恢复后自动上传；
- **冲突副本**：服务端文件已被修改时，本地内容上传为
  `name (conflicted copy).ext`，原文件更新为服务端版本；
- **重命名 / 移动 / 删除 / 新建文件夹**：本地修改会同步到服务端；
- **远程变化**：菜单栏 watcher 长轮询 `/api/sync/watch`，网页上传后约
  1 秒出现在资源管理器；
- **本地变化**：FileSystemWatcher 监听同步文件夹，新建/修改/删除会立即
  进入上传队列；
- **网络变化**：监听 Windows 的 `NetworkAvailabilityChanged` /
  `NetworkAddressChanged`，网络恢复后立即刷新同步根并唤醒上传队列；
- **盘符**：`T:` 只是通过 `subst` 指向同步根的快捷方式，不改变 Cloud Files
  的离线行为。

## 4. 托盘菜单

```text
Tern
────────────────
已启用 · T:
打开 Tern
断开同步
设置…
打开日志
退出 Tern
```

- **登录时自动启动**：HKCU Run；
- **启动后自动启用同步**：启动时自动连接；
- 密码保存在 Windows 凭据管理器。

## 5. 与 WebDAV 的关系

Windows 客户端不再调用 WebDAV，也不需要 WebClient。服务端的 `/Tern` 和
`/dav` 仍可供 rclone、旧版客户端等使用。

如果从旧版 Windows 客户端升级，旧的 `T:` WebDAV 映射可能占用盘符；在
设置里选择「不映射盘符」或换一个盘符即可，旧映射可以手动断开。

## 6. 常见问题

### 资源管理器没有 Tern

- 确认设置已保存并点「启用同步」；
- 确认同步文件夹在本地 NTFS 磁盘，不在网络盘；
- 查看 `%LOCALAPPDATA%\Tern\Tern.log`；
- 重启资源管理器（任务管理器 → Windows 资源管理器 → 重新启动）。

### 文件只有云图标，打开失败

- 检查网络和服务器地址；
- 测试连接；
- 查看日志中的 hydration 错误。

### T: 被占用

- 设置里换盘符或选「不映射盘符」；
- `subst` 不能覆盖已存在的网络驱动器映射。

### 离线修改后没有上传

- 恢复网络后等待几秒；
- 确认文件不是“仅云端”状态；
- 查看日志中的 upload/conflict 错误。

### 卸载

卸载程序会：

- 停止托盘进程；
- 注销 Cloud Files sync root；
- 删除 `%LOCALAPPDATA%\Tern`；
- 删除登录启动项。

同步文件夹里的普通文件会尽量保留；仅云端占位符会在注销时删除。

## 7. 从源码构建

```powershell
cd windows
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

需要 .NET 8 SDK；安装 Inno Setup 6 后还会生成安装包。CI 在
`.github/workflows/windows-client.yml` 中构建 x64 自包含版本。

## 8. 已知限制

- 仅 Windows 10/11 x64；
- 首次启用需要约 1–2 秒注册 sync root；
- 盘符是 `subst` 快捷方式，不是独立卷；
- 当前构建未签名；
- 极大量文件首次占位符创建需要一些时间。
