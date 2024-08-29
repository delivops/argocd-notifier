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
import { generateReadableDiff } from '@/utils/generate-readable-diff';
import { WebClient, type KnownBlock } from '@slack/web-api';
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
  lastChanges: ChangesObject | undefined;
}

type ResourceUpdate = Omit<CacheEntry, 'lastMessageTs' | 'lastChanges'>;

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
      status: status?.health.status || ArgoCdHealthStatus.N_A,
      sync: status?.sync.status || ArgoCdSyncStatus.N_A,
      valuesObject: spec.source.helm?.valuesObject || {},
      targetRevision: spec.source.targetRevision || '',
    };

    if (!this.resourceCacheMap.has(name)) {
      await this.initializeCache(name, update);
      return;
    }

    await this.handleResourceUpdate(name, update, spec.destination.namespace);
  }

  private async initializeCache(name: string, update: ResourceUpdate): Promise<void> {
    logger.debug(`Initializing cache for ${this.definition.names.kind} '${name}'`);
    this.resourceCacheMap.set(name, { ...update, lastMessageTs: undefined, lastChanges: undefined });
  }

  private async handleResourceUpdate(
    name: string,
    update: ResourceUpdate,
    targetNamespace: string | undefined,
  ): Promise<void> {
    const cachedResource = this.resourceCacheMap.get(name)!;
    const changes: ChangesObject = this.getChanges(cachedResource, update);
    const hasChanges = Object.keys(changes).length > 0;

    const syncChanged = this.isSyncStatusChanged(cachedResource, update);
    const healthChanged = this.isHealthStatusChanged(cachedResource, update);

    if (syncChanged || healthChanged || hasChanges) {
      if (hasChanges || (update.sync === ArgoCdSyncStatus.OutOfSync && !cachedResource.lastChanges)) {
        await this.createSlackMessage(name, targetNamespace, update, changes);
        this.resourceCacheMap.set(name, {
          ...update,
          lastMessageTs: this.resourceCacheMap.get(name)!.lastMessageTs,
          lastChanges: changes,
        });
      } else {
        await this.updateSlackMessage(name, targetNamespace, update, cachedResource.lastChanges || {});
        this.resourceCacheMap.set(name, {
          ...update,
          lastMessageTs: this.resourceCacheMap.get(name)!.lastMessageTs,
          lastChanges: cachedResource.lastChanges,
        });
      }
    } else {
      logger.debug(`No status change for ${this.definition.names.kind} '${name}'`);
    }
  }

  private async createSlackMessage(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changes: ChangesObject,
  ): Promise<void> {
    try {
      const cachedResource = this.resourceCacheMap.get(name)!;
      const changesString = this.createChangesString(cachedResource, update);
      const blocks = this.createNotificationBlocks(name, targetNamespace, update, changes, changesString);
      const altText = this.createAltText(name, targetNamespace, update, changesString);

      const res = await this.slackClient?.chat.postMessage({
        icon_url: 'https://argo-cd.readthedocs.io/en/stable/assets/logo.png',
        text: altText,
        blocks,
        channel: slack_config.CHANNEL_ID,
      });

      logger.info(`New notification sent to Slack for ${name}`);
      logger.dir({ text: altText, blocks }, { depth: 10 });

      this.resourceCacheMap.set(name, {
        ...this.resourceCacheMap.get(name)!,
        lastMessageTs: res?.ts || new Date().toISOString(),
      });
    } catch (error) {
      logger.error(`Failed to send Slack notification: ${error}`);
    }
  }

  private async updateSlackMessage(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changes: ChangesObject,
  ): Promise<void> {
    try {
      const cachedResource = this.resourceCacheMap.get(name)!;
      const changesString = this.createChangesString(cachedResource, update);
      const blocks = this.createNotificationBlocks(name, targetNamespace, update, changes, changesString);
      const altText = this.createAltText(name, targetNamespace, update, changesString);

      await this.slackClient?.chat.update({
        text: altText,
        blocks,
        channel: slack_config.CHANNEL_ID,
        ts: cachedResource.lastMessageTs!,
      });

      logger.info(`Notification updated in Slack for ${name}`);
      logger.dir({ text: altText, blocks, ts: cachedResource.lastMessageTs }, { depth: 10 });
    } catch (error) {
      logger.error(`Failed to update Slack notification: ${error}`);
    }
  }

  private createNotificationBlocks(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changes: ChangesObject,
    changesString: string,
  ): KnownBlock[] {
    const blocks: KnownBlock[] = [
      this.createHeaderBlock(name),
      ...this.createInfoBlock(name, targetNamespace),
      this.createStatusBlock(update),
    ];

    const hasChanges = Object.keys(changes).length > 0;
    if (hasChanges) {
      blocks.push(this.createChangesBlock(changesString));
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

  private createInfoBlock(name: string, targetNamespace: string | undefined): KnownBlock[] {
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

  private createChangesBlock(changesString: string): KnownBlock {
    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Changes:* \n\`\`\`\n${changesString || 'no changes'}\n\`\`\``,
      },
    };
  }

  private createAltText(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changesString: string,
  ): string {
    return [
      `*Application Updated*`,
      `*Application:* ${name}${process.env.NODE_ENV === 'production' ? '' : ' (TEST)'}`,
      `*Namespace:* ${targetNamespace || 'Cluster Scoped'}`,
      `*Health Status:* ${update.status}`,
      `*Sync Status:* ${update.sync}`,
      `*Changes:* ${changesString}`,
    ]
      .join('\n')
      .slice(0, 4000);
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

  private createChangesString(cachedResource: CacheEntry, update: ResourceUpdate): string {
    return generateReadableDiff(
      { valuesObject: cachedResource.valuesObject, targetRevision: cachedResource.targetRevision },
      { valuesObject: update.valuesObject, targetRevision: update.targetRevision },
    );
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
