# MiSub D1 数据库配置指南

## 📋 概述

本指南将帮助您为 MiSub 系统配置 Cloudflare D1 数据库，以解决 KV 存储的写入限制问题。

## 🚀 快速开始

### 1. 创建 D1 数据库

在项目根目录执行以下命令：

```bash
# 创建 D1 数据库
npx wrangler d1 create misub
```

命令执行后，您会看到类似以下的输出：
```
✅ Successfully created DB 'misub' in region APAC
Created your database using D1's new storage backend. The new storage backend is not yet recommended for production workloads, but backs up your data via point-in-time restore.

[[d1_databases]]
binding = "MISUB_DB"
database_name = "misub"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 2. 生成部署时配置

独立部署时，将上一步输出的数据库 ID 写入私有的部署时 Wrangler 配置：

```toml
[[d1_databases]]
binding = "MISUB_DB"
database_name = "misub"
database_id = "your-actual-database-id-here"  # 替换为实际的数据库 ID
```

EasyProxy 根仓库用户不应修改并提交 MiSub 的 `wrangler.jsonc`。根生命周期工具会
根据 `topology.yaml` 发现数据库，并在临时目录生成包含精确 ID 的部署配置。

### 3. 初始化数据库表结构

```bash
# 查看待执行迁移
npx wrangler d1 migrations list misub --remote

# 以 expand-only 方式升级或初始化数据库
npx wrangler d1 migrations apply misub --remote
```

`schema.sql` 只用于构建全新数据库；已有数据库必须使用 `migrations/`。不要编辑
已经应用的 migration，也不要用新的空数据库绕过迁移失败。

### 4. 部署应用

```bash
# 构建并部署
npm run build
npx wrangler pages deploy
```

## 🔧 使用方法

### 在设置中切换存储类型

1. 登录 MiSub 管理界面
2. 打开"设置"页面
3. 在"数据存储类型"部分选择"D1 数据库"
4. 点击"保存设置"

### 数据迁移

如果您已经有 KV 中的数据，可以使用内置的迁移功能：

1. 在设置页面中，当存储类型为"KV 存储"时
2. 点击"🚀 迁移数据到 D1 数据库"按钮
3. 确认迁移操作
4. 等待迁移完成
5. 系统会逐项读回验证后，将 D1 中的设置标记为 `storageType=d1`

该操作可以重复执行。目标 D1 已存在相同数据时只验证；若存在不同数据则停止，
不会覆盖目标数据，也不会删除 KV 原数据。

## 📊 存储类型对比

| 特性 | KV 存储 | D1 数据库 |
|------|---------|-----------|
| 写入配额 | KV 配额 | D1 配额 |
| 查询速度 | 极快 | 快 |
| 数据结构 | 键值对 | 关系型 |
| 成本 | 较低 | 中等 |
| 适用场景 | 读多写少 | 频繁更新 |

## ⚠️ 注意事项

1. **数据迁移是单向的**：从 KV 迁移到 D1 后，建议不要再切换回 KV
2. **性能差异**：D1 查询可能比 KV 稍慢，但写入无限制
3. **成本考虑**：D1 有不同的计费模式，请查看 Cloudflare 定价
4. **备份要求**：迁移前必须创建完整加密备份并在临时 D1 中完成恢复演练
5. **禁止静默切换**：选定后端缺少绑定时请求会失败，不会切换到另一套空数据

## 🔍 故障排除

### 常见问题

**Q: 创建数据库时提示权限错误**
A: 确保您已登录 Cloudflare 账户：`wrangler auth login`

**Q: 部署后无法访问 D1 数据库**
A: 检查部署时 Wrangler 配置中的数据库名称、ID 和 `MISUB_DB` binding 是否一致

**Q: 迁移失败**
A: 检查 D1 数据库是否正确配置，并查看浏览器控制台的错误信息

**Q: 切换存储类型后请求失败**
A: 这是 fail-closed 保护。先绑定目标存储并执行可验证迁移，不要创建空数据库替代。

**Q: 保存设置时提示 "保存设置失败"**
A: 这通常是因为 KV 写入限制或存储类型配置问题：
1. 如果使用 KV 存储，可能遇到写入限制，建议迁移到 D1
2. 如果已迁移到 D1，请确保数据库表结构正确
3. 检查浏览器控制台的详细错误信息

### 验证配置

您可以通过以下命令验证 D1 数据库配置：

```bash
# 列出所有 D1 数据库
npx wrangler d1 list --json

# 查询迁移、业务表和 Cron 扩展表
npx wrangler d1 execute misub --remote --command="SELECT migration_id,name FROM schema_migrations ORDER BY migration_id; SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

## 📞 支持

如果您在配置过程中遇到问题，请：

1. 检查 Cloudflare Workers 控制台的日志
2. 查看浏览器开发者工具的网络和控制台选项卡
3. 确认 wrangler.toml 配置正确
4. 验证数据库表已正确创建

---

配置完成后，您的 MiSub 系统将能够使用 D1 数据库，有效解决 KV 写入限制的问题！
