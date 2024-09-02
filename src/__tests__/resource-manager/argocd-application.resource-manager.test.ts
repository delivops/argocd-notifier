/* eslint-disable @typescript-eslint/no-explicit-any */
// allow console.log in tests
/* eslint-disable no-console */

import { CoreV1Api, CustomObjectsApi } from '@kubernetes/client-node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgoCdHealthStatus, ArgoCdSyncStatus } from '../../enums/argocd.enum';
import { ArgoCdApplicationResourceManager } from '../../resource-manager/argocd-application.resource-manager';

// Mock dependencies
vi.mock('../../logger', () => ({
  logger: {
    debug: vi.fn(),
    info: console.log,
    error: console.log,
    verbose: console.log,
  },
}));

vi.mock('../../config/app.config', () => ({
  argo_config: {
    url: 'https://argocd.example.com',
    namespace: 'argocd',
  },
  slack_config: {
    TOKEN: 'mock-slack-token',
    CHANNEL_ID: 'mock-channel-id',
  },
}));

vi.mock('@slack/web-api', () => ({
  WebClient: vi.fn(() => ({
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ts: 'mock-timestamp' }),
      update: vi.fn().mockResolvedValue({ ts: 'mock-timestamp-updated' }),
    },
  })),
}));

// Create a test double that exposes the protected methods
class TestableArgoCdApplicationResourceManager extends ArgoCdApplicationResourceManager {
  public async testSyncResource(resource: any): Promise<void> {
    return this.syncResource(resource);
  }

  public getResourceCacheMap(): Map<string, any> {
    return this.resourceCacheMap;
  }
}

