# 部署指南

Tern 的推荐部署方式是 Docker Compose：一个容器同时提供网页、REST API 与 WebDAV，数据落在宿主机的 `./data` 目录。

## 1. 通用 Docker 部署

```bash
cd tern
cp .env.example .env
```

编辑 `.env`：

```dotenv
SERVER_NAME=Tern
PORT=8080
ADMIN_USERNAME=admin
ADMIN_PASSWORD=请改成强密码
DEFAULT_QUOTA_GB=0          # 0 = 不限制
DATA_UID=1000
DATA_GID=1000
# PUBLIC_BASE_URL=https://disk.example.com
```

查看 NAS 上的用户 UID/GID：

```bash
id
# uid=1026(user) gid=100(users) groups=...
```

启动：

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f
```

访问 `http://<NAS-IP>:8080`。首次启动若未设置 `ADMIN_USERNAME/ADMIN_PASSWORD`，页面会引导创建管理员。

### 数据目录

```
data/
├── cloud.db          # SQLite 元数据（WAL 模式）
├── storage/<user>/   # 文件内容，文件名为内部 UUID
└── tmp/              # 上传临时文件
```

备份时停止容器或使用 SQLite 在线备份均可；最简单可靠的方式：

```bash
docker compose stop
tar czf tern-backup-$(date +%F).tar.gz data/
docker compose start
```

恢复时把 `data/` 放回原处再启动即可。容器升级不会修改数据格式，版本升级前仍建议备份。

### 直接拉取 Docker Hub 镜像（可选）

如果不想在 NAS 上构建，可以直接拉取预构建的多架构镜像。镜像名由发布者的
Docker Hub 命名空间决定。Tern 当前发布的镜像为 `acc110789/tern:latest`：

```bash
mkdir -p data
docker pull acc110789/tern:latest
docker run -d --name tern --restart unless-stopped \
  -p 8080:8080 \
  -v "$PWD/data:/data" \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD='请换成强密码' \
  -e DATA_UID="$(id -u)" \
  -e DATA_GID="$(id -g)" \
  acc110789/tern:latest
```

或者使用仓库提供的镜像版 Compose：

```bash
cp .env.example .env
docker compose -f docker-compose.hub.yml pull
docker compose -f docker-compose.hub.yml up -d
```

镜像同时支持 `linux/amd64` 和 `linux/arm64`，包含网页端、API 和 WebDAV。
推送 `v*` tag 时会由 GitHub Actions 自动发布镜像。

## 2. 群晖 Synology（Container Manager）

1. **File Station** 新建目录，例如 `/volume1/docker/tern`，把本项目文件上传进去；
2. **Container Manager → 项目 → 新增**，选择该目录中的 `docker-compose.yml`；
3. 在「环境」中设置 `ADMIN_PASSWORD`、`DATA_UID=1026`、`DATA_GID=100`（以群晖 `id` 输出为准）；
4. 端口映射保持 `8080:8080`，启动项目；
5. 浏览器访问 `http://群晖IP:8080`。

如果使用群晖自带反向代理（**控制面板 → 登录门户 → 高级 → 反向代理**）：

- 来源：`https://disk.example.com:443`
- 目的地：`http://127.0.0.1:8080`
- 在「自定义标题」中启用 WebSocket 不是必须的；如需大文件上传，建议在 Nginx 配置中设置 `client_max_body_size 0;` 和较长的 `proxy_read_timeout`。

## 3. QNAP / Unraid / 威联通

- **QNAP Container Station**：使用「应用程序」模式导入 `docker-compose.yml`，将 `./data` 换成 `/share/Container/tern/data`。
- **Unraid**：把项目放到 `/mnt/user/appdata/tern`，用 Compose Manager 启动；`DATA_UID=99`、`DATA_GID=100` 通常是 Unraid 的 `nobody/users`。
- **TrueNAS SCALE**：使用 Apps → Custom App 或 Dockge 运行 Compose 文件。

> 如果 NAS 的 Docker 面板要求填写路径，请使用绝对路径挂载数据卷，例如
> `-v /volume1/docker/tern/data:/data`。

## 4. 公网访问与 HTTPS（强烈推荐）

WebDAV 的 Basic 认证和登录 Cookie 在明文 HTTP 下都可能被窃听。公网使用请放在 HTTPS 反向代理后面，并只暴露 443。

### Caddy（最简）

