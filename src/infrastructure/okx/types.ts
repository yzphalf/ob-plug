
export * from '../../models/types';

export interface OkxFill {
    instId: string;
    tradeId: string;
    ordId: string;
    clOrdId: string;
    billId: string;
    tag: string;
    fillPx: string;
    fillSz: string;
    side: string; // buy, sell
    posSide: string; // long, short, net
    execType: string;
    feeCcy: string;
    fee: string;
    ts: string;
    instType: string;
}

export interface OkxBill {
    billId: string;
    ccy: string;
    bal: string;
    balChg: string;
    billId_before: string; // ?
    type: string; // 8 = funding fee in API V5? Need to check enum
    subType: string;
    ts: string;
    instId: string;
    ordId: string;
    from: string;
    to: string;
    notes: string;
}

export interface OkxInstrument {
    instId: string;
    instType: string; // SWAP
    ctVal: string;
    ctMult: string;
    ctValCcy: string;
    optType: string;
    stk: string;
    listTime: string;
    expTime: string;
    lever: string;
    tickSz: string;
    lotSz: string;
    minSz: string;
    ctType: string; // linear, inverse
    alias: string;
    state: string;
}

export interface OkxPosition {
    instId: string;
    posSide: string; // long, short, net
    pos: string; // size
    availPos: string;
    avgPx: string;
    upl: string; // unrealized pnl
    uplRatio: string;
    lever: string;
    liqPx: string;
    markPx: string;
    imr: string;
    mmr: string;
    margin: string;
    mgnMode: string; // cross, isolated
    ccy: string;
    notionalUsd: string; // notional in USD
}

export interface OkxTicker {
    instId: string;
    last: string;
    lastSz: string;
    askPx: string;
    askSz: string;
    bidPx: string;
    bidSz: string;
    open24h: string;
    high24h: string;
    low24h: string;
    volCcy24h: string;
    vol24h: string;
    ts: string;
    sodUtc0: string;
    sodUtc8: string;
}