describe('ArgoCdApplicationResourceManager', () => {
  let manager: TestableArgoCdApplicationResourceManager;
  let mockCustomObjectsApi: CustomObjectsApi;
  let mockCoreV1Api: CoreV1Api;

  beforeEach(() => {
    mockCustomObjectsApi = {} as CustomObjectsApi;
    mockCoreV1Api = {} as CoreV1Api;
    manager = new TestableArgoCdApplicationResourceManager(mockCustomObjectsApi, mockCoreV1Api);

    // Reset the cache before each test
    manager.getResourceCacheMap().clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should add an app to cache when syncResource is called for the first time', async () => {
    const resource = createMockResource('app1', 'v1.0.0', ArgoCdHealthStatus.Healthy, ArgoCdSyncStatus.Synced);

    await manager.testSyncResource(resource);

    const cache = manager.getResourceCacheMap();
    expect(cache.has('app1')).toBe(true);
    expect(cache.get('app1')).toMatchObject({
      status: ArgoCdHealthStatus.Healthy,
      sync: ArgoCdSyncStatus.Synced,
      spec: resource.spec,
      lastMessageTs: 'mock-timestamp',
      persistentChanges: expect.any(String),
      deploymentInProgress: false,
    });
  });

  it('should send a new notification when an update comes with a new image tag', async () => {
    const initialResource = createMockResource('app1', 'v1.0.0', ArgoCdHealthStatus.Healthy, ArgoCdSyncStatus.Synced);
    await manager.testSyncResource(initialResource);

    const updatedResource = createMockResource(
      'app1',
      'v1.1.0',
      ArgoCdHealthStatus.Progressing,
      ArgoCdSyncStatus.OutOfSync,
    );
    await manager.testSyncResource(updatedResource);

    const cache = manager.getResourceCacheMap();
    expect(cache.get('app1')).toMatchObject({
      status: ArgoCdHealthStatus.Progressing,
      sync: ArgoCdSyncStatus.OutOfSync,
      spec: updatedResource.spec,
      lastMessageTs: 'mock-timestamp',
      persistentChanges: expect.stringContaining('v1.1.0'),
      deploymentInProgress: true,
    });
  });

  // TODO: fix this test
  //   it('should update existing notification when a new update comes before deployment is finished', async () => {
  //     const initialResource = createMockResource('app1', 'v1.0.0', ArgoCdHealthStatus.Healthy, ArgoCdSyncStatus.Synced);
  //     await manager.testSyncResource(initialResource);

  //     const firstUpdate = createMockResource(
  //       'app1',
  //       'v1.1.0',
  //       ArgoCdHealthStatus.Progressing,
  //       ArgoCdSyncStatus.OutOfSync,
  //     );
  //     await manager.testSyncResource(firstUpdate);

  //     const secondUpdate = createMockResource(
  //       'app1',
  //       'v1.1.1',
  //       ArgoCdHealthStatus.Progressing,
  //       ArgoCdSyncStatus.OutOfSync,
  //     );
  //     await manager.testSyncResource(secondUpdate);

  //     const cache = manager.getResourceCacheMap();
  //     expect(cache.get('app1')).toMatchObject({
  //       status: ArgoCdHealthStatus.Progressing,
  //       sync: ArgoCdSyncStatus.OutOfSync,
  //       spec: secondUpdate.spec,
  //       lastMessageTs: 'mock-timestamp-updated',
  //       persistentChanges: expect.stringContaining('v1.1.1'),
  //       deploymentInProgress: true,
  //     });
  //   });

  it('should not trigger update or new deployment when an update comes without changes', async () => {
    const initialResource = createMockResource('app1', 'v1.0.0', ArgoCdHealthStatus.Healthy, ArgoCdSyncStatus.Synced);
    await manager.testSyncResource(initialResource);

    const unchangedResource = createMockResource('app1', 'v1.0.0', ArgoCdHealthStatus.Healthy, ArgoCdSyncStatus.Synced);
    await manager.testSyncResource(unchangedResource);

    const cache = manager.getResourceCacheMap();
    expect(cache.get('app1')).toMatchObject({
      status: ArgoCdHealthStatus.Healthy,
      sync: ArgoCdSyncStatus.Synced,
      spec: initialResource.spec,
      lastMessageTs: 'mock-timestamp',
      persistentChanges: expect.any(String),
      deploymentInProgress: false,
    });
  });

  it('should handle status changes during deployment', async () => {
    const initialResource = createMockResource('app1', 'v1.0.0', ArgoCdHealthStatus.Healthy, ArgoCdSyncStatus.Synced);
    await manager.testSyncResource(initialResource);

    const updatedResource = createMockResource(
      'app1',
      'v1.1.0',
      ArgoCdHealthStatus.Progressing,
      ArgoCdSyncStatus.OutOfSync,
    );
    await manager.testSyncResource(updatedResource);

    const syncedResource = createMockResource('app1', 'v1.1.0', ArgoCdHealthStatus.Healthy, ArgoCdSyncStatus.Synced);
    await manager.testSyncResource(syncedResource);

    const cache = manager.getResourceCacheMap();
    expect(cache.get('app1')).toMatchObject({
      status: ArgoCdHealthStatus.Healthy,
      sync: ArgoCdSyncStatus.Synced,
      spec: syncedResource.spec,
      lastMessageTs: 'mock-timestamp-updated',
      persistentChanges: expect.stringContaining('v1.1.0'),
      deploymentInProgress: false,
    });
  });

  it('should handle multiple applications independently', async () => {
    const app1Resource = createMockResource('app1', 'v1.0.0', ArgoCdHealthStatus.Healthy, ArgoCdSyncStatus.Synced);
    const app2Resource = createMockResource('app2', 'v2.0.0', ArgoCdHealthStatus.Healthy, ArgoCdSyncStatus.Synced);

    await manager.testSyncResource(app1Resource);
    await manager.testSyncResource(app2Resource);

    const cache = manager.getResourceCacheMap();
    expect(cache.has('app1')).toBe(true);
    expect(cache.has('app2')).toBe(true);
    expect(cache.get('app1').spec.source.targetRevision).toBe('v1.0.0');
    expect(cache.get('app2').spec.source.targetRevision).toBe('v2.0.0');
  });
});

function createMockResource(name: string, version: string, health: ArgoCdHealthStatus, sync: ArgoCdSyncStatus) {
  return {
    kind: 'Application',
    metadata: { name },
    spec: {
      source: {
        repoURL: 'https://github.com/example/repo',
        targetRevision: version,
        chart: 'my-chart',
      },
      destination: {
        server: 'https://kubernetes.default.svc',
        namespace: 'default',
      },
    },
    status: {
      health: { status: health },
      sync: { status: sync },
    },
  };
}
