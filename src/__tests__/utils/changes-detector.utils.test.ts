import type { ArgoCdApplicationSpec } from '@/dtos/argocd-application.dto';
import { ArgoCdHealthStatus, ArgoCdSyncStatus } from '@/enums/argocd.enum';
import type { CacheEntry } from '@/interfaces/cache-entry.interface';
import type { ResourceUpdate } from '@/interfaces/resource-update.interface';
import { ChangeDetector } from '@/utils/changes-detector.utils';
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
vi.mock('@/utils/filter-changes.utils', () => ({
  filterChanges: vi.fn((updateObjectSpec, cacheObjectSpec) => {
    if (JSON.stringify(updateObjectSpec) === JSON.stringify(cacheObjectSpec)) {
      return {};
    }
    return { ...updateObjectSpec, ...cacheObjectSpec };
  }),
}));
vi.mock('@/utils/generate-readable-diff', () => ({
  generateReadableDiff: vi.fn((_cacheObjectSpec, updateObjectSpec) => `Diff: ${JSON.stringify(updateObjectSpec)}`),
}));

describe('ChangeDetector', () => {
  let changeDetector: ChangeDetector;

  beforeEach(() => {
    changeDetector = new ChangeDetector(3);
  });

  describe('hasStatusChanged', () => {
    it('should return true if the sync status has changed', () => {
      const cachedResource: CacheEntry = {
        status: ArgoCdHealthStatus.Healthy,
        sync: ArgoCdSyncStatus.Synced,
        spec: {} as CacheEntry['spec'],
        lastMessageTs: undefined,
        persistentChanges: '',
        deploymentInProgress: false,
      };
      const update: ResourceUpdate = {
        status: ArgoCdHealthStatus.Healthy,
        sync: ArgoCdSyncStatus.OutOfSync,
        spec: {} as CacheEntry['spec'],
      };

      expect(changeDetector.hasStatusChanged(cachedResource, update)).toBe(true);
    });

    it('should return true if the health status has changed', () => {
      const cachedResource: CacheEntry = {
        status: ArgoCdHealthStatus.Healthy,
        sync: ArgoCdSyncStatus.Synced,
        spec: {} as CacheEntry['spec'],
        lastMessageTs: undefined,
        persistentChanges: '',
        deploymentInProgress: false,
      };
      const update: ResourceUpdate = {
        status: ArgoCdHealthStatus.Progressing,
        sync: ArgoCdSyncStatus.Synced,
        spec: {} as CacheEntry['spec'],
      };

      expect(changeDetector.hasStatusChanged(cachedResource, update)).toBe(true);
    });

    it('should return false if both sync and health status have not changed', () => {
      const cachedResource: CacheEntry = {
        status: ArgoCdHealthStatus.Healthy,
        sync: ArgoCdSyncStatus.Synced,
        spec: {} as CacheEntry['spec'],
        lastMessageTs: undefined,
        persistentChanges: '',
        deploymentInProgress: false,
      };
      const update: ResourceUpdate = {
        status: ArgoCdHealthStatus.Healthy,
        sync: ArgoCdSyncStatus.Synced,
        spec: {} as CacheEntry['spec'],
      };

      expect(changeDetector.hasStatusChanged(cachedResource, update)).toBe(false);
    });
  });

  describe('isDeploymentInProgress', () => {
    it('should return true if the sync status is not Synced', () => {
      const update: ResourceUpdate = {
        status: ArgoCdHealthStatus.Healthy,
        sync: ArgoCdSyncStatus.OutOfSync,
        spec: {} as CacheEntry['spec'],
      };

      expect(changeDetector.isDeploymentInProgress(update)).toBe(true);
    });

    it('should return true if the health status is not Healthy', () => {
      const update: ResourceUpdate = {
        status: ArgoCdHealthStatus.Progressing,
        sync: ArgoCdSyncStatus.Synced,
        spec: {} as CacheEntry['spec'],
      };

      expect(changeDetector.isDeploymentInProgress(update)).toBe(true);
    });

    it('should return false if both sync and health status are in the desired state', () => {
      const update: ResourceUpdate = {
        status: ArgoCdHealthStatus.Healthy,
        sync: ArgoCdSyncStatus.Synced,
        spec: {} as CacheEntry['spec'],
      };

      expect(changeDetector.isDeploymentInProgress(update)).toBe(false);
    });
  });

  describe('mergeChanges', () => {
    it('should return the new changes if existing changes are empty', () => {
      const existingChanges = '';
      const newChanges = 'New changes';

      expect(changeDetector.mergeChanges(existingChanges, newChanges)).toBe('New changes');
    });

    it('should return the existing changes if new changes are empty', () => {
      const existingChanges = 'Existing changes';
      const newChanges = '';

      expect(changeDetector.mergeChanges(existingChanges, newChanges)).toBe('Existing changes');
    });

    it('should merge existing and new changes with a timestamp separator', () => {
      const existingChanges = 'Existing changes';
      const newChanges = 'New changes';

      const mergedChanges = changeDetector.mergeChanges(existingChanges, newChanges);

      expect(mergedChanges).toContain('Existing changes');
      expect(mergedChanges).toContain('New changes');
      expect(mergedChanges).toMatch(/--- New changes \(\d{2}:\d{2}\) ---/);
    });
  });

  describe('generateChangesString', () => {
    it('should generate a changes string based on the cache and update specs', () => {
      const cacheSpec: ArgoCdApplicationSpec = {
        source: {
          repoURL: 'https://example.com/repo.git',
          targetRevision: 'v1.0.0',
          chart: 'app',
          helm: {},
        },
        destination: {
          server: 'https://kubernetes.default.svc',
          namespace: 'default',
        },
      };
      const updateSpec = {
        source: {
          repoURL: 'https://example.com/repo.git',
          targetRevision: 'v1.1.0',
          chart: 'app',
          helm: {},
        },
        destination: {
          server: 'https://kubernetes.default.svc',
          namespace: 'default',
        },
      };

      const changesString = changeDetector.generateChangesString(cacheSpec, updateSpec);

      expect(changesString).toBe(`Diff: ${JSON.stringify(updateSpec)}`);
    });

    it('should return an empty string if there are no changes', () => {
      const cacheSpec: ArgoCdApplicationSpec = {
        source: {
          repoURL: 'https://example.com/repo.git',
          targetRevision: 'v1.0.0',
          chart: 'app',
          helm: {},
        },
        destination: {
          server: 'https://kubernetes.default.svc',
          namespace: 'default',
        },
        // Add other necessary fields
      };

      const updateSpec: ArgoCdApplicationSpec = {
        source: {
          repoURL: 'https://example.com/repo.git',
          targetRevision: 'v1.0.0',
          chart: 'app',
          helm: {},
        },
        destination: {
          server: 'https://kubernetes.default.svc',
          namespace: 'default',
        },
        // Add other necessary fields
      };

      const changesString = changeDetector.generateChangesString(cacheSpec, updateSpec);

      expect(changesString).toBe('');
    });

    it('should handle only image tag or target revision changes', () => {
      const cacheSpec: ArgoCdApplicationSpec = {
        source: {
          repoURL: 'https://example.com/repo.git',
          targetRevision: 'v1.0.0',
          chart: 'app',
          helm: {},
        },
        destination: {
          server: 'https://kubernetes.default.svc',
          namespace: 'default',
        },
      };
      const updateSpec = {
        source: {
          repoURL: 'https://example.com/repo.git',
          targetRevision: 'v1.1.0',
          chart: 'app',
          helm: {},
        },
        destination: {
          server: 'https://kubernetes.default.svc',
          namespace: 'default',
        },
      };

      const changesString = changeDetector.generateChangesString(cacheSpec, updateSpec);

      expect(changesString).toBe(`Diff: ${JSON.stringify(updateSpec)}`);
    });
  });

  describe('generateChangesObject', () => {
    it('should generate a changes object based on the cache and update specs', () => {
      const cacheSpec: ArgoCdApplicationSpec = {
        source: {
          repoURL: 'https://example.com/repo.git',
          targetRevision: 'v1.0.0',
          chart: 'app',
          helm: {},
        },
        destination: {
          server: 'https://kubernetes.default.svc',
          namespace: 'default',
        },
      };
      const updateSpec = {
        source: {
          repoURL: 'https://example.com/repo.git',
          targetRevision: 'v1.1.0',
          chart: 'app',
          helm: {},
        },
        destination: {
          server: 'https://kubernetes.default.svc',
          namespace: 'default',
        },
      };

      const changesObject = changeDetector.generateChangesObject(cacheSpec, updateSpec);

      expect(changesObject).toEqual({
        ...updateSpec,
        ...cacheSpec,
      });
    });
  });

  describe('isOnlyImageTagOrTagRevisionChange', () => {
    it('should return true if only the targetRevision has changed', () => {
      const changesObjectSpec = {
        source: {
          targetRevision: 'v1.1.0',
        },
      };

      expect(changeDetector.isOnlyImageTagOrTagRevisionChange(changesObjectSpec)).toBe(true);
    });

    it('should return true if only the image tag in helm values has changed', () => {
      const changesObjectSpec = {
        source: {
          helm: {
            valuesObject: {
              image: {
                tag: 'v1.1.0',
              },
            },
          },
        },
      };

      expect(changeDetector.isOnlyImageTagOrTagRevisionChange(changesObjectSpec)).toBe(true);
    });

    it('should return false if other properties have changed', () => {
      const changesObjectSpec = {
        source: {
          repoURL: 'https://example.com/repo.git',
          targetRevision: 'v1.1.0',
        },
      };

      expect(changeDetector.isOnlyImageTagOrTagRevisionChange(changesObjectSpec)).toBe(false);
    });

    it('should return false if multiple properties have changed', () => {
      const changesObjectSpec = {
        source: {
          targetRevision: 'v1.1.0',
          helm: {
            valuesObject: {
              image: {
                tag: 'v1.1.0',
              },
            },
          },
        },
      };

      expect(changeDetector.isOnlyImageTagOrTagRevisionChange(changesObjectSpec)).toBe(false);
    });
  });
});
