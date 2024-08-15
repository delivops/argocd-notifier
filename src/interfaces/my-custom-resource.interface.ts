import type { ArgoCdKind } from '@/dtos/argocd-application.dto';
import type { EntityNextGen } from './entity-next-gen';

export type MyCustomResource<T extends EntityNextGen = EntityNextGen> = {
  apiVersion: string;
  kind: typeof ArgoCdKind;
  metadata: {
    name: string;
    namespace?: string;
    generation?: number;
    finalizers?: string[];
    deletionTimestamp?: string;
  } & T['metadata'];
  status?: T['status'];
  spec: T['spec'];
};
