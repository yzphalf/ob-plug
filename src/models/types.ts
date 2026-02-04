export interface RawPositionRisk {
    symbol: string; // 交易对，例如 BTCUSDT
    positionAmt: string; // 持仓数量 (带正负号，正数表示多头，负数表示空头)
    entryPrice: string; // 开仓均价
    markPrice: string; // 标记价格
    unRealizedProfit: string; // 未实现盈亏
    liquidationPrice: string; // 预估强平价格
    leverage: string; // 当前杠杆倍数
    maxNotionalValue: string; // 当前杠杆下允许的最大名义价值
    marginType: string; // 保证金模式，例如 "ISOLATED" (逐仓) 或 "CROSSED" (全仓)
    isolatedMargin: string; // 逐仓保证金 (仅逐仓模式下有值)
    isAutoAddMargin: string; // 是否自动追加保证金 (仅逐仓模式下有值)
    positionSide: string; // 持仓方向，例如 "BOTH", "LONG", "SHORT"
    updateTime: number; // 信息更新时间 (Unix时间戳，毫秒)
    notional: string; // 持仓名义价值 (USDT计价)
    isolatedWallet: string; // 逐仓钱包余额 (仅逐仓模式下有值)
    // Add other fields as needed based on Binance API documentation
}

/**
 * 原始订单信息 (Binance API /fapi/v1/allOrders 响应)
 */
export interface RawOrder {
    ordId: string; // 订单ID
    state: string; // 订单状态，例如 NEW, FILLED, CANCELED
    instId: string; // 交易对
    uTime: string; // 更新时间
    cTime: string; // 创建时间
    side: string; // 买卖方向 BUY/SELL
    posSide: string; // 持仓方向 LONG/SHORT/BOTH
    ordType: string; // 订单类型 LIMIT/MARKET
    reduceOnly: boolean; // 是否只减仓
    avgPx: string; // 平均成交价格
    accFillSz: string; // 累计成交数量
    // 以下字段在binance.ts中被忽略或设为默认值
    // fee: string; // 手续费 (Binance order history不包含)
    // feeCcy: string; // 手续费币种 (Binance order history不包含)
    // lever: string; // 杠杆倍数 (Binance order history不包含)
    // category: string; // 订单类别 (Binance order history不包含)
    slTriggerPx: string; // 止损触发价
    tpTriggerPx: string; // 止盈触发价 (Binance order history不包含)
}

/**
 * 原始成交信息 (Binance API /fapi/v1/userTrades 响应)
 */
export interface RawFill {
    instId: string; // 交易对
    tradeId: string; // 成交ID
    ordId: string; // 订单ID
    side: string; // 买卖方向 BUY/SELL
    fillPx: string; // 成交价格
    fillSz: string; // 成交数量
    fee: string; // 手续费
    ts: string; // 成交时间
    posSide: string; // 持仓方向 LONG/SHORT/BOTH
    feeCcy: string; // 手续费币种
    mgnMode: string; // 保证金模式 (例如 ISOLATED)
    reduceOnly: boolean; // 是否只减仓 (maker字段在binance.ts中被映射到此处)
    execType: string; // 执行类型，例如 TRADE
    ccy: string; // 结算币种，例如 USDT
    subType: string; // 子类型 (e.g., 'Taker')
    part: string; // 部分成交 (e.g., 'FILL')
    origTradeId: string; // 原始成交ID
    // 以下字段在binance.ts中被忽略或设为默认值
}

/**
 * 原始账单/资金流信息 (Binance API /fapi/v1/income 响应)
 */
export interface Bill {
    instId: string; // 交易对 (在income接口中可能为空)
    ccy: string; // 币种
    balChg: string; // 资金变动金额
    ts: string; // 发生时间
    type: string; // 资金类型，例如 FUNDING_FEE (资金费用), TRANSFER, COMMISSION
}

/**
 * 原始K线数据 (Binance API /fapi/v1/klines 响应)
 * 注意: K线数据是一个二维数组，这里定义的是单个K线对象映射后的结构
 */
export interface Candle {
    ts: string; // K线开盘时间
    o: string;  // 开盘价
    h: string;  // 最高价
    l: string;  // 最低价
    c: string;  // 收盘价
    vol: string; // 成交量
}

/**
 * 原始交易对信息 (Binance API /fapi/v1/exchangeInfo 响应)
 */
