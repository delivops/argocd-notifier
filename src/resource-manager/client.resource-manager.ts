import { ArgoCdKind, type ArgoCdApplicationDto } from '@/dtos/argocd-application.dto';
// import { ArgoCdHealthStatus } from '@/enums/argocd.enum';
import type { MyCustomResource } from '@/interfaces/my-custom-resource.interface';
import { logger } from '@/logger';
import { findCrdConfigByKind } from '@/operator-resources';
import { BaseResourceManager } from './base.resource-manager';

type ArgoCdResource = MyCustomResource<ArgoCdApplicationDto>;

export class ArgoCdResourceManager extends BaseResourceManager {
  definition = findCrdConfigByKind(ArgoCdKind);

  protected async syncResource(object: ArgoCdResource): Promise<void> {
    const { kind, status, metadata } = object;
    const { name } = metadata;

    const statusUpdate: ArgoCdApplicationDto['status'] =
      structuredClone(status as ArgoCdApplicationDto['status']) || {};

    if (statusUpdate.health.status === status?.health.status) {
      logger.debug(`Status for ${kind} '${name}' is already up-to-date`);
      return;
    }
  }

  protected async deleteResource(_object: ArgoCdResource): Promise<void> {
    logger.info('ArgoCD resource deletion is not supported');
    return;
  }
}
