# 稽查工单监控中心

一个可快速部署的稽查工单监控系统，支持导入工单、超期/预警监控、邮件通知、升级催办、负责人与班组维表、工单闭环处理，以及对外开放 API。

## 功能特性

- XLS / XLSX / CSV 导入
- 主题为空工单自动隐藏
- 超期 / 前置预警 / 正常自动分类
- 邮件通知与升级催办规则
- 通知记录中心
- 负责人 / 班组维表维护
- 工单详情抽屉、跟进记录、复核、关闭闭环
- 趋势分析 / 班组分布 / 负责人排行
- 对外开放 API（`/api/open/tickets`）
- Docker / 直接运行两种部署方式

## 本地启动

```bash
npm install
npm start
```

默认访问地址：

- 本机：`http://127.0.0.1:3210`
- 外网：`http://你的服务器IP:3210`

## 环境变量

复制 `.env.example` 后按需填写：

```bash
cp .env.example .env
```

关键配置：

```env
PORT=3210
HOST=0.0.0.0
REMINDER_INTERVAL_MS=600000
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=demo@example.com
SMTP_PASS=your-password
SMTP_FROM=demo@example.com
SMS_ENABLED=false
```

## Docker 部署

```bash
docker compose up -d --build
```

## 主要接口

### 监控看板
- `GET /api/dashboard`

### 工单列表
- `GET /api/tickets`
- `GET /api/tickets/:id`

### 导入
- `POST /api/import/preview`
- `POST /api/import`

### 催办与通知
- `GET /api/notification-settings`
- `POST /api/notification-settings`
- `GET /api/notifications`
- `POST /api/run-reminders`

### 维表
- `GET /api/directory`
- `POST /api/directory`

### 工单闭环
- `POST /api/tickets/:id/follow-ups`
- `POST /api/tickets/:id/process`
- `POST /api/tickets/:id/review`
- `POST /api/tickets/:id/close`

### 开放 API
- `GET /api/open/tickets`
- `GET /api/openapi.json`
- `GET /api/open/docs`


## 快速部署

### 一键部署脚本

```bash
bash deploy.sh
```

### 详细部署说明

请查看：

- `DEPLOY.md`

### 离线一键部署（内网）

```bash
bash offline-package.sh
```

生成离线包后，拷贝到内网机器执行：

```bash
bash offline-deploy.sh
```

## GitHub 后快速部署建议

1. 克隆仓库
2. 配置 `.env`
3. 执行 `npm install && npm start`
4. 或直接 `docker compose up -d --build`
5. 如需公网访问，建议再配 Nginx / Caddy 反向代理与 HTTPS

## 说明

- `data/`、`uploads/`、`.env` 已加入 `.gitignore`，不会默认上传运行数据
- 如果你想附带演示数据，请手动准备一个脱敏样例文件放到 `docs/` 或单独新建 `sample-data/`
