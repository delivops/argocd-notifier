import { argo_config } from '@/config/argo.config';
import { Scope } from '@/enums/scope.enum';
import type { CrdConfig } from '@/interfaces/crd-config.interface';
import type { K8sListResponseBody, K8sResponseObject } from '@/interfaces/custom-object-body.interface';
import type { EntityNextGen } from '@/interfaces/entity-next-gen';
import type { K8sResponseError } from '@/interfaces/k8s-response-error.interfaces';
import { logger } from '@/logger';
import { type CustomObjectsApi } from '@kubernetes/client-node';

export class CustomResourceUtils {
  constructor(protected readonly k8sCustomObjectsApi: CustomObjectsApi) {}

  public async listCustomResources<T extends EntityNextGen>(
    resourceDefinition: CrdConfig,
  ): Promise<K8sResponseObject<T>[]> {
    const namespaced = resourceDefinition.scope === Scope.Namespaced;
    const plural = resourceDefinition.names.kindPlural;

    let apiMethod: CustomObjectsApi['listNamespacedCustomObject' | 'listClusterCustomObject'];
    let args: Parameters<typeof apiMethod>;

    args = [
      argo_config.group, // group: string,
      argo_config.version, // version: string,
      argo_config.namespace, // namespace?: string,
      plural, // plural: string,
      // pretty?: string, allowWatchBookmarks?: boolean, _continue?: string, fieldSelector?: string, labelSelector?: string,
      // limit?: number, resourceVersion?: string, resourceVersionMatch?: string, timeoutSeconds?: number, watch?: boolean, options?: {},
    ];
    apiMethod = this.k8sCustomObjectsApi.listNamespacedCustomObject;

    if (!namespaced) {
      args = [args[0], args[1], ...args.slice(3)] as Parameters<typeof apiMethod>;
      apiMethod = this.k8sCustomObjectsApi.listClusterCustomObject;
    }

    try {
      // @ts-expect-error STRICT mode give an error here
      const { body } = (await apiMethod.apply(this.k8sCustomObjectsApi, args)) as { body: K8sListResponseBody<T> };

      if (body.metadata?._continue) {
        const count = body.metadata.remainingItemCount;
        const message = `There are ${count} items of '${plural}' in ${namespaced ?? 'the Cluster'} left`;
        logger.warn(message);
      }

      return body.items;
    } catch (err) {
      const error = err as K8sResponseError;
      const message = `Error getting '${plural}' from ${namespaced ?? 'the Cluster'}: ${error.message}`;
      logger.error(message, error.body ?? error);
    }

    return [];
  }

  public async getResourceByName<T extends EntityNextGen>(
    metadataName: string,
    resourceDefinition: CrdConfig,
    namespace?: string,
  ): Promise<K8sResponseObject<T>> {
    const namespaced = resourceDefinition.scope === Scope.Namespaced;
    const plural = resourceDefinition.names.kindPlural;

    let apiMethod: CustomObjectsApi['getNamespacedCustomObject' | 'getClusterCustomObject'];
    let args: Parameters<typeof apiMethod>;

    args = [
      argo_config.group, // group: string,
      argo_config.version, // version: string,
      namespace || '', // namespace?: string,
      plural, // plural: string,
      metadataName, // name: string,
      undefined, // options?: {},
    ];
    apiMethod = this.k8sCustomObjectsApi.getNamespacedCustomObject;

    if (!namespace) {
      args = [args[0], args[1], ...args.slice(3)] as Parameters<typeof apiMethod>;
      apiMethod = this.k8sCustomObjectsApi.getClusterCustomObject;
    }

    try {
      // @ts-expect-error STRICT mode give an error here
      const { body } = (await apiMethod.apply(this.k8sCustomObjectsApi, args)) as { body: K8sResponseObject<T> };
      return body;
    } catch (err) {
      logger.error(`Error getting '${metadataName}' in '${plural}' from ${namespaced ?? 'the Cluster'}`);
      throw err;
    }
  }
}
