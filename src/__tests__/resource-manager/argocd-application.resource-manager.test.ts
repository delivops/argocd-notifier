import type { ArgoCdResource } from '@/interfaces/argcd-resource.interface';
import type { CacheEntry } from '@/interfaces/cache-entry.interface';
import type { ResourceUpdate } from '@/interfaces/resource-update.interface';
import type { CoreV1Api, CustomObjectsApi } from '@kubernetes/client-node';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgoCdHealthStatus, ArgoCdSyncStatus } from '../../enums/argocd.enum';
import { ArgoCdApplicationResourceManager } from '../../resource-manager/argocd-application.resource-manager';

// Create a subclass of ArgoCdApplicationResourceManager that exposes protected methods for testing
class TestArgoCdApplicationResourceManager extends ArgoCdApplicationResourceManager {
  public async testSyncResource(resource: ArgoCdResource): Promise<void> {
    await this.syncResource(resource);
  }

  public async testStartNewDeployment(
    name: string,
    targetNamespace: string,
    update: ResourceUpdate,
    changesString: string,
  ): Promise<void> {
    await this.startNewDeployment(name, targetNamespace, update, changesString);
  }

  public async testUpdateExistingDeployment(
    name: string,
    targetNamespace: string,
    update: ResourceUpdate,
    changesString: string,
  ): Promise<void> {
    await this.updateExistingDeployment(name, targetNamespace, update, changesString);
  }
}

