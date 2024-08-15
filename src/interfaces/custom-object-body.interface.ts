import { KubernetesListObject, KubernetesObjectWithSpec } from '@kubernetes/client-node';
import type { EntityNextGen } from './entity-next-gen';

export type K8sResponseObject<T extends EntityNextGen> = KubernetesObjectWithSpec & {
  metadata: KubernetesObjectWithSpec['metadata'] & Pick<T['metadata'], 'name'>;
  spec: T['spec'];
  status: T['status'];
};

export type K8sListResponseBody<T extends EntityNextGen> = KubernetesListObject<K8sResponseObject<T>>;
