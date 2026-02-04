export interface IPersistenceAdapter {
    load(key: string): Promise<any>;
    save(key: string, data: any): Promise<void>;
}
