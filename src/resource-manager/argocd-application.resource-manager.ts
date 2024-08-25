import { slack_config } from '@/config/app.config';
import { ArgoCdKind, type ArgoCdApplicationDto } from '@/dtos/argocd-application.dto';
import { ArgoCdHealthStatus, ArgoCdSyncStatus } from '@/enums/argocd.enum';
import type { CustomResource } from '@/interfaces/custom-resource.interface';
import { logger } from '@/logger';
import { findCrdConfigByKind } from '@/operator-resources';
import { WebClient, type KnownBlock } from '@slack/web-api';
import { BaseResourceManager } from './base.resource-manager';

type ArgoCdResource = CustomResource<ArgoCdApplicationDto>;

type CacheEntry = {
  status?: Exclude<ArgoCdResource['status'], undefined>['health']['status'];
  sync?: Exclude<ArgoCdResource['status'], undefined>['sync']['status'];
  version?: string | undefined;
  lastMessageTs?: string | undefined;
};

type UpdatesObject = {
  prevStatus: string | undefined;
  currentStatus: string | undefined;
  prevSync: string | undefined;
  currentSync: string | undefined;
  prevVersion: string | undefined;
  currentVersion: string | undefined;
};

export class ArgoCdApplicationResourceManager extends BaseResourceManager {
  definition = findCrdConfigByKind(ArgoCdKind);

  private slackClient: WebClient = new WebClient(slack_config.TOKEN);

  protected resourceCacheMap: Map<ArgoCdResource['metadata']['name'], CacheEntry> = new Map();

  protected async syncResource(object: ArgoCdResource): Promise<void> {
    const { kind, status, metadata, spec } = object;
    const { name } = metadata;

    if (this.shouldIgnoreResource(object)) {
      return;
    }

    const currentStatus = status?.health.status;
    const currentSync = status?.sync.status;
    const currentVersion = spec.source.helm?.valuesObject?.image?.tag || spec.source.targetRevision;

    const cachedResource = this.resourceCacheMap.get(name);
    const prevStatus = cachedResource?.status;
    const prevSync = cachedResource?.sync;
    const prevVersion = cachedResource?.version;

    const targetNamespace = spec.destination.namespace;

    const isLastHealthUpdated =
      prevSync === currentSync &&
      ((prevStatus === ArgoCdHealthStatus.Progressing && currentStatus !== prevStatus) ||
        currentStatus === ArgoCdHealthStatus.Degraded);

    if (!cachedResource) {
      logger.debug(`Initializing cache for ${kind} '${name}'`);
      this.resourceCacheMap.set(name, {
        status: currentStatus,
        sync: currentSync,
        version: currentVersion,
      });
    } else if (prevSync !== currentSync || isLastHealthUpdated || prevVersion !== currentVersion) {
      logger.info(
        `Updated status for ${kind} '${name}': targetNamespace: ${targetNamespace} / syncStatus: ${prevSync} -> ${currentSync} / status: ${prevStatus} -> ${currentStatus} / version: ${prevVersion} -> ${currentVersion}`,
      );

      this.resourceCacheMap.set(name, {
        ...cachedResource,
        status: currentStatus,
        sync: currentSync,
      });

      logger.info(`Sending notification for ${kind} '${name}'`);

      await this.sendNotification(
        name,
        targetNamespace,
        {
          prevStatus,
          currentStatus,
          prevSync,
          currentSync,
          prevVersion,
          currentVersion,
        },
        cachedResource?.lastMessageTs,
      );

      if (isLastHealthUpdated) {
        this.resourceCacheMap.set(name, {
          ...this.resourceCacheMap.get(name),
          version: currentVersion,
          lastMessageTs: undefined,
        });
      }
    } else {
      logger.debug(`Status for ${kind} '${name}' is already up-to-date`);
    }
  }

