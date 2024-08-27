import { slack_config } from '@/config/app.config';
import {
  ArgoCdKind,
  type ArgoCdApplicationDto,
  type ArgoCdApplicationSpecSourceHelmValuesObject,
} from '@/dtos/argocd-application.dto';
import { ArgoCdHealthStatus, ArgoCdSyncStatus } from '@/enums/argocd.enum';
import type { CustomResource } from '@/interfaces/custom-resource.interface';
import { logger } from '@/logger';
import { findCrdConfigByKind } from '@/operator-resources';
import { filterChanges } from '@/utils/filter-changes';
import { WebClient, type KnownBlock } from '@slack/web-api';
import YAML from 'yaml';
import { BaseResourceManager } from './base.resource-manager';

type ArgoCdResource = CustomResource<ArgoCdApplicationDto>;
type ValuesObject = ArgoCdApplicationSpecSourceHelmValuesObject;
type ChangesObject = Partial<ValuesObject> & { targetRevision?: string };

interface CacheEntry {
  status: ArgoCdHealthStatus;
  sync: ArgoCdSyncStatus;
  valuesObject: ValuesObject;
  targetRevision: string;
  lastMessageTs: string | undefined;
}

type ResourceUpdate = Omit<CacheEntry, 'lastMessageTs'>;

export class ArgoCdApplicationResourceManager extends BaseResourceManager {
  readonly definition = findCrdConfigByKind(ArgoCdKind);

  private readonly slackClient: WebClient | undefined = slack_config.TOKEN
    ? new WebClient(slack_config.TOKEN)
    : undefined;
  private readonly resourceCacheMap: Map<string, CacheEntry> = new Map();

  protected async syncResource(resource: ArgoCdResource): Promise<void> {
    const { kind, status, metadata, spec } = resource;
    const { name } = metadata;

    if (this.isDirectorySource(resource)) {
      logger.debug(`Ignoring ${kind} '${name}' as it is a directory source`);
      return;
    }

    const update: ResourceUpdate = {
      status: status?.health.status || ArgoCdHealthStatus.Unknown,
      sync: status?.sync.status || ArgoCdSyncStatus.Unknown,
      valuesObject: spec.source.helm?.valuesObject || {},
      targetRevision: spec.source.targetRevision || '',
    };

    const cachedResource = this.resourceCacheMap.get(name);

    if (!cachedResource) {
      await this.initializeCache(name, update);
      return;
    }

    await this.handleResourceUpdate(name, cachedResource, update, spec.destination.namespace);
  }

  private async initializeCache(name: string, update: ResourceUpdate): Promise<void> {
    logger.debug(`Initializing cache for ${this.definition.names.kind} '${name}'`);
    this.resourceCacheMap.set(name, { ...update, lastMessageTs: undefined });
  }

  private async handleResourceUpdate(
    name: string,
    cachedResource: CacheEntry,
    update: ResourceUpdate,
    targetNamespace: string | undefined,
  ): Promise<void> {
    const changes: ChangesObject = this.getChanges(cachedResource, update);
    const hasChanges = Object.keys(changes).length > 0;

    if (this.isSyncStatusChanged(cachedResource, update)) {
      await this.handleSyncStatusChange(name, targetNamespace, update, changes, cachedResource, hasChanges);
    } else if (this.isHealthStatusChanged(cachedResource, update)) {
      await this.handleHealthStatusChange(name, targetNamespace, update, changes, cachedResource);
    } else {
      logger.debug(`No status change for ${this.definition.names.kind} '${name}'`);
    }
  }

  private async handleSyncStatusChange(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changes: ChangesObject,
    cachedResource: CacheEntry,
    hasChanges: boolean,
  ): Promise<void> {
    if (hasChanges) {
      if (update.sync === ArgoCdSyncStatus.OutOfSync) {
        this.updateCache(name, { sync: update.sync, lastMessageTs: undefined });
        await this.createSlackMessage(name, targetNamespace, update, changes, cachedResource);
      } else {
        this.updateCache(name, { sync: update.sync, ...changes });
        await this.updateOrCreateSlackMessage(name, targetNamespace, update, changes, cachedResource);
      }
    } else {
      await this.updateOrCreateSlackMessage(name, targetNamespace, update, changes, cachedResource);
    }
  }

