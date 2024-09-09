import type { CacheEntry } from './cache-entry.interface';

export type ResourceUpdate = Pick<CacheEntry, 'status' | 'sync' | 'spec'>;
