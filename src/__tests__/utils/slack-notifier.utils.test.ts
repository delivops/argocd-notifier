import { argo_config } from '@/config/app.config';
import { ArgoCdHealthStatus, ArgoCdSyncStatus } from '@/enums/argocd.enum';
import type { ResourceUpdate } from '@/interfaces/resource-update.interface';
import { SlackNotifier } from '@/utils/slack-notifier.utils';
import { WebClient } from '@slack/web-api';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// Mock dependencies
vi.mock('@/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    verbose: vi.fn(),
  },
}));

vi.mock('@/config/app.config', () => ({
  argo_config: {
    url: 'https://argocd.example.com',
  },
}));

describe('SlackNotifier', () => {
  let slackNotifier: SlackNotifier;
  const mockSlackClient = {
    chat: {
      postMessage: vi.fn(),
      update: vi.fn(),
    },
  } as unknown as WebClient;

  beforeEach(() => {
    vi.clearAllMocks();
    slackNotifier = new SlackNotifier(mockSlackClient, 'test-channel');
  });

  describe('createMessage', () => {
    it('should create a new Slack message with the correct blocks and alt text', async () => {
      const mockResponse = { ts: 'mock-timestamp' };
      (mockSlackClient.chat.postMessage as Mock).mockResolvedValueOnce(mockResponse);

      const result = await slackNotifier.createMessage(
        'test-app',
        'test-namespace',
        {
          status: ArgoCdHealthStatus.Healthy,
          sync: ArgoCdSyncStatus.Synced,
          spec: {} as ResourceUpdate['spec'],
        },
        'test-changes',
      );

      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith({
        icon_url: 'https://argo-cd.readthedocs.io/en/stable/assets/logo.png',
        text: expect.stringContaining('Application Updated: test-app (DEV) / test-namespace'),
        unfurl_links: false,
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'rich_text',
            elements: expect.arrayContaining([
              expect.objectContaining({
                type: 'rich_text_section',
                elements: expect.arrayContaining([
                  expect.objectContaining({ type: 'emoji', name: 'white_check_mark' }),
                  expect.objectContaining({ type: 'emoji', name: 'white_check_mark' }),
                  expect.objectContaining({ type: 'text', text: '(DEV)' }),
                  expect.objectContaining({
                    type: 'link',
                    text: 'test-app / test-namespace',
                    url: argo_config.url,
                    style: { bold: true },
                  }),
                ]),
              }),
              expect.objectContaining({
                type: 'rich_text_preformatted',
                elements: [
                  expect.objectContaining({
                    type: 'text',
                    text: 'test-changes',
                  }),
                ],
              }),
            ]),
          }),
        ]),
        channel: 'test-channel',
      });

      expect(result).toEqual({ ts: 'mock-timestamp' });
    });

    it('should handle errors and return undefined', async () => {
      const errorMessage = 'Failed to send Slack message';
      (mockSlackClient.chat.postMessage as Mock).mockRejectedValueOnce(new Error(errorMessage));

      const result = await slackNotifier.createMessage(
        'test-app',
        'test-namespace',
        {
          status: ArgoCdHealthStatus.Healthy,
          sync: ArgoCdSyncStatus.Synced,
          spec: {} as ResourceUpdate['spec'],
        },
        'test-changes',
      );

      expect(result).toBeUndefined();
    });
  });

  describe('updateMessage', () => {
    it('should update an existing Slack message with the correct blocks and alt text', async () => {
      const mockResponse = { ts: 'mock-timestamp-updated' };
      (mockSlackClient.chat.update as Mock).mockResolvedValueOnce(mockResponse);

      const result = await slackNotifier.updateMessage(
        'test-app',
        'test-namespace',
        {
          status: ArgoCdHealthStatus.Progressing,
          sync: ArgoCdSyncStatus.OutOfSync,
          spec: {} as ResourceUpdate['spec'],
        },
        'test-changes-updated',
        'mock-timestamp',
      );

      expect(mockSlackClient.chat.update).toHaveBeenCalledWith({
        text: expect.stringContaining('Application Updated: test-app (DEV) / test-namespace'),
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'rich_text',
            elements: expect.arrayContaining([
              expect.objectContaining({
                type: 'rich_text_section',
                elements: expect.arrayContaining([
                  expect.objectContaining({ type: 'emoji', name: 'hourglass_flowing_sand' }),
                  expect.objectContaining({ type: 'emoji', name: 'warning' }),
                  expect.objectContaining({ type: 'text', text: '(DEV)' }),
                  expect.objectContaining({
                    type: 'link',
                    text: 'test-app / test-namespace',
                    url: argo_config.url,
                    style: { bold: true },
                  }),
                ]),
              }),
              expect.objectContaining({
                type: 'rich_text_preformatted',
                elements: [
                  expect.objectContaining({
                    type: 'text',
                    text: 'test-changes-updated',
                  }),
                ],
              }),
            ]),
          }),
        ]),
        channel: 'test-channel',
        ts: 'mock-timestamp',
      });

      expect(result).toEqual({ ts: 'mock-timestamp-updated' });
    });

    it('should handle errors and return undefined', async () => {
      const errorMessage = 'Failed to update Slack message';
      (mockSlackClient.chat.update as Mock).mockRejectedValueOnce(new Error(errorMessage));

      const result = await slackNotifier.updateMessage(
        'test-app',
        'test-namespace',
        {
          status: ArgoCdHealthStatus.Progressing,
          sync: ArgoCdSyncStatus.OutOfSync,
          spec: {} as ResourceUpdate['spec'],
        },
        'test-changes-updated',
        'mock-timestamp',
      );

      expect(result).toBeUndefined();
    });
  });

  describe('createNotificationBlocks', () => {
    it('should create notification blocks with info and changes', () => {
      const blocks = slackNotifier['createNotificationBlocks'](
        'test-app',
        'test-namespace',
        {
          status: ArgoCdHealthStatus.Healthy,
          sync: ArgoCdSyncStatus.Synced,
          spec: {} as ResourceUpdate['spec'],
        },
        'test-changes',
      );

      expect(blocks).toEqual([
        {
          type: 'rich_text',
          elements: [
            expect.objectContaining({
              type: 'rich_text_section',
              elements: expect.arrayContaining([
                expect.objectContaining({ type: 'emoji', name: 'white_check_mark' }),
                expect.objectContaining({ type: 'emoji', name: 'white_check_mark' }),
                expect.objectContaining({ type: 'text', text: '(DEV)' }),
                expect.objectContaining({
                  type: 'link',
                  text: 'test-app / test-namespace',
                  url: argo_config.url,
                  style: { bold: true },
                }),
              ]),
            }),
            expect.objectContaining({
              type: 'rich_text_preformatted',
              elements: [
                expect.objectContaining({
                  type: 'text',
                  text: 'test-changes',
                }),
              ],
            }),
          ],
        },
      ]);
    });
  });

  describe('createAltText', () => {
    it('should create alt text for the notification', () => {
      const altText = slackNotifier['createAltText'](
        'test-app',
        'test-namespace',
        {
          status: ArgoCdHealthStatus.Healthy,
          sync: ArgoCdSyncStatus.Synced,
          spec: {} as ResourceUpdate['spec'],
        },
        'test-changes',
      );

      expect(altText).toContain('Application Updated: test-app (DEV) / test-namespace');
      expect(altText).toContain('Status: health Healthy / sync Synced');
      expect(altText).toContain('*Changes:* test-changes');
    });
  });

  describe('getStatusEmoji', () => {
    it('should return the correct emoji for health status', () => {
      expect(slackNotifier['getStatusEmoji'](ArgoCdHealthStatus.Healthy)).toBe(':white_check_mark:');
      expect(slackNotifier['getStatusEmoji'](ArgoCdHealthStatus.Degraded)).toBe(':x:');
    });

    it('should return the correct emoji for sync status', () => {
      expect(slackNotifier['getStatusEmoji'](ArgoCdSyncStatus.Synced)).toBe(':white_check_mark:');
      expect(slackNotifier['getStatusEmoji'](ArgoCdSyncStatus.OutOfSync)).toBe(':warning:');
    });

    it('should return a question mark emoji for unknown status', () => {
      expect(slackNotifier['getStatusEmoji']('unknown' as ArgoCdHealthStatus)).toBe(':question:');
    });
  });
});
