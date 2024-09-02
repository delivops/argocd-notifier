import { argocdResource } from '@/argocd-resource';
import { argo_config, slack_config } from '@/config/app.config';
import { type ArgoCdApplicationDto, type ArgoCdApplicationSpec } from '@/dtos/argocd-application.dto';
import { ArgoCdHealthStatus, ArgoCdSyncStatus } from '@/enums/argocd.enum';
import type { CustomResource } from '@/interfaces/custom-resource.interface';
import { filterChanges } from '@/utils/filter-changes.utils';
import { generateReadableDiff } from '@/utils/generate-readable-diff';
import { logger } from '@/utils/logger';
import { WebClient, type KnownBlock, type RichTextBlockElement, type RichTextElement } from '@slack/web-api';
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

type ResourceUpdate = Pick<CacheEntry, 'status' | 'sync' | 'spec'>;

export class ArgoCdApplicationResourceManager extends BaseResourceManager {
  readonly definition = argocdResource.crdConfig;

  private readonly slackClient: WebClient | undefined = slack_config.TOKEN
    ? new WebClient(slack_config.TOKEN)
    : undefined;
  protected readonly resourceCacheMap: Map<string, CacheEntry> = new Map();

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
    const lastMessageTs = 'mock-timestamp'; // Set the mock timestamp
    this.resourceCacheMap.set(name, {
      ...update,
      lastMessageTs,
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
    const statusChanged = this.hasStatusChanged(cachedResource, update);

    this.logResourceUpdate(name, cachedResource, update, hasChanges);

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

  private hasStatusChanged(cachedResource: CacheEntry, update: ResourceUpdate): boolean {
    return cachedResource.sync !== update.sync || cachedResource.status !== update.status;
  }

  private logResourceUpdate(
    name: string,
    cachedResource: CacheEntry,
    update: ResourceUpdate,
    hasChanges: boolean,
  ): void {
    logger.verbose(
      `Processing update for ${name}: ` +
        `syncStatus: ${cachedResource.sync}->${update.sync}, ` +
        `healthStatus: ${cachedResource.status}->${update.status}, ` +
        `${hasChanges ? 'has changes' : 'NO changes'}, ` +
        `hasMessageTimestamp: ${!!cachedResource.lastMessageTs}, ` +
        `deploymentInProgress: ${cachedResource.deploymentInProgress}`,
    );
  }

  protected async startNewDeployment(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changesString: string,
  ): Promise<void> {
    logger.info(`Starting new deployment for ${name}`);
    const res = await this.createSlackMessage(name, targetNamespace, update, changesString);

    const lastMessageTs = res?.ts || 'mock-timestamp'; // Set the mock timestamp
    this.updateResourceCache(name, update, lastMessageTs, changesString, true);
  }

  protected async updateExistingDeployment(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changesString: string,
  ): Promise<void> {
    logger.info(`Updating existing deployment for ${name}`);
    const cachedResource = this.resourceCacheMap.get(name)!;
    const updatedChanges = this.mergeChanges(cachedResource.persistentChanges, changesString);

    const res = await this.updateSlackMessage(name, targetNamespace, update, updatedChanges);

    const lastMessageTs = res?.ts || 'mock-timestamp-updated'; // Set the mock timestamp
    const deploymentInProgress = this.isDeploymentInProgress(update);
    this.updateResourceCache(name, update, lastMessageTs, updatedChanges, deploymentInProgress);
  }

  private updateResourceCache(
    name: string,
    update: ResourceUpdate,
    lastMessageTs: string | undefined,
    persistentChanges: string,
    deploymentInProgress: boolean,
  ): void {
    this.resourceCacheMap.set(name, {
      ...update,
      lastMessageTs,
      persistentChanges,
      deploymentInProgress,
    });
  }

  private isDeploymentInProgress(update: ResourceUpdate): boolean {
    return update.sync !== ArgoCdSyncStatus.Synced || update.status !== ArgoCdHealthStatus.Healthy;
  }

  private mergeChanges(existingChanges: string, newChanges: string): string {
    if (!existingChanges || !newChanges) {
      return existingChanges || newChanges;
    }

    const timeStamp = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    return `${existingChanges}\n\n--- New changes (${timeStamp}) ---\n${newChanges}`;
  }

  private async createSlackMessage(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changesString: string,
  ): Promise<{ ts: string | undefined } | undefined> {
    try {
      const blocks = this.createNotificationBlocks(name, targetNamespace, update, changesString);
      const altText = this.createAltText(name, targetNamespace, update, changesString);

      const res = await this.sendSlackMessage(altText, blocks);

      logger.info(`New notification sent to Slack for ${name}`);
      logger.verbose(`${altText}`);

      return { ts: res?.ts };
    } catch (error) {
      logger.error(`Failed to send Slack notification:`, error);
    }
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

      const res = await this.updateExistingSlackMessage(altText, blocks, cachedResource.lastMessageTs!);

      logger.info(`Notification updated in Slack for ${name}`);
      logger.verbose(`${altText}.\ncachedResource.lastMessageTs: ${cachedResource.lastMessageTs}`);

      return { ts: res?.ts };
    } catch (error) {
      logger.error(`Failed to update Slack notification:`, error);
    }
  }

  private async sendSlackMessage(text: string, blocks: KnownBlock[]): Promise<{ ts?: string } | undefined> {
    if (!this.slackClient) {
      logger.verbose(`"blocks": ${JSON.stringify(blocks)}`);
      return;
    }

    return this.slackClient.chat.postMessage({
      icon_url: 'https://argo-cd.readthedocs.io/en/stable/assets/logo.png',
      text,
      unfurl_links: false,
      blocks,
      channel: slack_config.CHANNEL_ID,
    });
  }

  private async updateExistingSlackMessage(
    text: string,
    blocks: KnownBlock[],
    ts: string,
  ): Promise<{ ts?: string } | undefined> {
    if (!this.slackClient) {
      logger.verbose(`"blocks": ${JSON.stringify(blocks)}`);
      return;
    }

    return this.slackClient.chat.update({
      text,
      blocks,
      channel: slack_config.CHANNEL_ID,
      ts,
    });
  }

  private createNotificationBlocks(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changesString: string,
  ): KnownBlock[] {
    const blocks: KnownBlock[] = [
      {
        type: 'rich_text',
        elements: [
          this.createInfoBlock(name, targetNamespace, update),
          ...(changesString ? [this.createChangesBlock(changesString)] : []),
        ],
      },
    ];

    return blocks;
  }

  private createInfoBlock(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
  ): RichTextBlockElement {
    const { status, sync } = update;
    const environmentIndicator = process.env.NODE_ENV === 'production' ? '' : '(DEV)';
    const isLink = !!argo_config.url;

    const delimiter: RichTextElement = { type: 'text', text: ' ' };

    const elements: RichTextElement[] = [
      { type: 'emoji', name: this.getStatusEmoji(status, false) },
      delimiter,
      { type: 'emoji', name: this.getStatusEmoji(sync, false) },
      delimiter,
    ];

    if (environmentIndicator) {
      elements.push({ type: 'text', text: environmentIndicator }, delimiter);
    }

    if (isLink) {
      elements.push({
        type: 'link',
        text: targetNamespace ? `${name} / ${targetNamespace}` : name,
        url: argo_config.url!,
        style: { bold: true },
      });
      if (!targetNamespace) {
        elements.push({
          type: 'text',
          text: ' / Clustered Resource',
        });
      }
    } else {
      elements.push({
        type: 'text',
        text: `${name} / ${targetNamespace || 'Clustered Resource'}`,
        style: { bold: true },
      });
    }

    if (isLink && !targetNamespace) {
      elements.push({
        type: 'text',
        text: ' / Clustered Resource',
      });
    }

    return {
      type: 'rich_text_section',
      elements,
    };
  }

  private createChangesBlock(changesString: string): RichTextBlockElement {
    return {
      type: 'rich_text_preformatted',
      elements: [
        {
          type: 'text',
          text: changesString || 'No changes',
        },
      ],
    };
  }

  private createAltText(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changesString: string,
  ): string {
    const environmentIndicator = process.env.NODE_ENV === 'production' ? '' : ' (DEV)';
    const textComponents = [
      `Application Updated: ${name}${environmentIndicator} / ${targetNamespace || 'Cluster Scoped'}`,
      `Status: health ${update.status} / sync ${update.sync}`,
    ];

    if (changesString) {
      textComponents.push(`*Changes:* ${changesString}`);
    }

    return textComponents.join('\n').slice(0, 4000);
  }

  private getStatusEmoji(status: ArgoCdHealthStatus | ArgoCdSyncStatus, withSemicolon: boolean = true): string {
    const emojiMap: Record<string, string> = {
      [ArgoCdHealthStatus.Degraded]: 'x',
      [ArgoCdHealthStatus.Missing]: 'x',
      [ArgoCdSyncStatus.OutOfSync]: 'warning',
      [ArgoCdHealthStatus.Healthy]: 'white_check_mark',
      [ArgoCdHealthStatus.Progressing]: 'hourglass_flowing_sand',
      [ArgoCdHealthStatus.Suspended]: 'double_vertical_bar',
      [ArgoCdSyncStatus.Synced]: 'white_check_mark',
    };

    const emoji = emojiMap[status] || 'question';
    return withSemicolon ? `:${emoji}:` : emoji;
  }

  private isDirectorySource(resource: ArgoCdResource): boolean {
    return !!resource.spec.source.directory;
  }

  private generateChangesString(cache: CacheEntry, update: ResourceUpdate): string {
    const reorganizeSpec = (spec: ArgoCdApplicationSpec) => {
      const { syncPolicy: _, source, ...restSpec } = spec;
      const { repoURL, targetRevision, chart, helm, ...restSource } = source;

      return {
        source: {
          repoURL,
          targetRevision,
          chart,
          helm,
          ...restSource,
        },
        ...restSpec,
      };
    };

    const cacheObject = reorganizeSpec(cache.spec);
    const updateObject = reorganizeSpec(update.spec);

    const isOnlyVersionUpdate = this.isOnlyImageTagOrTagRevisionChange(cacheObject, updateObject);

    const diffString = generateReadableDiff(cacheObject, updateObject, {
      contextLines: isOnlyVersionUpdate ? 0 : 2,
      separator: isOnlyVersionUpdate ? '' : '...'.repeat(3),
    });

    return diffString.trim();
  }

  private isOnlyImageTagOrTagRevisionChange(
    cacheSpec: CacheEntry['spec'],
    updateSpec: ResourceUpdate['spec'],
  ): boolean {
    const changesObject = filterChanges(updateSpec, cacheSpec);
    const changedPaths = Object.keys(changesObject);

    if (changedPaths.length !== 1) return false;

    const changedPath = changedPaths[0];

    if (changedPath === 'source') {
      const { targetRevision, helm } = (changesObject.source as Record<string, unknown>) || {};

      if (targetRevision) return true;

      if (helm) {
        const { valuesObject } = helm as Record<string, { image?: object }>;
        const imageObject = valuesObject?.image || {};
        return 'tag' in imageObject;
      }
    }

    return false;
  }
}
