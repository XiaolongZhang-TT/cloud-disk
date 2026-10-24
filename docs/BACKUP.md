# 备份与恢复

Tern 的备份包含两部分：

- `cloud.db`：用户、节点、分享、版本历史等元数据；
- `storage/`：文件内容和历史版本 blob。

## 创建备份

管理员在网页端进入 **设置 → 数据备份**，点击 **下载完整备份**。

接口：

```http
GET /api/admin/backup
```

返回一个 ZIP，包含 `cloud.db` 和 `storage/`。备份使用 SQLite `VACUUM INTO` 生成一致数据库快照，不需要停服务。

## 恢复备份

恢复会替换当前数据，**必须先停止 Tern 容器或 Node 进程**。

```bash
# 1. 停止容器
docker stop tern

# 2. 在仓库根目录执行
./scripts/restore-backup.sh /path/to/tern-backup-YYYY-MM-DD.zip ./data

# 3. 启动
docker start tern
```

脚本会把现有数据目录移动到 `data.pre-restore-<时间>` 作为安全副本，然后解压备份。

## 建议

- 至少保留一份异地备份；
- 备份文件含账号、分享、历史版本等敏感信息，请妥善保存；
- NAS 的 RAID 不能替代备份：误删、勒索软件、整机故障都可能同时影响 RAID 数据。
