// File: SlackNotifier.ts

import { argo_config } from '@/config/app.config';
import { ArgoCdHealthStatus, ArgoCdSyncStatus } from '@/enums/argocd.enum';
import type { ResourceUpdate } from '@/interfaces/resource-update.interface';
import { logger } from '@/utils/logger';
import { KnownBlock, RichTextBlockElement, RichTextElement, WebClient } from '@slack/web-api';

export class SlackNotifier {
  constructor(
    private readonly slackClient: WebClient | undefined,
    private readonly channelId: string,
  ) {}

  public async createMessage(
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

  public async updateMessage(
    name: string,
    targetNamespace: string | undefined,
    update: ResourceUpdate,
    changesString: string,
    ts: string,
  ): Promise<{ ts: string | undefined } | undefined> {
    try {
      const blocks = this.createNotificationBlocks(name, targetNamespace, update, changesString);
      const altText = this.createAltText(name, targetNamespace, update, changesString);

      const res = await this.updateExistingSlackMessage(altText, blocks, ts);

      logger.info(`Notification updated in Slack for ${name}`);
      logger.verbose(`${altText}.\nts: ${ts}`);

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
      channel: this.channelId,
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
      channel: this.channelId,
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
}
