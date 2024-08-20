import type { BaseResourceManagerClass } from '@/resource-manager/base.resource-manager';
import { CrdConfig } from './crd-config.interface';

export type OperatorResource = {
  crdConfig: CrdConfig;
  resourceManagerClass: BaseResourceManagerClass;
  syncOptions?: { cronPattern: string };
};
