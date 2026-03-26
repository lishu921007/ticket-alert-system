# DEPLOY.md

## 一、适用场景

本项目适合以下部署方式：

1. **直接在 Linux 服务器运行 Node.js**
2. **使用 Docker Compose 部署**
3. **通过 Nginx / Caddy 反向代理对外提供访问**

推荐环境：

- Ubuntu 22.04 / 24.04
- Node.js 22
- 1C2G 以上服务器

---

## 二、方式一：直接运行（最快）

### 1. 安装依赖

```bash
sudo apt update
sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. 拉取代码

```bash
git clone https://github.com/lishu921007/ticket-alert-system.git
cd ticket-alert-system
```

### 3. 安装项目依赖

```bash
npm install
```

### 4. 配置环境变量

```bash
cp .env.example .env
nano .env
```

至少确认：

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

### 5. 启动项目

```bash
npm start
```

访问：

- 本机：`http://127.0.0.1:3210`
- 外网：`http://服务器IP:3210`

---

## 三、方式二：Docker Compose（推荐）

### 1. 安装 Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo systemctl enable docker
sudo systemctl start docker
```

### 2. 拉取代码并启动

```bash
git clone https://github.com/lishu921007/ticket-alert-system.git
cd ticket-alert-system
cp .env.example .env
docker compose up -d --build
```

### 3. 查看状态

```bash
docker compose ps
docker compose logs -f
```

---

## 四、推荐：配 Nginx 反代

如果你要长期对外提供访问，建议用 Nginx 做反向代理。

### 1. 安装 Nginx

```bash
sudo apt update
sudo apt install -y nginx
```

### 2. 创建配置

```bash
sudo nano /etc/nginx/sites-available/ticket-alert-system
```

写入：

```nginx
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3210;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 3. 启用配置

```bash
sudo ln -s /etc/nginx/sites-available/ticket-alert-system /etc/nginx/sites-enabled/ticket-alert-system
sudo nginx -t
sudo systemctl reload nginx
```

---

## 五、HTTPS（可选）

如果你有域名，建议配 Let’s Encrypt：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx
```

---

## 六、后台常驻运行（PM2）

如果你不用 Docker，可以用 PM2：

```bash
sudo npm install -g pm2
cd ticket-alert-system
pm2 start server.js --name ticket-alert-system
pm2 save
pm2 startup
```

查看状态：

```bash
pm2 status
pm2 logs ticket-alert-system
```

---

## 七、升级更新

以后更新项目代码：

```bash
cd ticket-alert-system
git pull
npm install
pm2 restart ticket-alert-system
```

如果是 Docker：

```bash
cd ticket-alert-system
git pull
docker compose up -d --build
```

---

## 八、数据目录说明

运行后会自动生成：

- `data/`：工单数据、通知记录
- `uploads/`：上传文件

这些目录默认不会上传到 GitHub。

如果你迁移服务器，记得一起备份：

```bash
tar -czf backup.tar.gz data uploads .env
```

---

## 九、健康检查

可访问：

- `GET /api/health`

例如：

```bash
curl http://127.0.0.1:3210/api/health
```

---

## 十、推荐部署顺序

最推荐顺序：

1. 拉取代码
2. 配 `.env`
3. `docker compose up -d --build`
4. 配 Nginx
5. 配 HTTPS

这样后面换服务器也非常快。
