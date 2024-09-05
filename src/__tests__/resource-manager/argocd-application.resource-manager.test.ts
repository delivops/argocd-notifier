/* eslint-disable @typescript-eslint/no-explicit-any */
/* allow console.log in tests */

import { filterChanges } from '@/utils/filter-changes.utils';
import { generateReadableDiff } from '@/utils/generate-readable-diff';
import { describe, expect, it, vi } from 'vitest';
import { ArgoCdHealthStatus, ArgoCdSyncStatus } from '../../enums/argocd.enum';
import { ArgoCdApplicationResourceManager } from '../../resource-manager/argocd-application.resource-manager';

// Mock dependencies
vi.mock('@/utils/generate-readable-diff');
vi.mock('@/utils/filter-changes.utils');
vi.mock('@/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    verbose: vi.fn(),
  },
}));

vi.mock('@/config/app.config', () => ({
  argo_config: {
    url: 'https://argocd.example.com',
    namespace: 'argocd',
  },
  slack_config: {
    TOKEN: 'mock-slack-token',
    CHANNEL_ID: 'mock-channel-id',
  },
  app_config: {
    contextDiffLinesCount: 3,
  },
}));

describe('ArgoCdApplicationResourceManager', () => {
  const mockCustomObjectsApi = {} as any;
  const mockK8sApi = {} as any;
  const resourceManager = new ArgoCdApplicationResourceManager(mockCustomObjectsApi, mockK8sApi);

  describe('isDirectorySource', () => {
    it('should return true if the resource spec has a directory source', () => {
      const resource = { spec: { source: { directory: 'path/to/directory' } } } as any;
      expect(resourceManager['isDirectorySource'](resource)).toBe(true);
    });

    it('should return false if the resource spec does not have a directory source', () => {
      const resource = { spec: { source: { repoURL: 'https://example.com/repo.git' } } } as any;
      expect(resourceManager['isDirectorySource'](resource)).toBe(false);
    });
  });

  describe('getStatusEmoji', () => {
    it('should return the correct emoji for a given health status', () => {
      expect(resourceManager['getStatusEmoji'](ArgoCdHealthStatus.Healthy)).toBe(':white_check_mark:');
      expect(resourceManager['getStatusEmoji'](ArgoCdHealthStatus.Degraded)).toBe(':x:');
      expect(resourceManager['getStatusEmoji'](ArgoCdHealthStatus.Progressing)).toBe(':hourglass_flowing_sand:');
    });

    it('should return the correct emoji for a given sync status', () => {
      expect(resourceManager['getStatusEmoji'](ArgoCdSyncStatus.Synced)).toBe(':white_check_mark:');
      expect(resourceManager['getStatusEmoji'](ArgoCdSyncStatus.OutOfSync)).toBe(':warning:');
    });

    it('should return emoji without colon when withSemicolon is false', () => {
      expect(resourceManager['getStatusEmoji'](ArgoCdHealthStatus.Healthy, false)).toBe('white_check_mark');
      expect(resourceManager['getStatusEmoji'](ArgoCdSyncStatus.OutOfSync, false)).toBe('warning');
    });
  });

  describe('generateChangesString', () => {
    it('should generate the correct changes string for non-version updates', () => {
      const mockGenerateReadableDiff = vi.mocked(generateReadableDiff);
      mockGenerateReadableDiff.mockReturnValue('Generated diff');

      const mockFilterChanges = vi.mocked(filterChanges);
      mockFilterChanges.mockReturnValue({ source: { repoURL: 'https://example.com/new-repo.git' } });

      const cache = { spec: { source: { repoURL: 'https://example.com/repo.git' } } } as any;
      const update = { spec: { source: { repoURL: 'https://example.com/new-repo.git' } } } as any;

      expect(resourceManager['generateChangesString'](cache, update)).toBe('Generated diff');
      expect(mockGenerateReadableDiff).toHaveBeenCalledWith(
        expect.objectContaining({ source: { repoURL: 'https://example.com/repo.git' } }),
        expect.objectContaining({ source: { repoURL: 'https://example.com/new-repo.git' } }),
        expect.objectContaining({ contextLines: 3, separator: '.........' }),
      );
    });

    it('should generate the correct changes string for version updates', () => {
      const mockGenerateReadableDiff = vi.mocked(generateReadableDiff);
      mockGenerateReadableDiff.mockReturnValue('Generated diff');

      const mockFilterChanges = vi.mocked(filterChanges);
      mockFilterChanges.mockReturnValue({ source: { targetRevision: 'v1.0.1' } });

      const cache = { spec: { source: { targetRevision: 'v1.0.0' } } } as any;
      const update = { spec: { source: { targetRevision: 'v1.0.1' } } } as any;

      expect(resourceManager['generateChangesString'](cache, update)).toBe('Generated diff');
      expect(mockGenerateReadableDiff).toHaveBeenCalledWith(
        expect.objectContaining({ source: { targetRevision: 'v1.0.0' } }),
        expect.objectContaining({ source: { targetRevision: 'v1.0.1' } }),
        expect.objectContaining({ contextLines: 0, separator: '' }),
      );
    });
  });

  describe('isOnlyImageTagOrTagRevisionChange', () => {
    it('should return true if the change is only in the image tag', () => {
      const changes = { source: { helm: { valuesObject: { image: { tag: 'v1.0.1' } } } } };
      expect(resourceManager['isOnlyImageTagOrTagRevisionChange'](changes)).toBe(true);
    });

    it('should return true if the change is only in the target revision', () => {
      const changes = { source: { targetRevision: 'v1.0.1' } };
      expect(resourceManager['isOnlyImageTagOrTagRevisionChange'](changes)).toBe(true);
    });

    it('should return false if there are other changes in the source', () => {
      const changes = { source: { repoURL: 'https://example.com/new-repo.git' } };
      expect(resourceManager['isOnlyImageTagOrTagRevisionChange'](changes)).toBe(false);
    });

    it('should return false if there are multiple changes in the source', () => {
      const changes = { source: { targetRevision: 'v1.0.1', repoURL: 'https://example.com/new-repo.git' } };
      expect(resourceManager['isOnlyImageTagOrTagRevisionChange'](changes)).toBe(false);
    });

    it('should return false if there are changes outside the source', () => {
      const changes = { destination: { namespace: 'new-namespace' } };
      expect(resourceManager['isOnlyImageTagOrTagRevisionChange'](changes)).toBe(false);
    });

    it('should return false if there are multiple changes including the source', () => {
      const changes = { source: { targetRevision: 'v1.0.1' }, destination: { namespace: 'new-namespace' } };
      expect(resourceManager['isOnlyImageTagOrTagRevisionChange'](changes)).toBe(false);
    });
  });
});
