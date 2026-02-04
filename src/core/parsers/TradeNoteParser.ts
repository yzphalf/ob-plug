import { TFile, App } from 'obsidian';
import { TimelineEvent, RawFill } from '../../models/types';
import { SymbolService } from '../../services/SymbolService';

export interface TradeNoteData {
    symbol?: string;
    tradeEvents: Partial<TimelineEvent>[];
    interval?: string;
}

export interface ITradeNoteParser {
    parse(file: TFile): Promise<TradeNoteData>;
}

export class ObsidianTradeNoteParser implements ITradeNoteParser {
    private app: App;
    private symbolService: SymbolService;

    constructor(app: App, symbolService: SymbolService) {
        this.app = app;
        this.symbolService = symbolService;
    }

    public async parse(file: TFile): Promise<TradeNoteData> {
        if (!file) return { symbol: undefined, tradeEvents: [], interval: undefined };

        // 1. Extract Symbol using SymbolService (which handles metadata/filename cache)
        const symbol = this.symbolService.extractSymbolFromFile(file);

        // 2. Extract Interval
        let interval: string | undefined;
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache?.frontmatter) {
            interval = cache.frontmatter?.interval;
        }

        // 3. Parse Trade Events (Raw Fills)
        let tradeEvents: Partial<TimelineEvent>[] = [];
        if (symbol) {
            const content = await this.app.vault.cachedRead(file);
            // Regex to find "Raw Fills" or "原始成交记录" code block
            const jsonRegex = /### (?:原始成交记录 \(Fills\)|Raw Fills)\s*```json\n([\s\S]*?)\n```/;
            const jsonMatch = content.match(jsonRegex);

            if (jsonMatch?.[1]) {
                try {
                    const rawFills: RawFill[] = JSON.parse(jsonMatch[1]);
                    tradeEvents = this.mapFillsToEvents(rawFills);
                } catch (e) {
                    console.error("Error parsing fills JSON from note:", e);
                }
            }
        }

        return { symbol: symbol || undefined, tradeEvents, interval };
    }

    private mapFillsToEvents(rawFills: RawFill[]): Partial<TimelineEvent>[] {
        return rawFills.map(fill => {
            let action: TimelineEvent['action'] = 'ADD'; // Default
            const posSide = fill.posSide ? fill.posSide.toLowerCase() : '';
            const side = fill.side ? fill.side.toLowerCase() : '';

            if (posSide === 'short') {
                action = side === 'sell' ? 'OPEN' : 'CLOSE';
            } else if (posSide === 'long') {
                action = side === 'buy' ? 'OPEN' : 'CLOSE';
            } else {
                // Net mode or unknown, fallback
                action = side === 'buy' ? 'OPEN' : 'CLOSE';
            }

            return {
                timestamp: parseInt(fill.ts, 10),
                price: parseFloat(fill.fillPx),
                size: parseFloat(fill.fillSz),
                action: action,
                tradeId: fill.tradeId,
                fee: parseFloat(fill.fee) || 0,
                feeCcy: fill.feeCcy
            };
        });
    }
}
