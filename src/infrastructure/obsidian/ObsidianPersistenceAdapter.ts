import { App } from 'obsidian';
import { IPersistenceAdapter } from '../../models/IPersistenceAdapter';

export class ObsidianPersistenceAdapter implements IPersistenceAdapter {
    private app: App;
    private basePath: string;

    constructor(app: App, basePath: string) {
        this.app = app;
        this.basePath = basePath;
    }

    private getPath(key: string): string {
        // Ensure the path ends with .json and sits in the basePath
        // basePath should be like ".obsidian/plugins/my-plugin/data" or similar, 
        // but typically plugins write to their own data.json via saveDate.
        // However, we want a separate file.
        // Let's assume basePath is a directory.
        return `${this.basePath}/${key}.json`;
    }

    async load(key: string): Promise<any> {
        const path = this.getPath(key);
        if (await this.app.vault.adapter.exists(path)) {
            const content = await this.app.vault.adapter.read(path);
            try {
                return JSON.parse(content);
            } catch (e) {
                console.error(`Failed to parse cache file ${path}`, e);
                return null;
            }
        }
        return null;
    }

    async save(key: string, data: any): Promise<void> {
        const path = this.getPath(key);

        // Ensure directory exists
        const folder = path.substring(0, path.lastIndexOf('/'));
        if (!(await this.app.vault.adapter.exists(folder))) {
            await this.app.vault.adapter.mkdir(folder);
        }

        await this.app.vault.adapter.write(path, JSON.stringify(data, null, 2));
    }
}