export interface InstrumentDetail {
    instId: string; // 交易对ID
    ctVal: string; // 合约乘数 (合约面值)
    ctMult: string; // 合约乘数 (Binance API中通常与ctVal相同概念)
    ctType: string; // 合约类型，例如 PERPETUAL (永续)
    baseCcy: string; // 基础币种，例如 BTC
    quoteCcy: string; // 计价币种，例如 USDT
}


/**
 * 交易方向枚举
 */
export enum TradeDirection {
    LONG = 'long', // 多头
    SHORT = 'short', // 空头
}

/**
 * 仓位状态枚举
 */
export enum PositionStatus {
    OPEN = 'open', // 仓位已部分或全部开启
    CLOSED = 'closed', // 仓位已完全关闭
    LIQUIDATED = 'liquidated', // 仓位被强制平仓
}

/**
 * 时间线中的单个动作事件
 */
export interface TimelineEvent {
    timestamp: number;       // 动作发生时间
    action: 'OPEN' | 'ADD' | 'REDUCE' | 'CLOSE' | 'MARKET_ANALYSIS'; // 动作类型: 开仓, 加仓, 减仓, 平仓
    size: number;            // 本次动作的数量
    price: number;           // 本次动作的价格
    notes?: string;          // 对本次动作的单独反思
    // --- New fields for detailed log ---
    tradeId?: string;
    orderId?: string;
    fee?: number;
    feeCcy?: string;
}

/**
 * 标准化后的完整交易/仓位对象
 */
export interface StandardizedTrade {
    // === 核心标识 ===
    id: string; // 唯一ID，可以由多个 orderId 组合或使用第一个开仓的 orderId
    symbol: string; // 交易对，例如 'BTCUSDT'

    // === 仓位方向与状态 ===
    direction: TradeDirection; // 仓位方向 (多/空)
    status: PositionStatus; // 仓位当前状态 (已关闭/被强平)

    // === 时间与周期 ===
    entryTime: number; // 首次开仓时间 (时间戳)
    exitTime: number; // 最后平仓时间 (时间戳)
    durationMs: number; // 持仓时长 (毫秒)

    // === 数量与价格 ===
    totalSize: number; // 总开仓量 (例如，多少个BTC)，这是累计值
    totalValue: number; // 建立仓位的总成本（totalSize * averageEntryPrice），这是累计值
    averageEntryPrice: number; // 加权平均开仓价格
    averageExitPrice: number; // 加权平均平仓价格

    // === 盈亏分析 (所有都以 quoteAsset, 如 USDT 计价) ===
    realizedPnl: number; // 已实现盈亏 (来自交易本身)
    totalCommission: number; // 累计手续费
    totalFundingFee: number; // 累计资金费用
    netPnl: number; // 净盈亏 (realizedPnl - totalCommission + totalFundingFee)
    pnlPercentage: number; // 盈亏百分比 (netPnl / totalValue)

    // === 币种信息 (适配 Spot/Coin-M) ===
    pnlCurrency: string; // 盈亏结算币种 (e.g., 'USDT', 'BTC')
    feeCurrency: string; // 手续费币种 (e.g., 'USDT', 'BNB')
    valueCurrency: string; // 名义价值/成本币种 (e.g., 'USDT', 'USD')

    // === 时间线 ===
    timeline: TimelineEvent[]; // 记录仓位生命周期中的所有关键动作

    // === 关联数据 ===
    tradeIds: string[]; // 构成此仓位的所有原始成交记录ID (tradeId)
    orderIds: string[]; // 关联的订单ID列表 (orderId)

    // === 用户自定义 ===
    notes?: string; // 用户备注
    tags?: string[]; // 策略标签, e.g., ['趋势', '网格']

    // === 内部计算辅助属性 (Processor 内部使用) ===
    _currentPositionSize: number; // 用于处理过程中的当前仓位大小
    _closingSizeAccumulator: number; // 用于计算加权平均平仓价
    _closingValueAccumulator: number; // 用于计算加权平均平仓价
    _rawFills: RawFill[]; // 存储构成此交易的原始成交记录
    _rawBills: Bill[]; // 存储构成此交易的原始账单记录

    // === Binance API Notional Value ===
    currentNotionalValue?: number; // 当前仓位的名义价值 (从Binance API获取)
}
