import { argocdResource } from '@/argocd-resource';
import { app_config, slack_config } from '@/config/app.config';
import { ArgoCdHealthStatus, ArgoCdSyncStatus } from '@/enums/argocd.enum';
import type { ArgoCdResource } from '@/interfaces/argcd-resource.interface';
import type { ResourceUpdate } from '@/interfaces/resource-update.interface';
import { CacheManager } from '@/utils/cache-manager.utils';
import { ChangeDetector } from '@/utils/changes-detector.utils';
import { logger } from '@/utils/logger';
import { SlackNotifier } from '@/utils/slack-notifier.utils';
import { WebClient } from '@slack/web-api';
import { BaseResourceManager } from './base.resource-manager';

export class ArgoCdApplicationResourceManager extends BaseResourceManager {
  readonly definition = argocdResource.crdConfig;

  private readonly slackClient: WebClient | undefined = slack_config.BOT_TOKEN
    ? new WebClient(slack_config.BOT_TOKEN)
    : undefined;

  private readonly cacheManager = new CacheManager();
  private readonly slackNotifier = new SlackNotifier(this.slackClient, slack_config.CHANNEL_ID);
  private readonly changeDetector = new ChangeDetector(app_config.CONTEXT_DIFF_LINES_COUNT);

  protected async syncResource(resource: ArgoCdResource): Promise<void> {
    const { kind, status, metadata, spec } = resource;
    const { name } = metadata;

    if (this.isDirectorySource(resource)) {
      logger.debug(`Ignoring ${kind} '${name}' as it is a directory source`);
      return;
    }

    const update = {
      status: status?.health.status || ArgoCdHealthStatus.N_A,
      sync: status?.sync.status || ArgoCdSyncStatus.N_A,
      spec,
    };

    if (!this.cacheManager.has(name)) {
      await this.cacheManager.initialize(name, update);
      return;
    }

    await this.handleResourceUpdate(name, update, spec.destination.namespace);
  }

  private async handleResourceUpdate(
    name: string,
    update: ResourceUpdate,
    targetNamespace: string | undefined,
  ): Promise<void> {
    const cachedResource = this.cacheManager.get(name)!;
    const changesString = this.changeDetector.generateChangesString(cachedResource.spec, update.spec);
    const hasChanges = changesString.length > 0;
    const statusChanged = this.changeDetector.hasStatusChanged(cachedResource, update);

    logger.verbose(
      `Processing update for ${name}: ` +
        `syncStatus: ${cachedResource.sync}->${update.sync}, ` +
        `healthStatus: ${cachedResource.status}->${update.status}, ` +
        `${hasChanges ? 'has changes' : 'NO changes'}, ` +
        `lastMessageTs: ${cachedResource.lastMessageTs}, ` +
        `deploymentInProgress: ${cachedResource.deploymentInProgress}`,
    );

    if (statusChanged && hasChanges) {
      if (!cachedResource.deploymentInProgress) {
        await this.startNewDeployment(name, targetNamespace, update, changesString);
      } else {
        await this.updateExistingDeployment(name, targetNamespace, update, changesString);
      }
    } else if (statusChanged && cachedResource.deploymentInProgress) {
      await this.updateExistingDeployment(name, targetNamespace, update, changesString);
    } else {
      logger.debug(`No status change for ${this.definition.names.kind} '${name}'`);
    }
  }

  protected async startNewDeployment(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changesString: string,
  ): Promise<void> {
    logger.info(`Starting new deployment for ${name}`);
    const res = await this.slackNotifier.createMessage(name, targetNamespace, update, changesString);

    const lastMessageTs = res?.ts || 'mock-timestamp';
    this.cacheManager.update(name, update, lastMessageTs, changesString, true);
  }

  protected async updateExistingDeployment(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changesString: string,
  ): Promise<void> {
    logger.info(`Updating existing deployment for ${name}`);
    const cachedResource = this.cacheManager.get(name)!;
    const updatedChanges = this.changeDetector.mergeChanges(cachedResource.persistentChanges, changesString);

    const res = await this.slackNotifier.updateMessage(
      name,
      targetNamespace,
      update,
      updatedChanges,
      cachedResource.lastMessageTs!,
    );

    const lastMessageTs = res?.ts || 'mock-timestamp-updated';
    const deploymentInProgress = this.changeDetector.isDeploymentInProgress(update);
    this.cacheManager.update(name, update, lastMessageTs, updatedChanges, deploymentInProgress);
  }

  private isDirectorySource(resource: ArgoCdResource): boolean {
    return !!resource.spec.source.directory;
  }
}
