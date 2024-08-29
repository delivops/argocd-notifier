import { slack_config } from '@/config/app.config';
import { ArgoCdKind, type ArgoCdApplicationDto, type ArgoCdApplicationSpec } from '@/dtos/argocd-application.dto';
import { ArgoCdHealthStatus, ArgoCdSyncStatus } from '@/enums/argocd.enum';
import type { CustomResource } from '@/interfaces/custom-resource.interface';
import { logger } from '@/logger';
import { findCrdConfigByKind } from '@/operator-resources';
import { generateReadableDiff } from '@/utils/generate-readable-diff';
import { WebClient, type KnownBlock } from '@slack/web-api';
import { BaseResourceManager } from './base.resource-manager';

type ArgoCdResource = CustomResource<ArgoCdApplicationDto>;

interface CacheEntry {
  status: ArgoCdHealthStatus;
  sync: ArgoCdSyncStatus;
  spec: ArgoCdApplicationSpec;
  lastMessageTs: string | undefined;
  persistentChanges: string;
  deploymentInProgress: boolean;
}

type ResourceUpdate = {
  status: ArgoCdHealthStatus;
  sync: ArgoCdSyncStatus;
  spec: ArgoCdApplicationSpec;
};

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
      spec,
    };

    if (!this.resourceCacheMap.has(name)) {
      await this.initializeCache(name, update);
      return;
    }

    await this.handleResourceUpdate(name, update, spec.destination.namespace);
  }

  private async initializeCache(name: string, update: ResourceUpdate): Promise<void> {
    logger.debug(`Initializing cache for ${this.definition.names.kind} '${name}'`);
    this.resourceCacheMap.set(name, {
      ...update,
      lastMessageTs: undefined,
      persistentChanges: '',
      deploymentInProgress: false,
    });
  }

  private async handleResourceUpdate(
    name: string,
    update: ResourceUpdate,
    targetNamespace: string | undefined,
  ): Promise<void> {
    const cachedResource = this.resourceCacheMap.get(name)!;

    const changesString = this.generateChangesString(cachedResource, update);
    const hasChanges = changesString.length > 0;

    const syncChanged = cachedResource.sync !== update.sync;
    const healthChanged = cachedResource.status !== update.status;

    if (syncChanged || healthChanged || hasChanges) {
      logger.verbose(
        `Processing update for ${name}: ` +
          `syncStatus: ${cachedResource.sync}->${update.sync}, ` +
          `healthStatus: ${cachedResource.status}->${update.status}, ` +
          `${hasChanges ? 'has changes' : 'NO changes'}, ` +
          `hasMessageTimestamp: ${!!cachedResource.lastMessageTs}, ` +
          `deploymentInProgress: ${cachedResource.deploymentInProgress}`,
      );

      if (!cachedResource.deploymentInProgress) {
        // Start of a new deployment
        await this.startNewDeployment(name, targetNamespace, update, changesString);
      } else {
        // Update existing deployment
        await this.updateExistingDeployment(name, targetNamespace, update, changesString);
      }
    } else {
      logger.debug(`No status change for ${this.definition.names.kind} '${name}'`);
    }
  }

  private async startNewDeployment(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changesString: string,
  ): Promise<void> {
    logger.info(`Starting new deployment for ${name}`);
    const res = await this.createSlackMessage(name, targetNamespace, update, changesString);

    const lastMessageTs = res?.ts || new Date().toISOString();
    this.resourceCacheMap.set(name, {
      ...update,
      lastMessageTs,
      persistentChanges: changesString,
      deploymentInProgress: true,
    });
  }

  private async updateExistingDeployment(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changesString: string,
  ): Promise<void> {
    logger.info(`Updating existing deployment for ${name}`);
    const cachedResource = this.resourceCacheMap.get(name)!;
    const updatedChanges = this.mergeChanges(cachedResource.persistentChanges, changesString);

    const res = await this.updateSlackMessage(name, targetNamespace, update, updatedChanges);

    const lastMessageTs = res?.ts || cachedResource.lastMessageTs;
    this.resourceCacheMap.set(name, {
      ...update,
      lastMessageTs,
      persistentChanges: updatedChanges,
      deploymentInProgress: update.sync !== ArgoCdSyncStatus.Synced || update.status !== ArgoCdHealthStatus.Healthy,
    });
  }

  private mergeChanges(existingChanges: string, newChanges: string): string {
    if (!existingChanges) return newChanges;
    if (!newChanges) return existingChanges;
    return `${existingChanges}\n${newChanges}`;
  }

  private async createSlackMessage(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changesString: string,
  ): Promise<{ ts: string | undefined } | undefined> {
    let ts: string | undefined;

    try {
      const blocks = this.createNotificationBlocks(name, targetNamespace, update, changesString);
      const altText = this.createAltText(name, targetNamespace, update, changesString);

      const res = await this.slackClient?.chat.postMessage({
        icon_url: 'https://argo-cd.readthedocs.io/en/stable/assets/logo.png',
        text: altText,
        blocks,
        channel: slack_config.CHANNEL_ID,
      });

      logger.info(`New notification sent to Slack for ${name}`);
      logger.dir({ text: altText }, { depth: 10, level: 'verbose' });

      ts = res?.ts;
    } catch (error) {
      logger.error(`Failed to send Slack notification: ${error}`);
    }

    return { ts };
  }

  private async updateSlackMessage(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changesString: string,
  ): Promise<{ ts: string | undefined } | undefined> {
    try {
      const cachedResource = this.resourceCacheMap.get(name)!;
      const blocks = this.createNotificationBlocks(name, targetNamespace, update, changesString);
      const altText = this.createAltText(name, targetNamespace, update, changesString);

      const res = await this.slackClient?.chat.update({
        text: altText,
        blocks,
        channel: slack_config.CHANNEL_ID,
        ts: cachedResource.lastMessageTs!,
      });

      logger.info(`Notification updated in Slack for ${name}`);
      logger.dir({ text: altText, ts: cachedResource.lastMessageTs }, { depth: 10, level: 'verbose' });

      return { ts: res?.ts };
    } catch (error) {
      logger.error(`Failed to update Slack notification: ${error}`);
    }
  }

  private createNotificationBlocks(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changesString: string,
  ): KnownBlock[] {
    const blocks: KnownBlock[] = [
      this.createHeaderBlock(name),
      ...this.createInfoBlock(name, targetNamespace),
      this.createStatusBlock(update),
    ];

    if (changesString) {
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

  private generateChangesString(cachedResource: CacheEntry, update: ResourceUpdate): string {
    const { syncPolicy: _, ...cachedResourceWithoutSyncPolicy } = cachedResource.spec;
    const { syncPolicy: __, ...updateWithoutSyncPolicy } = update.spec;
    return generateReadableDiff(cachedResourceWithoutSyncPolicy, updateWithoutSyncPolicy, {
      contextLines: 3,
      numberLines: false,
    });
  }
}

// private _createChangeDescription(
//   prev: string | undefined,
//   current: string | undefined,
//   emoji: string = '',
//   markDownTag: string = '',
// ): string {
//   const currentFormattedVersion = `${emoji} ${markDownTag}${current || '?'}${markDownTag}`;
//   if (prev !== current) {
//     return `${emoji} ${markDownTag}${prev || '?'}${markDownTag} → ${currentFormattedVersion}`;
//   }
//   return currentFormattedVersion;
// }
