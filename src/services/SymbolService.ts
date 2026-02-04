/**
 * 交易对符号服务 (Symbol Service)
 *
 * 这个服务充当了“缓存管理器”的角色，专门负责管理用户的 Vault（仓库）中有哪些交易笔记。
 */
import { App, TFile } from 'obsidian';

export class SymbolService {
    private app: App;
    private cachedSymbols: Set<string> = new Set(); // Internal cache

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Rebuilds the internal symbol cache by scanning all markdown files in the vault.
     */
    public buildSymbolCache(): void {
        this.cachedSymbols.clear();
        const files = this.app.vault.getMarkdownFiles();
        for (const file of files) {
            this.addSymbolToCache(file);
        }
    }

    /**
     * Extracts a symbol from a TFile's frontmatter or filename.
     * @param file The TFile to extract the symbol from.
     * @returns The extracted symbol as a string, or null if not found.
     */
    public extractSymbolFromFile(file: TFile): string | null {
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache?.frontmatter?.symbol) {
            return cache.frontmatter.symbol.toUpperCase();
        }

        const filenameRegex = /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2} - ([A-Z0-9]+)-/;
        const filenameMatch = file.basename.match(filenameRegex);
        if (filenameMatch?.[1]) {
            return filenameMatch[1];
        }
        return null;
    }

    /**
     * Adds a symbol extracted from a TFile to the cache.
     * @param file The TFile from which to extract and cache the symbol.
     */
    public addSymbolToCache(file: TFile): void {
        if (!(file instanceof TFile)) return;
        const symbol = this.extractSymbolFromFile(file);
        if (symbol) {
            this.cachedSymbols.add(symbol);
        }
    }

    /**
     * Directly adds a symbol string to the cache.
     * @param symbol The symbol string to add.
     */
    public addSymbol(symbol: string): void {
        if (symbol) {
            this.cachedSymbols.add(symbol);
        }
    }

    /**
     * Removes a symbol from the cache.
     */
    public removeSymbolFromCache(file: TFile): void {
        if (!(file instanceof TFile)) return;
        this.buildSymbolCache();
    }

    /**
     * Retrieves all unique symbols currently in the vault cache, sorted alphabetically.
     * @returns An array of unique symbols.
     */
    public getSymbolsFromVault(): string[] {
        return Array.from(this.cachedSymbols).sort();
    }
}
