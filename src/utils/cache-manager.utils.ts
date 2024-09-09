import type { CacheEntry } from '@/interfaces/cache-entry.interface';
import type { ResourceUpdate } from '@/interfaces/resource-update.interface';
import { logger } from '@/utils/logger';

export class CacheManager {
  private readonly resourceCacheMap: Map<string, CacheEntry> = new Map();

  public has(name: string): boolean {
    return this.resourceCacheMap.has(name);
  }

  public get(name: string): CacheEntry | undefined {
    return this.resourceCacheMap.get(name);
  }

  public async initialize(name: string, update: ResourceUpdate): Promise<void> {
    logger.debug(`Initializing cache for resource '${name}'`);
    const lastMessageTs = 'mock-timestamp'; // Set the mock timestamp
    this.resourceCacheMap.set(name, {
      ...update,
      lastMessageTs,
      persistentChanges: '',
      deploymentInProgress: false,
    });
  }

  public update(
    name: string,
    update: ResourceUpdate,
    lastMessageTs: string | undefined,
    persistentChanges: string,
    deploymentInProgress: boolean,
  ): void {
    this.resourceCacheMap.set(name, {
      ...update,
      lastMessageTs,
      persistentChanges,
      deploymentInProgress,
    });
  }
}
