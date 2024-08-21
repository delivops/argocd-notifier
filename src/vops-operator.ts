import { CoreV1Api, CustomObjectsApi, KubeConfig } from '@kubernetes/client-node';
import { ActionOnInvalid } from '@kubernetes/client-node/dist/config_types';
import Cron, { type CronOptions } from 'croner';
import { argo_config } from './config/app.config';
import { CustomResourceOperator } from './custom-resource-operator/custom-resource-operator';
import type { ArgoCdKind } from './dtos/argocd-application.dto';
import { Scope } from './enums/scope.enum';
import type { Logger } from './interfaces/logger.interface';
import type { OperatorResource } from './interfaces/operator-resources.interface';
import type { ResourceEvent } from './interfaces/resource-event.interface';
import { logger } from './logger';
import type { BaseResourceManager } from './resource-manager/base.resource-manager';

export class VopsOperator extends CustomResourceOperator {
  private readonly k8sApi: CoreV1Api;
  private readonly customObjectsApiClient: CustomObjectsApi;
  private readonly resourceManagers: Record<typeof ArgoCdKind, BaseResourceManager> = {} as Record<
    typeof ArgoCdKind,
    BaseResourceManager
  >;
  private readonly cronJobs: Record<typeof ArgoCdKind, Cron> = {} as Record<typeof ArgoCdKind, Cron>;

  constructor(
    private readonly resources: OperatorResource[],
    logger: Logger,
  ) {
    super(logger);

    const kc = new KubeConfig();
    // This method finds kubernetes connection configuration through several possible ways
    kc.loadFromDefault({ onInvalidEntry: ActionOnInvalid.THROW });
    this.customObjectsApiClient = kc.makeApiClient(CustomObjectsApi);
    this.k8sApi = kc.makeApiClient(CoreV1Api);
  }

  protected async init() {
    for (const resource of this.resources) {
      await this.setupResource(resource);
    }
  }

  protected async setupResource(resource: OperatorResource) {
    const { kind, kindPlural } = resource.crdConfig.names;
    const namespace = resource.crdConfig.scope === Scope.Namespaced ? argo_config.namespace : undefined;

    this.logger.debug(`Setting up '${kind}' manager and watchers...`);

    // Set up resource manager
    this.resourceManagers[kind] = new resource.resourceManagerClass(this.customObjectsApiClient, this.k8sApi);

    // Watch resource
    await this.setupResourceWatcher(resource, namespace, kindPlural);

    // Set up cron job for resource synchronization
    this.setupResourceCronJob(resource, kind);
  }

  private async setupResourceWatcher(resource: OperatorResource, namespace: string | undefined, kindPlural: string) {
    this.logger.info(`Starting watch on '${kindPlural}' in ${namespace ? `namespace '${namespace}'` : 'cluster'}`);
    try {
      await this.watchResource(
        argo_config.group,
        argo_config.version,
        kindPlural,
        this.handleEvent.bind(this),
        async (err: unknown) => await this.handleWatchError.bind(this)(resource, err),
        namespace,
      );
    } catch (err) {
      this.logger.error(`Failed to watch '${kindPlural}': ${err}`);
    }
  }

  private setupResourceCronJob(resource: OperatorResource, kind: typeof ArgoCdKind) {
    const { cronPattern } = resource.syncOptions || {};

    if (!cronPattern) {
      logger.debug(`No cron pattern found for '${kind}'`);
      return;
    }

    const cronOptions: Partial<CronOptions> = {
      name: kind,
      protect: true,
      catch: (e: unknown) => {
        this.logger.error(`Cron job for '${kind}' encountered an error:`, e);
      },
    };

    this.logger.debug(`Scheduling sync for '${kind}' with pattern '${cronPattern}'`);
    this.cronJobs[kind] = new Cron(cronPattern, cronOptions, async () => await this.resourceManagers[kind].syncAll());
  }

  private async handleWatchError(resource: OperatorResource, err: unknown) {
    const { kindPlural } = resource.crdConfig.names;

    if (err) {
      logger.error(`Error watching '${kindPlural}': ${err}`);
      return;
    }
  }

  private async handleEvent(event: ResourceEvent) {
    const resourceManager = this.resourceManagers[event.object.kind];
    if (!resourceManager) {
      logger.error(`Resource manager for '${event.object.kind}' not found`);
      return;
    }
    try {
      logger.debug(`Handling ${event.type} event for ${event.object.kind} '${event.object.metadata.name}'`);
      await resourceManager.handleEvent(event);
    } catch (err) {
      const error = err as { body: unknown };
      logger.error(`Error handling event for '${event.object.kind}': ${error.body ?? err}`);
    }
  }
}
