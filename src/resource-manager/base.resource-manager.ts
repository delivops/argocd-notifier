import { RefinedEventType } from '@/enums/refined-event-type.enum';
import type { CrdConfig } from '@/interfaces/crd-config.interface';
import type { MyCustomResource } from '@/interfaces/my-custom-resource.interface';
import type { MyResourceEvent } from '@/interfaces/my-resource-event.interface';
import { logger } from '@/logger';
import { getRefinedEventType } from '@/utils/get-refined-event-type';
import { CustomResourceUtils } from '@/utils/k8s/custom-resource.k8s.utils';
import type { CoreV1Api, CustomObjectsApi } from '@kubernetes/client-node';

export abstract class BaseResourceManager {
  abstract definition: CrdConfig;

  constructor(
    protected readonly k8sCustomObjectsApi: CustomObjectsApi,
    protected readonly k8sApi: CoreV1Api,
    protected readonly customResourceUtils = new CustomResourceUtils(k8sCustomObjectsApi),
  ) {}

  public async handleEvent(event: MyResourceEvent): Promise<void> {
    const refinedEventType = getRefinedEventType(event);
    logger.debug(
      `***** Handle ${refinedEventType} (K8s: ${event.type}) for ${event.object.kind} '${event.object.metadata.name}'`,
    );

    let handler: ((event: MyResourceEvent) => Promise<void>) | undefined;

    switch (refinedEventType) {
      case RefinedEventType.Added:
        handler = this.handleAddedEvent;
        break;
      case RefinedEventType.Modified:
        handler = this.handleModifiedEvent;
        break;
      case RefinedEventType.Deleting:
        handler = this.handleDeletingEvent;
        break;
      case RefinedEventType.Deleted:
        handler = this.handleDeletedEvent;
        break;
      case RefinedEventType.UpToDate:
        handler = this.handleUpToDateEvent;
        break;
      default:
        logger.error(`Unknown event type: ${event.type}`);
        logger.dir(event);
        break;
    }

    if (typeof handler === 'function') {
      await handler.bind(this)(event);
    }

    logger.debug(
      `***** Done ${refinedEventType} (K8s: ${event.type}) for ${event.object.kind} '${event.object.metadata.name}'\n`,
    );
  }

  public async syncAll(): Promise<void> {
    logger.debug(`Syncing all resources of kind '${this.definition.names.kind}'`);

    const k8sObjects = await this.customResourceUtils.listCustomResources(this.definition);

    for (const object of k8sObjects) {
      await this.syncResource(object as MyCustomResource);
    }
  }

  protected async handleAddedEvent(event: MyResourceEvent): Promise<void> {
    await this.syncResource(event.object);
  }

  protected async handleModifiedEvent(event: MyResourceEvent): Promise<void> {
    await this.syncResource(event.object);
  }

  protected async handleUpToDateEvent(event: MyResourceEvent): Promise<void> {
    await this.syncResource(event.object);
  }

  protected async handleDeletingEvent(event: MyResourceEvent): Promise<void> {
    await this.deleteResource(event.object);
  }

  protected async handleDeletedEvent?(event: MyResourceEvent): Promise<void>;
  protected async deleteDependentResources?(object: MyCustomResource): Promise<boolean>;

  protected abstract syncResource(object: MyCustomResource): Promise<void>;
  protected abstract deleteResource(object: MyCustomResource): Promise<void>;
}

export type BaseResourceManagerClass = new (
  ...args: ConstructorParameters<typeof BaseResourceManager>
) => BaseResourceManager;