  private async handleHealthStatusChange(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changes: ChangesObject,
    cachedResource: CacheEntry,
  ): Promise<void> {
    if (this.isDeploySettled(update, cachedResource)) {
      // TODO: DECIDE ON THE BEHAVIOR
      // add { lastMessageTs: undefined } to force sending a new notification
      // when the deployment is settled after being in Progressing state
      // a) this way we know when a new version is deployed
      // b) when Degraded or Missing status is looped new notification will be sent
      this.updateCache(name, { ...update });
    } else {
      this.updateCache(name, { status: update.status });
    }
    await this.updateOrCreateSlackMessage(name, targetNamespace, update, changes, cachedResource);
  }

  private async updateOrCreateSlackMessage(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changes: ChangesObject,
    cachedResource: CacheEntry,
  ): Promise<void> {
    const { lastMessageTs } = cachedResource;
    if (lastMessageTs) {
      await this.updateSlackMessage(name, targetNamespace, update, changes, cachedResource, lastMessageTs);
    } else {
      await this.createSlackMessage(name, targetNamespace, update, changes, cachedResource);
    }
  }

  private updateCache(name: string, cacheUpdate: Partial<CacheEntry>): void {
    const cachedResource = this.resourceCacheMap.get(name);
    if (cachedResource) {
      this.resourceCacheMap.set(name, { ...cachedResource, ...cacheUpdate });
    }
  }

  private async createSlackMessage(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changes: ChangesObject,
    cachedResource: CacheEntry,
  ): Promise<void> {
    try {
      const blocks = this.createNotificationBlocks(name, targetNamespace, update, changes, cachedResource);
      const altText = this.createAltText(name, targetNamespace, update, changes, cachedResource);

      const res = await this.sendSlackMessage(blocks, altText);

      logger.info(`New notification sent to Slack for ${name}`);
      logger.dir({ text: altText, blocks }, { depth: 10 });

      this.updateCache(name, { lastMessageTs: res.ts });
    } catch (error) {
      logger.error(`Failed to send Slack notification: ${error}`);
    }
  }

  private async updateSlackMessage(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changes: ChangesObject,
    cachedResource: CacheEntry,
    lastMessageTs: string,
  ): Promise<void> {
    try {
      const blocks = this.createNotificationBlocks(name, targetNamespace, update, changes, cachedResource);
      const altText = this.createAltText(name, targetNamespace, update, changes, cachedResource);

      await this.slackClient?.chat.update({
        text: altText,
        blocks,
        channel: slack_config.CHANNEL_ID,
        ts: lastMessageTs,
      });

      logger.info(`Notification updated in Slack for ${name}`);
      logger.dir({ text: altText, blocks, ts: lastMessageTs }, { depth: 10 });
    } catch (error) {
      logger.error(`Failed to update Slack notification: ${error}`);
    }
  }

  private async sendSlackMessage(blocks: KnownBlock[], altText: string): Promise<{ ts: string }> {
    const res = await this.slackClient?.chat.postMessage({
      icon_url: 'https://argo-cd.readthedocs.io/en/stable/assets/logo.png',
      text: altText,
      blocks,
      channel: slack_config.CHANNEL_ID,
    });

    return { ts: res?.ts || new Date().toISOString() };
  }

  private createNotificationBlocks(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changes: ChangesObject,
    cachedResource: CacheEntry,
  ): KnownBlock[] {
    const blocks: KnownBlock[] = [
      this.createHeaderBlock(name),
      ...this.createInfoBlock(name, targetNamespace, changes, cachedResource),
      this.createStatusBlock(update),
    ];

    const hasChanges = Object.keys(changes).length > 0;
    if (hasChanges) {
      blocks.push(this.createChangesBlock(changes));
    }

    blocks.push({ type: 'divider' });

    return blocks;
  }

