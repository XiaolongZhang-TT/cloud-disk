# Tern

[English](README.en.md) | **简体中文**

[![CI](https://github.com/XiaolongZhang-dev/tern/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/XiaolongZhang-dev/tern/actions/workflows/ci.yml)
[![Docker Publish](https://github.com/XiaolongZhang-dev/tern/actions/workflows/docker-publish.yml/badge.svg?branch=main)](https://github.com/XiaolongZhang-dev/tern/actions/workflows/docker-publish.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/XiaolongZhang-dev/tern)](https://github.com/XiaolongZhang-dev/tern/releases)
[![GitHub stars](https://img.shields.io/github/stars/XiaolongZhang-dev/tern?style=flat)](https://github.com/XiaolongZhang-dev/tern/stargazers)

一个可以部署在 NAS 上的私有网盘：**Docker 一键部署**，网页端界面简洁美观，macOS 客户端可把网盘挂载到 Finder 的「位置」中，与 iCloud 云盘并排显示。

> 数据完全属于你：文件保存在自己的 NAS 上，不经过任何第三方云服务。项目使用 MIT 协议开源，欢迎参与贡献。

![Tern 网页端](docs/screenshots/02-drive.png)

## 功能

- **网页端**：文件/文件夹管理、拖拽上传（带实时进度）、网格/列表视图、图片/视频/音频/PDF/文本预览
- **整理**：搜索、最近访问、收藏、多选批量下载/删除、移动、重命名
- **分享**：生成公开链接，可设置访问密码和有效期，支持文件与文件夹（文件夹打包 ZIP）
- **回收站**：误删可恢复，也可彻底删除、一键清空
- **多用户**：管理员可创建成员并设置空间配额，每人数据互相隔离
- **WebDAV**：`/dav` 与 `/Tern` 端点，Finder、Windows 资源管理器、rclone 等均可连接
- **macOS 客户端**：菜单栏常驻，一键把网盘挂载成 Finder 网络卷，出现在「位置」栏，可随登录自动挂载
- **Docker**：单容器，SQLite + 本地文件存储，支持 x86_64 / arm64 NAS，支持 PUID/PGID 非 root 运行

## 界面预览

| 登录 | 文件管理 |
|---|---|
| ![登录](docs/screenshots/01-login.png) | ![文件管理](docs/screenshots/02-drive.png) |

| 相册与缩略图 | 图片预览 |
|---|---|
| ![相册](docs/screenshots/03-folder.png) | ![预览](docs/screenshots/04-preview.png) |

| 列表视图 | 深色模式 |
|---|---|
| ![列表](docs/screenshots/05-list.png) | ![深色](docs/screenshots/10-dark.png) |

| 设置与成员管理 | 公开分享页 |
|---|---|
| ![设置](docs/screenshots/09-settings.png) | ![分享](docs/screenshots/11-public-file.png) |

手机端同样可用：侧边栏收起为抽屉，工具栏自适应。

<p align="center">
  <img src="docs/screenshots/13-mobile-drive.png" width="300" alt="手机端">
</p>

## 快速开始（Docker 源码构建）

```bash
# 1. 获取代码后进入目录
cd tern

# 2. 准备配置
cp .env.example .env
# 编辑 .env：至少修改 ADMIN_PASSWORD；
# 在 NAS 上用 `id` 查看 UID/GID，填入 DATA_UID / DATA_GID

# 3. 构建并启动（会从源码构建 Web 前端，无需本机 Node）
docker compose up -d --build
```

打开 `http://<NAS-IP>:8080`：

- 如果 `.env` 里设置了 `ADMIN_USERNAME` / `ADMIN_PASSWORD`，首次启动会自动创建管理员；
- 否则会进入初始化页面，创建第一个管理员账号。

![首次运行初始化](docs/screenshots/00-setup.png)

数据默认保存在 `./data`（SQLite 数据库 + 文件内容），升级容器不会丢失。备份时直接备份整个 `data/` 目录即可。

> 已在 Docker 中验证多阶段构建、非 root 运行（`DATA_UID=501`）、健康检查、SPA、登录和 WebDAV。详见 [docs/DEPLOY.md](docs/DEPLOY.md)。

## 直接使用 Docker Hub 镜像（无需构建）

推送 `v*` tag 时，GitHub Actions 会自动构建并发布多架构镜像到 Docker Hub
（`linux/amd64` + `linux/arm64`）。镜像已经包含网页端、REST API 和 WebDAV，
NAS 上不需要 Node，也不需要本地构建。

把下面的 `your-dockerhub-username` 换成实际 Docker Hub 命名空间：

```bash
export TERN_IMAGE=your-dockerhub-username/tern:latest

docker pull "$TERN_IMAGE"
mkdir -p data

docker run -d --name tern --restart unless-stopped \
  -p 8080:8080 \
  -v "$PWD/data:/data" \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD='请换成强密码' \
  -e DATA_UID="$(id -u)" \
  -e DATA_GID="$(id -g)" \
  "$TERN_IMAGE"
```

打开 `http://<NAS-IP>:8080` 即可。上传大小、反向代理的 `client_max_body_size`
等配置与源码构建方式完全相同。

也可以使用专门的镜像版 Compose 文件：

```bash
cp .env.example .env
# 在 .env 中增加：
# TERN_IMAGE=your-dockerhub-username/tern:latest

docker compose -f docker-compose.hub.yml pull
docker compose -f docker-compose.hub.yml up -d
```

常用 tag：

| Tag | 说明 |
|---|---|
| `latest` | 最新稳定版本 |
| `1.1.1` / `1.1` / `1` | 语义化版本 tag |
| `edge` | 手动触发 `workflow_dispatch` 构建的测试镜像 |

> 维护者：在仓库 **Settings → Secrets and variables → Actions** 中添加
> `DOCKERHUB_USERNAME` 和 `DOCKERHUB_TOKEN`，然后手动运行一次（发布 `latest` + `edge`），或为新版本推送 `v*` tag。
> [Docker Publish](https://github.com/XiaolongZhang-dev/tern/actions/workflows/docker-publish.yml)。
> Docker Hub token 只需要 Read & Write 权限。

## macOS 客户端（挂载到 Finder）

客户端用 `NetFS` 把服务端 WebDAV 挂载成真正的 macOS 网络卷：在 Finder 侧边栏的 **位置（Locations）** 中与 iCloud Drive 并列，可直接读写、拖拽、Quick Look，无需 Apple 开发者账号。

**方式 A：使用仓库中构建好的应用（Apple Silicon / arm64）**

解压 [`macos/dist/Tern-1.1.1.zip`](macos/dist/Tern-1.1.1.zip)（也可从 [Releases](https://github.com/XiaolongZhang-dev/tern/releases) 下载），把其中的 `Tern.app` 拖到「应用程序」。校验下载文件：

```bash
cd macos/dist && shasum -a 256 -c Tern-1.1.1.zip.sha256
```

> 预构建包为 Apple Silicon（arm64）；Intel Mac 请使用方式 B 构建：
> `cd macos && ARCHS=x86_64 ./build.sh`。

若从网络传输后被 Gatekeeper 拦截，请右键 →「打开」，或执行：

```bash
xattr -dr com.apple.quarantine /Applications/Tern.app
```

**方式 B：从源码构建**

```bash
cd macos
./build.sh
open dist/Tern.app
```

首次打开：

1. 菜单栏出现云朵图标 → 打开「设置」；
2. 填写服务器地址，例如 `http://192.168.1.10:8080/Tern`（本机测试为 `http://127.0.0.1:8080/Tern`）；
3. 填写与网页端相同的用户名、密码，点击「连接」；
4. Finder 的「位置」中会出现 **Tern**，可拖到「个人收藏」固定；
5. 在设置中可开启「登录时自动启动 / 自动连接」。

命令行验收挂载链路：

```bash
macos/tools/mount-smoke --url http://127.0.0.1:8080/Tern --user admin --password '你的密码'
# RESULT: PASS (exit 0)
```

完整说明（Gatekeeper、钥匙串、登录启动、HTTPS、卸载、排错）见 [docs/MAC.md](docs/MAC.md)。

## 文档

- [docs/DEPLOY.md](docs/DEPLOY.md) — 群晖 / QNAP / Unraid 部署、HTTPS 反向代理、备份升级、排错
- [docs/MAC.md](docs/MAC.md) — macOS 客户端构建、安装、Finder 集成、卸载
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 架构与安全设计
- [docs/API.md](docs/API.md) — REST / WebDAV 接口契约
- [ROADMAP.md](ROADMAP.md) — 已知限制与后续计划
- [CONTRIBUTING.md](CONTRIBUTING.md) — 开发环境、测试与提交规范
- [CHANGELOG.md](CHANGELOG.md) — 版本变更记录
- [SECURITY.md](SECURITY.md) — 安全模型与漏洞报告方式

## 架构

```
Browser (React SPA) ──┐
                      ├── HTTP :8080 ── Node.js (Express) ── SQLite (metadata)
macOS Finder ──WebDAV─┘                     │
                                            └── data/storage/<user>/<uuid> (blobs)
```

- 一个容器同时提供网页、REST API、WebDAV，反向代理只需转发一个上游；
- 元数据存 SQLite（WAL），文件内容以 UUID 存放，重命名/移动不搬文件；
- 密码使用 scrypt 哈希，会话 Cookie HttpOnly，分享密码可选、可过期；
- WebDAV 实现 `PROPFIND / LOCK / UNLOCK / MOVE / Range GET` 等 Finder 读写所需方法。

## 本地开发

```bash
# 终端 1：后端（Node 24+，零原生依赖）
cd server
npm install
PORT=18080 DATA_DIR=./.data ADMIN_USERNAME=admin ADMIN_PASSWORD=tern123 npm run dev

# 终端 2：前端（Vite，代理到 18080）
cd web
npm install
npm run dev
```

访问 `http://127.0.0.1:5173`。生产构建：`cd web && npm run build`，后端会自动托管 `web/dist`。

### 测试

```bash
cd server && npm test      # 35 个集成测试：认证、文件、分享、WebDAV
cd web && npm run build    # TypeScript + 生产构建
cd macos && ./build.sh     # 菜单栏应用 + 挂载 CLI
```

服务端测试覆盖上传/下载、Range、移动/复制、回收站、配额、分享密码、WebDAV 锁与只读/读写挂载等。macOS 挂载已在真实 Finder 会话中验证：挂载 → 列目录 → 写入 → 读回 → 删除 → 卸载全部通过。

## 系统要求

- 服务端：Docker / Docker Compose；或 Node.js 24+
- macOS 客户端：macOS 13+（Apple Silicon / Intel），源码构建需要 Xcode Command Line Tools
- 浏览器：Chrome / Edge / Safari / Firefox 最近两个大版本

## 安全提示

- 公网使用请务必通过反向代理启用 HTTPS，并设置强密码；
- WebDAV 使用 HTTP Basic 认证，请勿在不可信网络中直接暴露明文 HTTP；
- 建议将 `data/` 放在 NAS 的 RAID/快照卷上，并定期备份。

## 参与贡献

这是一个开源项目，欢迎提交 Issue、改进文档、翻译或代码：

- 先阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- 功能建议和缺陷请使用 [Issues](https://github.com/XiaolongZhang-dev/tern/issues)
- 安全问题请**不要**公开提 Issue，按 [SECURITY.md](SECURITY.md) 私下报告
- 想参与但不知道从哪开始，可以看 [ROADMAP.md](ROADMAP.md) 或 `good first issue`

如果这个项目对你有帮助，欢迎点一个 Star。

## License

[MIT](LICENSE) © 2026 Tern contributors

第三方依赖的许可证信息以其各自仓库为准。macOS 客户端使用 Apple 系统框架，分发时请遵守 Apple 的相关条款。