```caddyfile
disk.example.com {
    reverse_proxy 127.0.0.1:8080
    request_body {
        max_size 0
    }
}
```

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name disk.example.com;

    ssl_certificate     /etc/letsencrypt/live/disk.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/disk.example.com/privkey.pem;

    client_max_body_size 0;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_request_buffering off;
    }
}
```

然后在 `.env` 中设置：

```dotenv
PUBLIC_BASE_URL=https://disk.example.com
TRUST_PROXY=true
COOKIE_SECURE=true
```

`PUBLIC_BASE_URL` 用于生成分享链接的绝对地址；`TRUST_PROXY` 让服务端正确识别 HTTPS。

> 不建议把 8080 直接映射到公网。若必须如此，至少使用强密码并限制来源 IP。

## 5. 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8080` | 容器内监听端口 |
| `DATA_DIR` | `/data` | 数据目录 |
| `SERVER_NAME` | `Tern` | 页面显示名称 |
| `ADMIN_USERNAME` | 空 | 首次启动自动创建的管理员用户名 |
| `ADMIN_PASSWORD` | 空 | 管理员密码（至少 8 位） |
| `ALLOW_REGISTRATION` | `false` | 是否允许公开注册 |
| `DEFAULT_QUOTA_GB` | `0` | 新用户默认配额，0 为不限制 |
| `MAX_UPLOAD_BYTES` | `21474836480` | 单次上传上限（默认 20 GiB） |
| `PUBLIC_BASE_URL` | 空 | 分享链接使用的公网地址 |
| `TRUST_PROXY` | `false` | 是否信任反向代理头 |
| `COOKIE_SECURE` | `auto` | Cookie 是否仅 HTTPS；auto 按请求协议判断 |
| `DATA_UID` / `DATA_GID` | `1000` / `1000` | 容器运行用户，需对 `data/` 有写权限 |

## 6. 健康检查与升级

```bash
curl -fsS http://127.0.0.1:8080/api/health
docker compose pull && docker compose up -d --build
```

`docker-compose.yml` 已内置 healthcheck，容器状态会显示 `healthy`。

## 7. 常见问题

**上传大文件失败**
- 检查反向代理的 `client_max_body_size`、超时设置；
- 检查 `MAX_UPLOAD_BYTES` 是否足够；
- NAS 磁盘空间与用户配额。

**容器启动后无法写入 /data**
- 检查 `.env` 中 `DATA_UID`/`DATA_GID` 是否与 `data/` 所有者一致；
- 可临时执行 `sudo chown -R 1000:1000 data/`。

**Finder 无法挂载**
- 先在浏览器确认账号密码正确；
- 用 `curl -u 用户名:密码 -X PROPFIND -H 'Depth: 0' http://NAS:8080/Tern` 检查是否返回 207；
- 公网请使用 `https://` 地址；
- 详见 [MAC.md](MAC.md)。

**忘记管理员密码**

停止容器，用 SQLite 命令行无法轻易重置 scrypt 密码；推荐通过环境变量重建管理员（仅当没有用户时生效），或从备份恢复。请妥善保存密码。


## 8. Docker Hub 自动发布（维护者）

镜像发布工作流在 [`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml)：

- 推送 `v*` tag 时构建并推送 `linux/amd64` + `linux/arm64` 镜像；
- tag `v1.1.1` 会生成 Docker Hub 的 `1.1.1`、`1.1`、`1`、`latest`；
- 手动运行 `workflow_dispatch` 会生成 `edge` 和 `latest` 镜像；
- 使用 GitHub Actions cache，不重复构建所有层。

首次使用前，在 GitHub 仓库设置中添加两个 Actions secrets：

| Secret | 内容 |
|---|---|
| `DOCKERHUB_USERNAME` | Docker Hub 用户名/命名空间 |
| `DOCKERHUB_TOKEN` | Docker Hub Access Token（Read & Write） |

创建 token：Docker Hub → Account settings → Security → New access token。

```bash
gh secret set DOCKERHUB_USERNAME --body 'acc110789' -R XiaolongZhang-dev/tern
gh secret set DOCKERHUB_TOKEN --body 'dckr_pat_xxx' -R XiaolongZhang-dev/tern

# 手动构建：会发布 latest 和 edge（适合第一次验证）
gh workflow run docker-publish.yml -R XiaolongZhang-dev/tern

# 正式版本：先更新版本号，再推送新的 v* tag，例如 v1.1.2
git tag v1.1.2
git push origin v1.1.2
```

发布后的镜像名：

```text
docker.io/<DOCKERHUB_USERNAME>/tern:latest
docker.io/<DOCKERHUB_USERNAME>/tern:1.1.1
```
