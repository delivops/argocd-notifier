import { Scope } from '@/enums/scope.enum';
import type { CustomResource } from '@/interfaces/custom-resource.interface';

export const getResourceScope = (object: CustomResource) => {
  const scope = object.metadata.namespace ? Scope.Namespaced : Scope.Cluster;
  return scope;
};
