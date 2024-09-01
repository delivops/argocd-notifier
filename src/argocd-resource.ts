import { ArgoCdApplicationMetadataSchema, ArgoCdNames } from '@/dtos/argocd-application.dto';
import { Scope } from '@/enums/scope.enum';
import type { OperatorResource } from '@/interfaces/operator-resources.interface';
import { ArgoCdApplicationResourceManager } from '@/resource-manager/argocd-application.resource-manager';

export const argocdResource: OperatorResource = {
  crdConfig: {
    names: ArgoCdNames,
    scope: Scope.Namespaced,
    dto: ArgoCdApplicationMetadataSchema,
  },
  resourceManagerClass: ArgoCdApplicationResourceManager,
};
