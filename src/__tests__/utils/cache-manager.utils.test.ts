import { ArgoCdHealthStatus, ArgoCdSyncStatus } from '@/enums/argocd.enum';
import type { CacheEntry } from '@/interfaces/cache-entry.interface';
import type { ResourceUpdate } from '@/interfaces/resource-update.interface';
import { CacheManager } from '@/utils/cache-manager.utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('@/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    verbose: vi.fn(),
  },
}));

describe('CacheManager', () => {
  let cacheManager: CacheManager;

  beforeEach(() => {
    cacheManager = new CacheManager();
  });

  describe('has', () => {
    it('should return true if the resource exists in the cache', () => {
      const cacheEntry: CacheEntry = {
        status: ArgoCdHealthStatus.Healthy,
        sync: ArgoCdSyncStatus.Synced,
        spec: {} as CacheEntry['spec'],
        lastMessageTs: 'mock-timestamp',
        persistentChanges: '',
        deploymentInProgress: false,
      };
      cacheManager['resourceCacheMap'].set('test-app', cacheEntry);

      expect(cacheManager.has('test-app')).toBe(true);
    });

    it('should return false if the resource does not exist in the cache', () => {
      expect(cacheManager.has('test-app')).toBe(false);
    });
  });

  describe('get', () => {
    it('should return the cached entry for the specified resource', () => {
      const cacheEntry: CacheEntry = {
        status: ArgoCdHealthStatus.Healthy,
        sync: ArgoCdSyncStatus.Synced,
        spec: {} as CacheEntry['spec'],
        lastMessageTs: 'mock-timestamp',
        persistentChanges: '',
        deploymentInProgress: false,
      };
      cacheManager['resourceCacheMap'].set('test-app', cacheEntry);

      expect(cacheManager.get('test-app')).toEqual(cacheEntry);
    });

    it('should return undefined if the resource does not exist in the cache', () => {
      expect(cacheManager.get('non-existent-app')).toBeUndefined();
    });
  });

  describe('initialize', () => {
    it('should initialize a new resource in the cache', async () => {
      const resourceUpdate: ResourceUpdate = {
        status: ArgoCdHealthStatus.Healthy,
        sync: ArgoCdSyncStatus.Synced,
        spec: {} as CacheEntry['spec'],
      };
      await cacheManager.initialize('new-app', resourceUpdate);

      const expectedCacheEntry: CacheEntry = {
        ...resourceUpdate,
        lastMessageTs: 'mock-timestamp',
        persistentChanges: '',
        deploymentInProgress: false,
      };

      expect(cacheManager.has('new-app')).toBe(true);
      expect(cacheManager.get('new-app')).toEqual(expectedCacheEntry);
    });
  });

  describe('update', () => {
    it('should update an existing resource in the cache', () => {
      const initialEntry: CacheEntry = {
        status: ArgoCdHealthStatus.Healthy,
        sync: ArgoCdSyncStatus.Synced,
        spec: {} as CacheEntry['spec'],
        lastMessageTs: 'initial-timestamp',
        persistentChanges: '',
        deploymentInProgress: false,
      };
      cacheManager['resourceCacheMap'].set('existing-app', initialEntry);

      const resourceUpdate: ResourceUpdate = {
        status: ArgoCdHealthStatus.Degraded,
        sync: ArgoCdSyncStatus.OutOfSync,
        spec: {} as CacheEntry['spec'],
      };
      cacheManager.update('existing-app', resourceUpdate, 'updated-timestamp', 'some-changes', true);

      const expectedCacheEntry: CacheEntry = {
        ...resourceUpdate,
        lastMessageTs: 'updated-timestamp',
        persistentChanges: 'some-changes',
        deploymentInProgress: true,
      };

      expect(cacheManager.get('existing-app')).toEqual(expectedCacheEntry);
    });
  });

  describe('delete', () => {
    it('should remove a resource from the cache', () => {
      const cacheEntry: CacheEntry = {
        status: ArgoCdHealthStatus.Healthy,
        sync: ArgoCdSyncStatus.Synced,
        spec: {} as CacheEntry['spec'],
        lastMessageTs: 'mock-timestamp',
        persistentChanges: '',
        deploymentInProgress: false,
      };
      cacheManager['resourceCacheMap'].set('app-to-delete', cacheEntry);

      cacheManager['resourceCacheMap'].delete('app-to-delete');

      expect(cacheManager.has('app-to-delete')).toBe(false);
      expect(cacheManager.get('app-to-delete')).toBeUndefined();
    });
  });
});
