import type { ArgoCdApplicationSpec } from '@/dtos/argocd-application.dto';
import type { ArgoCdHealthStatus, ArgoCdSyncStatus } from '@/enums/argocd.enum';

export interface CacheEntry {
  status: ArgoCdHealthStatus;
  sync: ArgoCdSyncStatus;
  spec: ArgoCdApplicationSpec;
  lastMessageTs: string | undefined;
  persistentChanges: string;
  deploymentInProgress: boolean;
}
