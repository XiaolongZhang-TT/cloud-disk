# Tern

[English](README.en.md) | **简体中文**

[![CI](https://github.com/XiaolongZhang-dev/tern/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/XiaolongZhang-dev/tern/actions/workflows/ci.yml)
[![Docker Hub](https://img.shields.io/docker/pulls/acc110789/tern?logo=docker)](https://hub.docker.com/r/acc110789/tern)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

部署在 NAS 上的私有网盘：Docker 一键部署，网页端简洁易用，macOS 客户端通过 File Provider 出现在 Finder 的「位置」中，和 iCloud Drive 并排显示。

> 数据保存在你自己的 NAS 上，不经过第三方云服务。MIT 开源。

![Tern 界面](docs/screenshots/02-drive.png)

## 功能

- 文件/文件夹管理、拖拽上传、图片/视频/PDF/文本预览、搜索、收藏、回收站
- 多用户与存储配额、带密码和有效期的公开分享
- WebDAV：`/dav` 和 `/Tern`，供 rclone 等客户端使用（macOS / Windows 客户端都不再使用 WebDAV）
- macOS 菜单栏客户端：原生 File Provider 位置，按需下载、离线写入、冲突副本、实时同步
- Docker 单容器：SQLite + 本地文件存储，支持 amd64 / arm64

## 快速开始

镜像已发布到 Docker Hub：**[acc110789/tern](https://hub.docker.com/r/acc110789/tern)**，包含网页端和 API，无需本地构建。

```bash
mkdir -p data

docker run -d --name tern --restart unless-stopped \
  -p 8080:8080 \
  -v "$PWD/data:/data" \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD='请换成强密码' \
  -e DATA_UID="$(id -u)" \
  -e DATA_GID="$(id -g)" \
  acc110789/tern:latest
```

打开 `http://<NAS-IP>:8080`。首次启动会自动创建管理员；数据保存在 `./data`。

也可以使用 Docker Compose：

```bash
cp .env.example .env
# 修改 ADMIN_PASSWORD、DATA_UID、DATA_GID

docker compose -f docker-compose.hub.yml up -d
```

从源码构建：

```bash
git clone https://github.com/XiaolongZhang-dev/tern.git
cd tern
cp .env.example .env
# 修改 ADMIN_PASSWORD、DATA_UID、DATA_GID
docker compose up -d --build
```

## macOS 客户端

macOS 客户端现在使用 **File Provider**，Finder 的「位置」中会出现 **Tern**（与 iCloud Drive 同级），不再挂载 `/Volumes` WebDAV 网络盘。

菜单栏 Tern →「设置」：

```text
服务器地址：https://<NAS>:<PORT>/Tern
用户名：    网页端账号
密码：      网页端密码
```

保存后点「在 Finder 中启用 Tern」，再到 **系统设置 → 通用 → 登录项与扩展 → 文件提供程序** 中启用 Tern。首次启用需要 Xcode 签名构建；Personal Team 可以使用。

支持：

- 按需下载、Quick Look、缩略图；
- Finder 中新建、修改、重命名、移动、删除；
- 离线写队列；
- 服务端冲突时生成 `(conflicted copy)`；
- 网页/其他客户端上传后，通过菜单栏 App 的长轮询 watcher 在约 1 秒内出现在 Finder；
- 右键「保持下载 / 移除下载」。

构建与签名：

```bash
cd macos
TEAM=你的TeamID ./build-xcode.sh
cp -R .build-xcode/Build/Products/Debug/Tern.app /Applications/
```

完整说明见 [docs/MAC.md](docs/MAC.md)；离线/File Provider 细节见 [docs/MAC_OFFLINE.md](docs/MAC_OFFLINE.md)。

## Windows 客户端

Windows 10/11 x64 托盘客户端，使用 **Windows Cloud Files API** 在资源管理器中
创建离线位置，可选映射为 `T:` 盘符。

- 按需下载、离线读取、离线写入
- Windows 原生「始终保留在此设备上 / 释放空间」
- 冲突副本、新建/修改/重命名/移动/删除
- 网页上传后通过长轮询 watcher 自动出现
- 不再需要 WebDAV 或 WebClient 服务

从 Releases 下载 `Tern-Windows-Setup.exe` 安装（或运行 `windows/build.ps1`
构建），打开托盘 Tern →「设置」填写服务器、账号和同步文件夹即可。完整说明见
[docs/WINDOWS.md](docs/WINDOWS.md)。

## 文档

- [部署指南](docs/DEPLOY.md)：NAS、HTTPS、备份升级
- [macOS 客户端](docs/MAC.md)：构建、安装、Finder 集成
- [macOS 离线位置（实验）](docs/MAC_OFFLINE.md)：File Provider Phase 3
- [Windows 客户端](docs/WINDOWS.md)：Cloud Files 离线位置、盘符映射、离线写入
- [架构](docs/ARCHITECTURE.md) · [API](docs/API.md)
- [路线图](ROADMAP.md) · [贡献指南](CONTRIBUTING.md) · [安全策略](SECURITY.md)

## 开发与测试

```bash
(cd server && npm ci && npm test)
(cd web && npm ci && npm run build)
(cd macos && ./build.sh)          # 仅菜单栏 App；File Provider 用 build-xcode.sh
cd windows && powershell -File build.ps1   # Windows
```

## 安全

公网访问请使用 HTTPS；WebDAV 使用 HTTP Basic 认证，不要将明文 HTTP 暴露到不可信网络。建议定期备份 `data/`。

## 参与贡献

欢迎提交 Issue 和 PR。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要公开提交 Issue。

## License

[MIT](LICENSE) © 2026 Tern contributors
