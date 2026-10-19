# Tern

[English](README.en.md) | **简体中文**

[![CI](https://github.com/XiaolongZhang-dev/tern/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/XiaolongZhang-dev/tern/actions/workflows/ci.yml)
[![Docker Hub](https://img.shields.io/docker/pulls/acc110789/tern?logo=docker)](https://hub.docker.com/r/acc110789/tern)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

部署在 NAS 上的私有网盘：Docker 一键部署，网页端简洁易用，macOS 客户端可挂载到 Finder 的「位置」中，和 iCloud Drive 并排显示。

> 数据保存在你自己的 NAS 上，不经过第三方云服务。MIT 开源。

![Tern 界面](docs/screenshots/02-drive.png)

## 功能

- 文件/文件夹管理、拖拽上传、图片/视频/PDF/文本预览、搜索、收藏、回收站
- 多用户与存储配额、带密码和有效期的公开分享
- WebDAV：`/dav` 和 `/Tern`，支持 Finder、rclone 等客户端
- macOS 菜单栏客户端：挂载为 Finder 网络卷，可随登录自动连接
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

下载 [Tern-1.1.1.zip](macos/dist/Tern-1.1.1.zip)（或从 [Releases](https://github.com/XiaolongZhang-dev/tern/releases) 下载），把 `Tern.app` 拖到「应用程序」。若 Gatekeeper 拦截，右键 →「打开」。

打开菜单栏 Tern →「设置」：

```text
服务器地址：http://<NAS-IP>:8080/Tern
用户名：    网页端账号
密码：      网页端密码
```

连接后，Finder 的「位置」会出现 **Tern**，可拖到「个人收藏」固定。完整说明见 [docs/MAC.md](docs/MAC.md)。

## Windows 客户端

Windows 10/11 x64 托盘客户端，把网盘映射为 **`Tern (T:)`**，在「此电脑」里像网络盘一样使用。

从 [Releases](https://github.com/XiaolongZhang-dev/tern/releases/download/v1.1.1/Tern-Windows-x64.zip) 下载 `Tern-Windows-x64.zip`（或运行 `windows/build.ps1` 构建），解压后运行 `Tern.exe`：

1. 托盘 Tern →「设置」；
2. 填 `https://<NAS-IP>:8080/Tern`、用户名、密码，选择盘符；
3. 点「保存并连接」，然后打开「此电脑」里的 `Tern (T:)`。

需要 Windows **WebClient** 服务；大文件默认 50MB 限制的处理方式见 [docs/WINDOWS.md](docs/WINDOWS.md)。

## 文档

- [部署指南](docs/DEPLOY.md)：NAS、HTTPS、备份升级
- [macOS 客户端](docs/MAC.md)：构建、安装、Finder 集成
- [Windows 客户端](docs/WINDOWS.md)：安装、盘符映射、WebClient
- [架构](docs/ARCHITECTURE.md) · [API](docs/API.md)
- [路线图](ROADMAP.md) · [贡献指南](CONTRIBUTING.md) · [安全策略](SECURITY.md)

## 开发与测试

```bash
(cd server && npm ci && npm test)
(cd web && npm ci && npm run build)
(cd macos && ./build.sh)
cd windows && powershell -File build.ps1   # Windows
```

## 安全

公网访问请使用 HTTPS；WebDAV 使用 HTTP Basic 认证，不要将明文 HTTP 暴露到不可信网络。建议定期备份 `data/`。

## 参与贡献

欢迎提交 Issue 和 PR。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要公开提交 Issue。

## License

[MIT](LICENSE) © 2026 Tern contributors
