# TradeTrace | 交易迹

A professional Obsidian plugin designed to synchronize trade data from cryptocurrency exchanges, generate automated trading journals, and visualize trades on interactive K-line charts.
一个专业的 Obsidian 插件，用于同步加密货币交易所数据，自动生成交易日志，并在交互式 K 线图上进行可视化复盘。

---

## Design Philosophy | 设计哲学

The core innovation of TradeTrace is the **"Unified Replay Workflow"**. Unlike traditional tools that only fetch data, this plugin bridges the gap between raw exchange data and deep human reflection by:
1.  **Semantic Aggregation**: Converting fragmented order fills into meaningful "Trade Sessions".
2.  **Contextual Visualization**: Embedding interactive, auto-focused K-line charts directly within personal notes.
3.  **Knowledge Persistence**: Ensuring that market data updates never overwrite the trader's personal analysis.

TradeTrace 的核心创新在于其**“三位一体的复盘工作流”**。不同于单纯抓取数据的工具，本插件通过以下三个维度打通了交易所原始数据与深度交易思考之间的隔阂：
1.  **语义化聚合**：将零散的成交单自动转化为具有交易意义的“场次”。
2.  **上下文可视化**：在个人笔记中嵌入可交互、自动聚焦的 K 线图表。
3.  **知识持久化**：确保市场数据的更新永远不会覆盖交易者宝贵的个人分析心得。

---

## Core Features | 核心功能

### 1. Data Synchronization | 数据同步
*   **Multi-Exchange Support**: Seamlessly fetch data from Binance (Spot, Margin, Futures) and OKX.
    **多交易所支持**: 支持从币安（现货、杠杆、合约）和 OKX 自动拉取成交记录。
*   **Intelligent Aggregation**: Automatically aggregates fragmented fills into complete trading sessions (Trades).
    **智能聚合**: 自动将零散的成交单（Fills）聚合成完整的交易场次（Trades）。
*   **Incremental Updates**: Efficient synchronization that only retrieves new data since the last update.
    **增量更新**: 仅同步自上次更新以来的新数据，确保高效运行。

### 2. Automated Journals | 自动化日志
*   **Markdown Generation**: Automatically creates detailed Obsidian notes for every trade.
    **文档生成**: 为每笔交易自动生成详细的 Markdown 笔记。
*   **Smart Metadata**: populates Frontmatter with key metrics like PnL, ROI, and direction for Dataview compatibility.
    **智能元数据**: 自动填充盈亏、回报率、方向等元数据，完美支持 Dataview 插件。
*   **Preservation of Content**: Intelligently merges data updates while preserving user-written analysis and comments.
    **内容保留**: 更新交易数据时，会自动保留用户手动编写的复盘心得与笔记。

### 3. Interactive Visualization | 交互式可视化
*   **TradingView Engine**: High-performance K-line charts powered by lightweight-charts.
    **专业图表**: 基于 lightweight-charts 的高性能 K 线图表。
*   **Trade Markers**: Automatically marks entry, scale-in, and exit points on the chart.
    **交易标记**: 在图表上自动标记开仓、加仓和平仓位置。
*   **Note Integration**: Charts automatically focus on the relevant symbol and time period when opening a trade note.
    **笔记联动**: 打开交易笔记时，图表会自动切换交易对并定位到对应的时间段。

---

## Installation | 安装步骤

### 1. API Proxy Setup | 部署 API 代理
Due to CORS restrictions in Obsidian, an API proxy is required. Use the provided Vercel proxy template for easy deployment.
由于 Obsidian 的 CORS 限制，需要通过代理访问交易所 API。建议使用项目中提供的 Vercel 模板。

*   **Location**: `/vercel-proxy`
*   **Environment Variables**: `BINANCE_API_KEY`, `BINANCE_SECRET_KEY`, `OKX_API_KEY`, etc.
*   **环境变量**: 设置对应的 API Key 和 Secret。

### 2. Plugin Installation | 安装插件
1.  Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
    从 Release 页面下载 `main.js`, `manifest.json` 和 `styles.css`。
2.  Place them in `.obsidian/plugins/obsidian-tradetrace/`.
    将其存放在 `.obsidian/plugins/obsidian-tradetrace/` 目录中。
3.  Enable the plugin in Obsidian settings.
    在 Obsidian 设置中启用插件。

---

## Usage | 使用指南

1.  **Configure API**: Enter your proxy URL and API settings in the plugin configuration tab.
    **配置 API**: 在插件设置页面输入代理地址和 API 信息。
2.  **Sync Data**: Run the command `Fetch & Process Data` from the command palette.
    **同步数据**: 通过命令面板运行 `Fetch & Process Data` 命令。
3.  **Review Trades**: Open generated notes to view trading performance and the integrated K-line chart.
    **进行复盘**: 打开生成的笔记查看交易表现及联动的 K 线图表。

---

## Originality Statement | 尊重原创

This project is open-source under the MIT License. You are free to fork and modify the code. However, if you use the core logic (Data Sync -> Note Gen -> Chart Replay) in your own project, we kindly ask you to clearly credit the original author (`yzphalf`) and link back to this repository. Please do not simply re-package this plugin under a different name without significant changes.

本项目遵循 MIT 协议开源。你可以自由 Fork 和修改代码。但如果你在其基础上开发新产品，请务必保留原作者（`yzphalf`）的署名并链接回本仓库。请勿在未做实质性修改的情况下，直接重新打包发布本插件。

---

## License | 许可证
MIT License
