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
      status: status?.health.status || ('' as ArgoCdHealthStatus),
      sync: status?.sync.status || ('' as ArgoCdSyncStatus),
      valuesObject: spec.source.helm?.valuesObject || {},
      targetRevision: spec.source.targetRevision || '',
    };

    const cachedResource = this.resourceCacheMap.get(name);

    if (!cachedResource) {
      // Set initial cache with current or empty values then return
      await this.initializeCache(name, update.status, update.sync, update.valuesObject, update.targetRevision);
      return;
    }

    await this.handleResourceUpdate(name, cachedResource, update, spec.destination.namespace);
  }

  private async initializeCache(
    name: string,
    status: ArgoCdHealthStatus,
    sync: ArgoCdSyncStatus,
    valuesObject: ValuesObject,
    targetRevision: string,
  ): Promise<void> {
    logger.debug(`Initializing cache for ${this.definition.names.kind} '${name}'`);
    this.resourceCacheMap.set(name, { status, sync, valuesObject, targetRevision, lastMessageTs: undefined });
  }

  private async handleResourceUpdate(
    name: string,
    cachedResource: CacheEntry,
    update: ResourceUpdate,
    targetNamespace: string | undefined,
  ): Promise<void> {
    const { lastMessageTs } = cachedResource;
    const changes: Partial<ChangesObject> = filterChanges<ChangesObject>(
      { valuesObject: update.valuesObject, targetRevision: update.targetRevision },
      { valuesObject: cachedResource.valuesObject, targetRevision: cachedResource.targetRevision },
    );

    if (cachedResource.sync !== update.sync) {
      await this.handleSyncStatusChange(name, targetNamespace, update, changes, cachedResource, lastMessageTs);
    } else if (cachedResource.status !== update.status) {
      await this.handleHealthStatusChange(name, targetNamespace, update, changes, cachedResource, lastMessageTs);
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
    lastMessageTs: string | undefined,
  ): Promise<void> {
    const { valuesObject: prevValuesObject, targetRevision: prevTargetRevision } = cachedResource;
    const hasChanges = Object.keys(changes).length > 0;

    if (hasChanges) {
      if (update.sync === ArgoCdSyncStatus.OutOfSync) {
        this.updateCache(name, { sync: update.sync, lastMessageTs: undefined });
        await this.createSlackMessage(name, targetNamespace, update, changes, prevValuesObject, prevTargetRevision);
      } else {
        this.updateCache(name, { sync: update.sync });
        await this.sendNotification(
          name,
          targetNamespace,
          update,
          changes,
          prevValuesObject,
          prevTargetRevision,
          lastMessageTs,
        );
      }
    } else {
      await this.sendNotification(
        name,
        targetNamespace,
        update,
        changes,
        prevValuesObject,
        prevTargetRevision,
        lastMessageTs,
      );
    }
  }

  private async handleHealthStatusChange(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changes: ChangesObject,
    cachedResource: CacheEntry,
    lastMessageTs: string | undefined,
  ): Promise<void> {
    const { valuesObject: prevValuesObject, targetRevision: prevTargetRevision } = cachedResource;
    if (this.isDeploySettled(update, cachedResource)) {
      // Full cache update
      this.updateCache(name, { ...update, lastMessageTs: undefined });
    } else {
      this.updateCache(name, { status: update.status });
    }
    await this.sendNotification(
      name,
      targetNamespace,
      update,
      changes,
      prevValuesObject,
      prevTargetRevision,
      lastMessageTs,
    );
  }

  private async sendNotification(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changes: ChangesObject,
    prevValuesObject: ValuesObject,
    prevTargetRevision: string,
    lastMessageTs?: string,
  ): Promise<void> {
    logger.debug('=========================================================');
    logger.debug('===================== UPDATE ============================');
    logger.dir({ currentStatus: update.status, currentSync: update.sync });
    logger.debug(JSON.stringify({ valuesObject: update.valuesObject, targetRevision: update.targetRevision }));
    logger.debug('====================== CACHED ===========================');
    // logger.dir({ prevStatus: cachedResource.status, prevSync: cachedResource.sync });
    logger.debug(JSON.stringify({ valuesObject: prevValuesObject, targetRevision: prevTargetRevision }));
    logger.debug('=========================================================');
    logger.debug('=========================================================');

    if (lastMessageTs) {
      await this.updateSlackMessage(
        name,
        targetNamespace,
        update,
        changes,
        prevValuesObject,
        prevTargetRevision,
        lastMessageTs,
      );
    } else {
      await this.createSlackMessage(name, targetNamespace, update, changes, prevValuesObject, prevTargetRevision);
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
    prevValuesObject: ValuesObject,
    prevTargetRevision: string,
  ): Promise<void> {
    try {
      const blocks = this.createNotificationBlocks(
        name,
        targetNamespace,
        update,
        changes,
        prevValuesObject,
        prevTargetRevision,
      );
      const altText = this.createAltText(name, targetNamespace, update, changes, prevValuesObject, prevTargetRevision);

      const res = (await this.slackClient?.chat.postMessage({
        icon_url: 'https://argo-cd.readthedocs.io/en/stable/assets/logo.png',
        text: altText,
        blocks,
        channel: slack_config.CHANNEL_ID,
      })) || { ts: new Date().toISOString() };

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
    prevValuesObject: ValuesObject,
    prevTargetRevision: string,
    lastMessageTs: string,
  ): Promise<void> {
    try {
      const blocks = this.createNotificationBlocks(
        name,
        targetNamespace,
        update,
        changes,
        prevValuesObject,
        prevTargetRevision,
      );
      const altText = this.createAltText(name, targetNamespace, update, changes, prevValuesObject, prevTargetRevision);

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

  private createNotificationBlocks(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changes: ChangesObject,
    prevValuesObject: ValuesObject,
    prevTargetRevision: string,
  ): KnownBlock[] {
    const blocks: KnownBlock[] = [
      this.createHeaderBlock(name),
      ...this.createInfoBlock(name, targetNamespace, prevValuesObject, changes, prevTargetRevision),
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
    prevValuesObject: ValuesObject,
    prevTargetRevision: string,
  ): KnownBlock[] {
    const prevVersion = prevValuesObject.image?.tag || prevTargetRevision;
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
          text: `*Health Status:* ${this.getStatusEmoji(status)} ${status || '?'}`,
        },
        {
          type: 'mrkdwn',
          text: `*Sync Status:* ${this.getStatusEmoji(sync)} ${sync || '?'}`,
        },
      ],
    };
  }

  private createChangesBlock(changes: Partial<ValuesObject>): KnownBlock {
    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Changes:*\n\`\`\`yaml\n${JSON.stringify(changes, null, 2)}\n\`\`\``,
      },
    };
  }

  private createAltText(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changes: ChangesObject,
    prevValuesObject: ValuesObject,
    prevTargetRevision: string,
  ): string {
    const prevVersion = prevValuesObject.image?.tag || prevTargetRevision;
    const currentVersion = changes.image?.tag || changes.targetRevision || prevVersion;
    return [
      `*Application Updated*`,
      `*Application:* ${name}${process.env.NODE_ENV === 'production' ? '' : ' (TEST)'}`,
      `*Namespace:* \`${targetNamespace || 'Cluster Scoped'}\``,
      `*Version:* ${this.createChangeDescription(prevVersion, currentVersion, '', '`')}`,
      `*Health Status:* ${update.status || '?'}`,
      `*Sync Status:* ${update.sync || '?'}`,
    ].join('\n');
  }

  private getStatusEmoji(status?: ArgoCdHealthStatus | ArgoCdSyncStatus): string {
    const emojiMap: Record<string, string> = {
      [ArgoCdHealthStatus.Degraded]: ':x:',
      [ArgoCdHealthStatus.Missing]: ':x:',
      [ArgoCdSyncStatus.OutOfSync]: ':warning:',
      [ArgoCdHealthStatus.Healthy]: ':white_check_mark:',
      [ArgoCdHealthStatus.Progressing]: ':hourglass_flowing_sand:',
      [ArgoCdHealthStatus.Suspended]: ':hourglass_flowing_sand:',
      [ArgoCdSyncStatus.Synced]: ':white_check_mark:',
    };

    return emojiMap[status || ''] || '';
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
      return `${emoji} ${markDownTag}${prev || '?'}${markDownTag} → ` + currentFormattedVersion;
    }
    return currentFormattedVersion;
  }
}
