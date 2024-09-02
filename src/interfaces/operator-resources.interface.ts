import type { BaseResourceManagerClass } from '@/resource-manager/base.resource-manager';
import type { CrdConfig } from './crd-config.interface';

export type OperatorResource = {
  crdConfig: CrdConfig;
  resourceManagerClass: BaseResourceManagerClass;
  syncOptions?: { cronPattern: string };
};
