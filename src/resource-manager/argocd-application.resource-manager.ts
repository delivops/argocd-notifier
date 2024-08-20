import { ArgoCdKind, type ArgoCdApplicationDto } from '@/dtos/argocd-application.dto';
import type { CustomResource } from '@/interfaces/custom-resource.interface';
import { logger } from '@/logger';
import { findCrdConfigByKind } from '@/operator-resources';
import { BaseResourceManager } from './base.resource-manager';

type ArgoCdResource = CustomResource<ArgoCdApplicationDto>;

export class ArgoCdApplicationResourceManager extends BaseResourceManager {
  definition = findCrdConfigByKind(ArgoCdKind);

  protected resourceCacheMap: Map<
    ArgoCdResource['metadata']['name'],
    {
      status?: Exclude<ArgoCdResource['status'], undefined>['health']['status'];
      sync?: Exclude<ArgoCdResource['status'], undefined>['sync']['status'];
    }
  > = new Map();

  protected async syncResource(object: ArgoCdResource): Promise<void> {
    const { kind, status, metadata } = object;
    const { name } = metadata;

    let hasBeenUpdated = false;

    if (!this.resourceCacheMap.has(name)) {
      logger.debug(`Initializing cache for ${kind} '${name}'`);

      this.resourceCacheMap.set(name, {
        status: status?.health.status,
        sync: status?.sync.status,
      });
    } else {
      const prevStatus = this.resourceCacheMap.get(name)?.status;
      const prevSync = this.resourceCacheMap.get(name)?.sync;

      if (prevStatus !== status?.health.status || prevSync !== status?.sync.status) {
        hasBeenUpdated = true;
      } else {
        logger.debug(`Status for ${kind} '${name}' is already up-to-date`);
      }
    }

    if (hasBeenUpdated) {
      logger.info(`Sending notification for ${kind} '${name}'`);

      const prevStatus = this.resourceCacheMap.get(name)?.status;
      const prevSync = this.resourceCacheMap.get(name)?.sync;

      logger.info(
        `Updated status for ${kind} '${name}': status: ${prevStatus} -> ${status?.health.status} / syncStatus ${prevSync} -> ${status?.sync.status}`,
      );

      this.resourceCacheMap.set(name, {
        ...this.resourceCacheMap.get(name),
        status: status?.health.status,
        sync: status?.sync.status,
      });

      // this.sendNotification({
      //   kind,
      //   name,
      //   status: status?.health.status,
      //   sync: status?.sync.status,
      // });
    }
  }
}