  private async sendNotification(
    name: string,
    targetNamespace: string | undefined,
    updatesObject: UpdatesObject,
    lastMessageTs?: string,
  ): Promise<void> {
    try {
      const blocks = this.createNotificationBlocks(name, targetNamespace, updatesObject);

      const altText = this.createAltText(name, targetNamespace, updatesObject);

      if (lastMessageTs) {
        await this.slackClient.chat.update({
          text: altText,
          blocks,
          channel: process.env.SLACK_CHANNEL_ID!,
          ts: lastMessageTs,
        });

        logger.info(`New Notification sent to Slack for ${name}`);
      } else {
        const res = await this.slackClient.chat.postMessage({
          icon_url: 'https://argo-cd.readthedocs.io/en/stable/assets/logo.png',
          text: altText,
          blocks,
          channel: process.env.SLACK_CHANNEL_ID!,
        });

        logger.info(`Notification update sent to Slack for ${name}`);

        this.resourceCacheMap.set(name, { ...this.resourceCacheMap.get(name), lastMessageTs: res.ts });
      }
    } catch (error) {
      logger.error(`Failed to send Slack notification: ${error}`);
    }
  }

  private getStatusEmoji(status?: ArgoCdHealthStatus | ArgoCdSyncStatus | string | undefined): string {
    switch (status) {
      case ArgoCdHealthStatus.Degraded:
      case ArgoCdHealthStatus.Missing:
        return ':x:'; // Red Cross for negative health status
      case ArgoCdSyncStatus.OutOfSync:
        return ':warning:'; // Warning sign for out of sync
      case ArgoCdHealthStatus.Healthy:
        return ':white_check_mark:'; // Green check for healthy
      case ArgoCdHealthStatus.Progressing:
      case ArgoCdHealthStatus.Suspended:
        return ':hourglass_flowing_sand:'; // Hourglass for progressing or suspended
      case ArgoCdSyncStatus.Synced:
        return ':white_check_mark:'; // Green check for synced
      default:
        return '';
    }
  }

  private shouldIgnoreResource(object: ArgoCdResource): boolean {
    const { spec, metadata } = object;
    logger.debug(`Ignoring ${object.kind} '${metadata.name}' as it is a directory source`);
    return !!spec.source.directory;
  }

  private createAltText(name: string, targetNamespace: string | undefined, updateObject: UpdatesObject): string {
    const { prevStatus: _, currentStatus, prevSync: __, currentSync, prevVersion, currentVersion } = updateObject;

    let text = `*Application Updated*`;
    text += `\n*Application:* ${name}` + (process.env.NODE_ENV === 'production' ? '' : ' (TEST)');
    text += `\n*Namespace:* \`${targetNamespace || 'Cluster Scoped'}\``;
    text += `\n*Version:* ${this.formatChange(prevVersion, currentVersion, '', '`')}`;
    text += `\n*Health Status:* ${currentStatus || '?'}`;
    text += `\n*Sync Status:* ${currentSync || '?'}`;

    return text;
  }

  private createNotificationBlocks(name: string, targetNamespace: string | undefined, updateObject: UpdatesObject) {
    const { prevStatus: _, currentStatus, prevSync: __, currentSync, prevVersion, currentVersion } = updateObject;

    const statusEmoji = this.getStatusEmoji(currentStatus);
    const _syncEmoji = this.getStatusEmoji(currentSync);

    const blocks: KnownBlock[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `Application Updated: ${name}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Application:* \`${name}\`` + (process.env.NODE_ENV === 'production' ? '' : ' (TEST)'),
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
          text: `*Version:* ${this.formatChange(prevVersion, currentVersion, '', '`')}`,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Health Status:* ${statusEmoji} ${currentStatus || '?'}`,
          },
          {
            type: 'mrkdwn',
            text: `*Sync Status:* ${statusEmoji} ${currentSync || '?'}`,
          },
        ],
      },
      {
        type: 'divider',
      },
    ];

    return blocks;
  }

  private formatChange(
    prev: string | undefined,
    current: string | undefined,
    emoji: string = '',
    markDownTag: string = '',
  ): string {
    return prev !== current
      ? `\n${emoji} ${markDownTag}${prev || '?'}${markDownTag} → ${markDownTag || '*'}${current || '?'}${markDownTag || '*'}`
      : `${emoji} ${markDownTag}${current || '?'}${markDownTag}`;
  }
}