  private createHeaderBlock(name: string): KnownBlock {
    return {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `Application Updated: ${name}${process.env.NODE_ENV === 'production' ? '' : ' (TEST)'}`,
        emoji: true,
      },
    };
  }

  private createInfoBlock(
    name: string,
    targetNamespace: string | undefined,
    changes: ChangesObject,
    cachedResource: CacheEntry,
  ): KnownBlock[] {
    const prevVersion = cachedResource.valuesObject.image?.tag || cachedResource.targetRevision;
    const currentVersion = changes.image?.tag || changes.targetRevision || prevVersion;
    return [
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Application:* \`${name}\``,
          },
          {
            type: 'mrkdwn',
            text: `*Namespace:* \`${targetNamespace || 'Cluster Scoped'}\``,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Version:* ${this.createChangeDescription(prevVersion, currentVersion, '', '`')}`,
        },
      },
    ];
  }

  private createStatusBlock(update: ResourceUpdate): KnownBlock {
    const { status, sync } = update;
    return {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Health Status:* ${this.getStatusEmoji(status)} ${status}`,
        },
        {
          type: 'mrkdwn',
          text: `*Sync Status:* ${this.getStatusEmoji(sync)} ${sync}`,
        },
      ],
    };
  }

  private createChangesBlock(changes: ChangesObject): KnownBlock {
    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Changes:*\n\`\`\`\n${YAML.stringify(changes)}\n\`\`\``,
      },
    };
  }

  private createAltText(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changes: ChangesObject,
    cachedResource: CacheEntry,
  ): string {
    const prevVersion = cachedResource.valuesObject.image?.tag || cachedResource.targetRevision;
    const currentVersion = changes.image?.tag || changes.targetRevision || prevVersion;
    return [
      `*Application Updated*`,
      `*Application:* ${name}${process.env.NODE_ENV === 'production' ? '' : ' (TEST)'}`,
      `*Namespace:* ${targetNamespace || 'Cluster Scoped'}`,
      `*Version:* ${this.createChangeDescription(prevVersion, currentVersion)}`,
      `*Health Status:* ${update.status}`,
      `*Sync Status:* ${update.sync}`,
      `*Changes:* ${JSON.stringify(changes)}`,
    ].join('\n');
  }

  private getStatusEmoji(status: ArgoCdHealthStatus | ArgoCdSyncStatus): string {
    const emojiMap: Record<string, string> = {
      [ArgoCdHealthStatus.Degraded]: ':x:',
      [ArgoCdHealthStatus.Missing]: ':x:',
      [ArgoCdSyncStatus.OutOfSync]: ':warning:',
      [ArgoCdHealthStatus.Healthy]: ':white_check_mark:',
      [ArgoCdHealthStatus.Progressing]: ':hourglass_flowing_sand:',
      [ArgoCdHealthStatus.Suspended]: ':hourglass_flowing_sand:',
      [ArgoCdSyncStatus.Synced]: ':white_check_mark:',
    };

    return emojiMap[status] || '';
  }

  private isDirectorySource(resource: ArgoCdResource): boolean {
    return !!resource.spec.source.directory;
  }

  private isDeploySettled(update: ResourceUpdate, cachedResource: CacheEntry): boolean {
    return cachedResource.status === ArgoCdHealthStatus.Progressing && update.status !== cachedResource.status;
  }

  private createChangeDescription(
    prev: string | undefined,
    current: string | undefined,
    emoji: string = '',
    markDownTag: string = '',
  ): string {
    const currentFormattedVersion = `${emoji} ${markDownTag}${current || '?'}${markDownTag}`;
    if (prev !== current) {
      return `${emoji} ${markDownTag}${prev || '?'}${markDownTag} → ${currentFormattedVersion}`;
    }
    return currentFormattedVersion;
  }

  private getChanges(cachedResource: CacheEntry, update: ResourceUpdate): ChangesObject {
    return filterChanges<ChangesObject>(
      { valuesObject: update.valuesObject, targetRevision: update.targetRevision },
      { valuesObject: cachedResource.valuesObject, targetRevision: cachedResource.targetRevision },
    );
  }

  private isSyncStatusChanged(cachedResource: CacheEntry, update: ResourceUpdate): boolean {
    return cachedResource.sync !== update.sync;
  }

  private isHealthStatusChanged(cachedResource: CacheEntry, update: ResourceUpdate): boolean {
    return cachedResource.status !== update.status;
  }
}
