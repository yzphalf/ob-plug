# Binance API Proxy for Obsidian

这是一个简单的 Vercel Function，用于转发 Obsidian 插件的请求到 Binance API，解决 CORS 问题并保护 API Key。

## 🎯 为什么需要这个？

1.  **CORS**: 浏览器（Obsidian 基于 Electron）默认阻止跨域请求，无法直接访问 binance.com。
2.  **安全**: 不要在 Obsidian 插件代码或设置中直接存储 Secret Key。虽然本代理目前主要是为了解决 CORS，但在服务端处理签名更安全。

## 🚀 快速开始

### 方式一：部署到 Vercel (推荐)

1.  将本项目推送到 GitHub。
2.  在 Vercel 导入项目，Root Directory 选择 `vercel-proxy`。
3.  添加环境变量：
    *   `BINANCE_API_KEY`: 你的币安 API Key
    *   `BINANCE_SECRET_KEY`: 你的币安 Secret Key
    *   (可选) `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`: 如果你使用 OKX。
4.  部署完成后，复制分配的域名（例如 `https://xxx.vercel.app`）。
5.  在 Obsidian 插件设置中填入完整路径：`https://xxx.vercel.app/api/binance`。

### 方式二：本地运行

你需要安装 `vercel` 命令行工具来模拟无服务器环境。

```bash
# 1. 安装 Vercel CLI
npm i -g vercel

# 2. 进入目录
cd vercel-proxy

# 3. 安装依赖
npm install

# 4. 登录 Vercel (首次运行需要)
vercel login

# 5. 启动开发服务器
vercel dev
```

启动后，代理运行在 `http://localhost:3000`。
插件设置填入：`http://localhost:3000/api/binance`。

> 注意：本地运行时，你需要通过 `.env` 文件或 `vercel env pull` 来配置环境变量。

## 📂 文件结构

*   `api/binance.js`: 处理 `/api/binance` 请求的核心逻辑。
*   `package.json`: 依赖定义。

## 🛠️ API 接口

此代理接受所有标准 Binance API 参数，并自动处理签名（对于需要鉴权的接口）。

*   **GET /api/binance?path=/fapi/v1/userTrades&...**: 转发到 Binance 合约接口。
