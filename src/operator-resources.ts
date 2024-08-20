import { ArgoCdApplicationMetadataSchema, ArgoCdNames, type ArgoCdKind } from './dtos/argocd-application.dto';
import { Scope } from './enums/scope.enum';
import type { CrdConfig } from './interfaces/crd-config.interface';
import type { OperatorResource } from './interfaces/operator-resources.interface';
import { ArgoCdApplicationResourceManager } from './resource-manager/argocd-application.resource-manager';

export const operatorResources: OperatorResource[] = [
  {
    crdConfig: {
      names: ArgoCdNames,
      scope: Scope.Namespaced,
      dto: ArgoCdApplicationMetadataSchema,
    },
    resourceManagerClass: ArgoCdApplicationResourceManager,
    // syncOptions: { cronPattern: '0 * * * *' },
  },
];

export const findCrdConfigByKind = (kind: typeof ArgoCdKind): CrdConfig => {
  const resource = operatorResources.find(({ crdConfig }) => crdConfig.names.kind === kind);
  if (!resource) {
    throw new Error(`Resource definition not found for kind: ${kind}`);
  }
  return resource.crdConfig;
};