// Mock dependencies
vi.mock('@/utils/slack-notifier.utils');
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
  const mockCustomObjectsApi = {} as CustomObjectsApi;
  const mockK8sApi = {} as CoreV1Api;
  const resourceManager = new TestArgoCdApplicationResourceManager(mockCustomObjectsApi, mockK8sApi);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(resourceManager['cacheManager'], 'has').mockReturnValue(false);
    vi.spyOn(resourceManager['cacheManager'], 'initialize').mockResolvedValue(undefined);
  });

  describe('syncResource', () => {
    it('should ignore directory sources', async () => {
      const mockResource = {
        kind: 'Application',
        metadata: { name: 'test-app' },
        spec: { source: { directory: 'path/to/directory' } },
      } as unknown as ArgoCdResource;

      await resourceManager.testSyncResource(mockResource);

      expect(resourceManager['cacheManager'].has).not.toHaveBeenCalled();
      expect(resourceManager['cacheManager'].initialize).not.toHaveBeenCalled();
    });

    it('should initialize cache for new resources', async () => {
      const mockResource = {
        kind: 'Application',
        metadata: { name: 'test-app' },
        status: {
          health: { status: ArgoCdHealthStatus.Healthy },
          sync: { status: ArgoCdSyncStatus.Synced },
        },
        spec: { source: { repoURL: 'https://example.com/repo.git' } },
      } as ArgoCdResource;

      await resourceManager.testSyncResource(mockResource);

      expect(resourceManager['cacheManager'].initialize).toHaveBeenCalledWith('test-app', {
        status: ArgoCdHealthStatus.Healthy,
        sync: ArgoCdSyncStatus.Synced,
        spec: mockResource.spec,
      });
    });

    it('should handle resource updates for existing resources', async () => {
      const mockResource = {
        kind: 'Application',
        metadata: { name: 'test-app' },
        status: {
          health: { status: ArgoCdHealthStatus.Progressing },
          sync: { status: ArgoCdSyncStatus.OutOfSync },
        },
        spec: {
          source: { repoURL: 'https://example.com/repo.git' },
          destination: { namespace: 'test-namespace' },
        },
      } as ArgoCdResource;

      vi.spyOn(resourceManager['cacheManager'], 'has').mockReturnValueOnce(true);
      const handleResourceUpdateSpy = vi
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .spyOn<any, any>(resourceManager, 'handleResourceUpdate')
        .mockResolvedValue(undefined);

      await resourceManager.testSyncResource(mockResource);

      expect(handleResourceUpdateSpy).toHaveBeenCalledWith(
        'test-app',
        {
          status: ArgoCdHealthStatus.Progressing,
          sync: ArgoCdSyncStatus.OutOfSync,
          spec: mockResource.spec,
        },
        'test-namespace',
      );
    });
  });

  describe('startNewDeployment', () => {
    it('should create a new Slack message and update the cache', async () => {
      const mockName = 'test-app';
      const mockNamespace = 'test-namespace';
      const mockUpdate = {
        status: ArgoCdHealthStatus.Progressing,
        sync: ArgoCdSyncStatus.OutOfSync,
        spec: { source: { repoURL: 'https://example.com/repo.git' } },
      };
      const mockChangesString = 'Generated changes';
      const mockSlackResponse = { ts: 'mock-timestamp' };

      vi.spyOn(resourceManager['slackNotifier'], 'createMessage').mockResolvedValueOnce(mockSlackResponse);
      vi.spyOn(resourceManager['cacheManager'], 'update').mockReturnValue();

      await resourceManager.testStartNewDeployment(
        mockName,
        mockNamespace,
        mockUpdate as ResourceUpdate,
        mockChangesString,
      );

      expect(resourceManager['slackNotifier'].createMessage).toHaveBeenCalledWith(
        mockName,
        mockNamespace,
        mockUpdate,
        mockChangesString,
      );
      expect(resourceManager['cacheManager'].update).toHaveBeenCalledWith(
        mockName,
        mockUpdate,
        'mock-timestamp',
        mockChangesString,
        true,
      );
    });
  });

  describe('updateExistingDeployment', () => {
    it('should update the existing Slack message and update the cache', async () => {
      const mockName = 'test-app';
      const mockNamespace = 'test-namespace';
      const mockUpdate = {
        status: ArgoCdHealthStatus.Healthy,
        sync: ArgoCdSyncStatus.Synced,
        spec: { source: { repoURL: 'https://example.com/repo.git' } },
      };
      const mockChangesString = 'Generated changes';
      const mockCachedResource = {
        status: ArgoCdHealthStatus.Progressing,
        sync: ArgoCdSyncStatus.OutOfSync,
        spec: { source: { repoURL: 'https://example.com/repo.git' } },
        deploymentInProgress: true,
        persistentChanges: 'Existing changes',
        lastMessageTs: 'mock-timestamp',
      };
      const mockSlackResponse = { ts: 'mock-timestamp-updated' };
      const mockUpdatedChanges = 'Merged changes';
      const mockDeploymentInProgress = false;

      vi.spyOn(resourceManager['cacheManager'], 'get').mockReturnValueOnce(
        mockCachedResource as CacheEntry | undefined,
      );
      vi.spyOn(resourceManager['changeDetector'], 'mergeChanges').mockReturnValueOnce(mockUpdatedChanges);
      vi.spyOn(resourceManager['slackNotifier'], 'updateMessage').mockResolvedValueOnce(
        mockSlackResponse as Awaited<ReturnType<(typeof resourceManager)['slackNotifier']['updateMessage']>>,
      );
      vi.spyOn(resourceManager['changeDetector'], 'isDeploymentInProgress').mockReturnValueOnce(
        mockDeploymentInProgress,
      );
      vi.spyOn(resourceManager['cacheManager'], 'update').mockReturnValue();

      await resourceManager.testUpdateExistingDeployment(
        mockName,
        mockNamespace,
        mockUpdate as ResourceUpdate,
        mockChangesString,
      );

      expect(resourceManager['changeDetector'].mergeChanges).toHaveBeenCalledWith(
        mockCachedResource.persistentChanges,
        mockChangesString,
      );
      expect(resourceManager['slackNotifier'].updateMessage).toHaveBeenCalledWith(
        mockName,
        mockNamespace,
        mockUpdate,
        mockUpdatedChanges,
        mockCachedResource.lastMessageTs,
      );
      expect(resourceManager['cacheManager'].update).toHaveBeenCalledWith(
        mockName,
        mockUpdate,
        'mock-timestamp-updated',
        mockUpdatedChanges,
        mockDeploymentInProgress,
      );
    });
  });
});
