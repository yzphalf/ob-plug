
import { App, TFile } from 'obsidian';
import { MyPluginSettings } from '../infrastructure/obsidian/settings';
import { TimelineEvent } from '../models/types';
import { t } from '../lang/translator';

export interface AnalysisRecord {
    id: string;
    timestamp: number;
    symbol: string;
    description: string;
    screenshotPath?: string;
    tags: string[];
}

/**
 * 盘面分析服务 (Analysis Service)
 * 
 * 职责：管理非交易的盘面分析记录。
 * 允许用户记录“不开仓的分析”并在K线上查看。
 */
export class AnalysisService {
    private app: App;
    private settings: MyPluginSettings;

    constructor(app: App, settings: MyPluginSettings) {
        this.app = app;
        this.settings = settings;
    }

    public async createAnalysisNote(record: AnalysisRecord): Promise<void> {
        // TODO: Implement the creation of analysis notes if needed centrally
        console.log('Analysis note creation delegated to main.ts for now.', record);
    }

    /**
     * Fetch analysis records for a specific symbol from the configured folder.
     */
    public async getAnalysisRecords(symbol: string): Promise<TimelineEvent[]> {
        const folderPath = this.settings.analysisFolder || '@Analysis';
        const files = this.app.vault.getMarkdownFiles();
        const events: TimelineEvent[] = [];

        for (const file of files) {
            // Check if file is in the analysis folder
            if (!file.path.startsWith(folderPath)) continue;

            const cache = this.app.metadataCache.getFileCache(file);
            if (!cache || !cache.frontmatter) continue;

            const fm = cache.frontmatter;

            // Check type. If type is missing, maybe rely on folder? 
            // But let's require type: analysis as per plan.
            if (fm.type !== 'analysis') continue;

            // Symbol check: exact match
            if (fm.symbol !== symbol) continue;

            // Extract data
            const timestamp = fm.date || file.stat.ctime;
            const price = parseFloat(fm.price);

            if (!price) continue;

            // Extract content snippet
            let noteSnippet = t('Market Analysis');
            try {
                const content = await this.app.vault.read(file);
                // Look for "Thoughts" header
                // Regex to capture content after "Thoughts" header until next header or end
                // We support localized headers: Thoughts, 思路与分析, Decision Notes
                const thoughtsRegex = /##\s+(?:Thoughts|思路与分析|Decision Notes|Market Analysis|市场观察)\s+([\s\S]*?)(?:$|^##\s)/m;
                const match = content.match(thoughtsRegex);

                if (match && match[1]) {
                    const rawSnippet = match[1].trim();
                    // Remove markdown bold/italic/links if needed? For now just truncate.
                    if (rawSnippet.length > 0) {
                        noteSnippet = rawSnippet.substring(0, 60).replace(/\n/g, ' ');
                        if (rawSnippet.length > 60) noteSnippet += '...';
                    }
                }
            } catch (e) {
                console.error('Failed to read analysis note:', file.path, e);
            }

            events.push({
                timestamp: timestamp,
                action: 'MARKET_ANALYSIS' as any, // Cast to avoid build issues if types aren't fully propagated yet
                size: 0,
                price: price,
                notes: noteSnippet,
                tradeId: `analysis-${timestamp}`,
                orderId: '',
                fee: 0,
                feeCcy: '',
            });
        }

        return events;
    }
}
