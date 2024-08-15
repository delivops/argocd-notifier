import { Scope } from '@/enums/scope.enum';
import type { MyCustomResource } from '@/interfaces/my-custom-resource.interface';

export const getResourceScope = (object: MyCustomResource) => {
  const scope = object.metadata.namespace ? Scope.Namespaced : Scope.Cluster;
  return scope;
};
