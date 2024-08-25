import { slack_config } from '@/config/app.config';
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
      version?: string | undefined;
      lastMessageTs?: string | undefined;
    }
  > = new Map();

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
        `Updated status for ${kind} '${name}': syncStatus: ${prevSync} -> ${currentSync} / status: ${prevStatus} -> ${currentStatus} / version: ${prevVersion} -> ${currentVersion}`,
      );

      this.resourceCacheMap.set(name, {
        ...cachedResource,
        status: currentStatus,
        sync: currentSync,
      });

      logger.info(`Sending notification for ${kind} '${name}'`);

      await this.sendNotification(
        name,
        prevStatus,
        currentStatus,
        prevSync,
        currentSync,
        prevVersion,
        currentVersion,
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
    prevStatus: string | undefined,
    newStatus: string | undefined,
    prevSync: string | undefined,
    newSync: string | undefined,
    prevVersion: string | undefined,
    newVersion: string | undefined,
    lastMessageTs?: string,
  ): Promise<void> {
    try {
      const statusEmoji = this.getStatusEmoji(newStatus);
      const syncEmoji = this.getStatusEmoji(newSync);

      const blocks = [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `Argo CD Application Updated: ${name}`,
            emoji: true,
          },
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
              text: `*Version:* ${prevVersion !== newVersion ? `\n${prevVersion || '?'} → *${newVersion || '?'}*` : `${newVersion || '?'}`}`,
            },
            {
              type: 'mrkdwn',
              text: `*Health Status:* ${prevStatus !== newStatus ? `\n${statusEmoji} ${prevStatus} → *${newStatus}*` : `${statusEmoji} ${newStatus}`}`,
            },
            {
              type: 'mrkdwn',
              text: `*Sync Status:* ${prevSync !== newSync ? `\n${syncEmoji} ${prevSync} → *${newSync}*` : `${syncEmoji} ${newSync}`}`,
            },
          ],
        },
        {
          type: 'divider',
        },
      ];

      const altText = `*Argo CD Application Updated*\n*Application:* ${name}\n*Health Status:* ${prevStatus} -> ${newStatus}\n*Sync Status:* ${prevSync} -> ${newSync}\n*Version:* ${prevVersion} -> ${newVersion}`;

      if (lastMessageTs) {
        await this.slackClient.chat.update({
          text: altText,
          blocks,
          channel: process.env.SLACK_CHANNEL_ID!,
          ts: lastMessageTs,
        });
      } else {
        const res = await this.slackClient.chat.postMessage({
          icon_url: 'https://argo-cd.readthedocs.io/en/stable/assets/logo.png',
          text: altText,
          blocks,
          channel: process.env.SLACK_CHANNEL_ID!,
        });

        this.resourceCacheMap.set(name, { ...this.resourceCacheMap.get(name), lastMessageTs: res.ts });
      }

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

  private shouldIgnoreResource(object: ArgoCdResource): boolean {
    const { spec, metadata } = object;
    logger.debug(`Ignoring ${object.kind} '${metadata.name}' as it is a directory source`);
    return !!spec.source.directory;
  }
}
