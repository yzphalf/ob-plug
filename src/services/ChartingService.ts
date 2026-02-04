/**
 * 图表服务 (Charting Service)
 *
 * 这个服务负责管理 K 线图表（TradingView Lightweight Charts）的生命周期。
 */
import { App, Notice, TFile } from 'obsidian';
import { KLineView, K_LINE_VIEW_TYPE } from '../views/KLineView';
import { TimelineEvent } from '../models/types';
import { SymbolService } from './SymbolService';
import { ObsidianTradeNoteParser } from '../core/parsers/TradeNoteParser';
import { t } from '../lang/translator';
import { TimelineUtils } from '../utils/TimelineUtils';

export class ChartingService {
    private app: App;
    private symbolService: SymbolService;
    private parser: ObsidianTradeNoteParser;

    constructor(app: App, symbolService: SymbolService) {
        this.app = app;
        this.symbolService = symbolService;
        this.parser = new ObsidianTradeNoteParser(app, symbolService);
    }

    public async handleActiveLeafChange(): Promise<void> {
        const klineView = this.app.workspace.getLeavesOfType(K_LINE_VIEW_TYPE)[0]?.view as KLineView;
        if (!klineView) return;

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;

        // Use the dedicated parser
        const { symbol, tradeEvents, interval } = await this.parser.parse(activeFile);

        // Utilize the shared TimelineUtils for aggregation
        const aggregatedEvents = TimelineUtils.aggregateEvents(tradeEvents as TimelineEvent[]);

        if (symbol) {
            // Safety check: ensure setContext exists (it might be a different view type if getLeavesOfType returned something unexpected, though unlikely with type guard)
            // Or if the view hasn't fully initialized its prototype methods for some reason.
            if (typeof klineView.setContext === 'function') {
                klineView.setContext(symbol, aggregatedEvents, interval);
            } else {
                console.warn('[ChartingService] klineView found but setContext is not a function:', klineView);
            }
        }
    }

    // aggregateTimelineEvents and mergeEvents methods removed


    public async ensureKlineView(): Promise<void> {
        let leaf = this.app.workspace.getLeavesOfType(K_LINE_VIEW_TYPE)[0];
        if (!leaf) {
            const rightLeaf = this.app.workspace.getRightLeaf(false);
            if (rightLeaf) {
                leaf = rightLeaf;
                await leaf.setViewState({
                    type: K_LINE_VIEW_TYPE,
                    active: true,
                });
            }
        }
        if (leaf) {
            this.app.workspace.revealLeaf(leaf);
        }
    }
}
