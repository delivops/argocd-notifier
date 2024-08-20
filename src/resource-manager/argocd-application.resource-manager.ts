import { slack_config } from '@/config/slack.config';
import { ArgoCdKind, type ArgoCdApplicationDto } from '@/dtos/argocd-application.dto';
import { ArgoCdHealthStatus, ArgoCdSyncStatus } from '@/enums/argocd.enum';
import type { CustomResource } from '@/interfaces/custom-resource.interface';
import { logger } from '@/logger';
import { findCrdConfigByKind } from '@/operator-resources';
import { WebClient } from '@slack/web-api';
import { BaseResourceManager } from './base.resource-manager';

type ArgoCdResource = CustomResource<ArgoCdApplicationDto>;

export class ArgoCdApplicationResourceManager extends BaseResourceManager {
  definition = findCrdConfigByKind(ArgoCdKind);

  private slackClient: WebClient = new WebClient(slack_config.TOKEN);

  protected resourceCacheMap: Map<
    ArgoCdResource['metadata']['name'],
    {
      status?: Exclude<ArgoCdResource['status'], undefined>['health']['status'];
      sync?: Exclude<ArgoCdResource['status'], undefined>['sync']['status'];
    }
  > = new Map();

  protected async syncResource(object: ArgoCdResource): Promise<void> {
    const { kind, status, metadata } = object;
    const { name } = metadata;

    let hasBeenUpdated = false;

    if (!this.resourceCacheMap.has(name)) {
      logger.debug(`Initializing cache for ${kind} '${name}'`);

      this.resourceCacheMap.set(name, {
        status: status?.health.status,
        sync: status?.sync.status,
      });
    } else {
      const prevStatus = this.resourceCacheMap.get(name)?.status;
      const prevSync = this.resourceCacheMap.get(name)?.sync;

      if (prevStatus !== status?.health.status || prevSync !== status?.sync.status) {
        hasBeenUpdated = true;
      } else {
        logger.debug(`Status for ${kind} '${name}' is already up-to-date`);
      }
    }

    if (hasBeenUpdated) {
      logger.info(`Sending notification for ${kind} '${name}'`);

      const prevStatus = this.resourceCacheMap.get(name)?.status;
      const prevSync = this.resourceCacheMap.get(name)?.sync;

      logger.info(
        `Updated status for ${kind} '${name}': status: ${prevStatus} -> ${status?.health.status} / syncStatus ${prevSync} -> ${status?.sync.status}`,
      );

      this.resourceCacheMap.set(name, {
        ...this.resourceCacheMap.get(name),
        status: status?.health.status,
        sync: status?.sync.status,
      });

      await this.sendNotification(name, prevStatus, status?.health.status, prevSync, status?.sync.status);
    }
  }

  private async sendNotification(
    name: string,
    prevStatus: string | undefined,
    newStatus: string | undefined,
    prevSync: string | undefined,
    newSync: string | undefined,
  ): Promise<void> {
    try {
      const statusEmoji = this.getStatusEmoji(newStatus);
      const syncEmoji = this.getStatusEmoji(newSync);

      const blocks = [
        {
          type: 'context',
          elements: [
            {
              type: 'image',
              image_url: 'https://argo-cd.readthedocs.io/en/stable/assets/logo.png',
              alt_text: 'argocd',
            },
            {
              type: 'mrkdwn',
              text: `*Argo CD Application Updated* (${name})`,
            },
          ],
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Application:* \`${name}\``,
            },
            {
              type: 'mrkdwn',
              text: `*Health Status:* ${prevStatus !== newStatus ? `${statusEmoji} ${prevStatus} → *${newStatus}*` : `${statusEmoji} ${newStatus}`}`,
            },
            {
              type: 'mrkdwn',
              text: `*Sync Status:* ${prevSync !== newSync ? `${syncEmoji} ${prevSync} → *${newSync}*` : `${syncEmoji} ${newSync}`}`,
            },
          ],
        },
      ];

      const altText = `*Argo CD Application Updated*\n*Application:* ${name}\n*Health Status:* ${prevStatus} -> ${newStatus}\n*Sync Status:* ${prevSync} -> ${newSync}`;

      await this.slackClient.chat.postMessage({
        text: altText,
        blocks,
        channel: process.env.SLACK_CHANNEL_ID!,
      });

      logger.info(`Notification sent to Slack for ${name}`);
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
}
