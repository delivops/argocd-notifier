import { ArgoCdApplicationSpec } from '@/dtos/argocd-application.dto';
import { ArgoCdHealthStatus, ArgoCdSyncStatus } from '@/enums/argocd.enum';
import { filterChanges } from '@/utils/filter-changes.utils';
import { generateReadableDiff } from '@/utils/generate-readable-diff';

interface CacheEntry {
  status: ArgoCdHealthStatus;
  sync: ArgoCdSyncStatus;
  spec: ArgoCdApplicationSpec;
}

type ResourceUpdate = Pick<CacheEntry, 'status' | 'sync' | 'spec'>;

export class ChangeDetector {
  constructor(private readonly contextDiffLinesCount: number) {}

  public hasStatusChanged(cachedResource: CacheEntry, update: ResourceUpdate): boolean {
    return cachedResource.sync !== update.sync || cachedResource.status !== update.status;
  }

  public isDeploymentInProgress(update: ResourceUpdate): boolean {
    return update.sync !== ArgoCdSyncStatus.Synced || update.status !== ArgoCdHealthStatus.Healthy;
  }

  public mergeChanges(existingChanges: string, newChanges: string): string {
    if (!existingChanges || !newChanges) {
      return existingChanges || newChanges;
    }

    const timeStamp = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    return `${existingChanges}\n\n--- New changes (${timeStamp}) ---\n${newChanges}`;
  }

  public generateChangesString(cacheSpec: ArgoCdApplicationSpec, updateSpec: ArgoCdApplicationSpec): string {
    const reorganizeSpec = (spec: ArgoCdApplicationSpec) => {
      const { syncPolicy: _, source, ...restSpec } = spec;
      const { repoURL, targetRevision, chart, helm, ...restSource } = source;

      return {
        source: {
          repoURL,
          targetRevision,
          chart,
          helm,
          ...restSource,
        },
        ...restSpec,
      };
    };

    const cacheObjectSpec = reorganizeSpec(cacheSpec);
    const updateObjectSpec = reorganizeSpec(updateSpec);

    const changesObjectSpec = filterChanges(updateObjectSpec, cacheObjectSpec);

    if (Object.keys(changesObjectSpec).length === 0) {
      return '';
    }

    const isOnlyVersionUpdate = this.isOnlyImageTagOrTagRevisionChange(changesObjectSpec);

    const diffString = generateReadableDiff(cacheObjectSpec, updateObjectSpec, {
      contextLines: isOnlyVersionUpdate ? 0 : this.contextDiffLinesCount,
      separator: isOnlyVersionUpdate ? '' : '...'.repeat(3),
    });

    return diffString.trim();
  }

  private isOnlyImageTagOrTagRevisionChange(changesObjectSpec: Record<string, unknown>): boolean {
    const changedPaths = Object.keys(changesObjectSpec);

    if (changedPaths.length !== 1 || changedPaths[0] !== 'source') return false;

    const sourceChanges = changesObjectSpec.source as Record<string, unknown>;
    const sourceChangedKeys = Object.keys(sourceChanges);

    if (sourceChangedKeys.length !== 1) return false;

    if (sourceChangedKeys[0] === 'targetRevision') return true;

    if (sourceChangedKeys[0] === 'helm') {
      const helm = sourceChanges.helm as Record<string, unknown>;
      if (!helm.valuesObject) return false;

      const valuesObject = helm.valuesObject as Record<string, unknown>;
      if (!valuesObject.image) return false;

      const imageObject = valuesObject.image as Record<string, unknown>;
      return Object.keys(imageObject).length === 1 && 'tag' in imageObject;
    }

    return false;
  }
}
