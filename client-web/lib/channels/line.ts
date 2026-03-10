// LINE Messaging API adapter (raw fetch, no SDK — keeps serverless bundle small)

import crypto from 'crypto';
import { ChannelAdapter, WebhookEvent } from './types';

const LINE_API_BASE = 'https://api.line.me/v2/bot';
const LINE_DATA_BASE = 'https://api-data.line.me/v2/bot';

export class LineAdapter implements ChannelAdapter {
  readonly channelType = 'line' as const;

  private readonly accessToken: string;
  private readonly channelSecret: string;

  constructor() {
    const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const channelSecret = process.env.LINE_CHANNEL_SECRET;

    if (!accessToken) {
      throw new Error('LINE_CHANNEL_ACCESS_TOKEN environment variable is not set');
    }
    if (!channelSecret) {
      throw new Error('LINE_CHANNEL_SECRET environment variable is not set');
    }

    this.accessToken = accessToken;
    this.channelSecret = channelSecret;
  }

  private get authHeader(): string {
    return `Bearer ${this.accessToken}`;
  }

  private async fetchApi(path: string, options?: RequestInit): Promise<any> {
    const url = `${LINE_API_BASE}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      console.error(`[LINE] API error: ${res.status} ${res.statusText}`, errorBody);
      throw new Error(`LINE API error: ${res.status} ${res.statusText}`);
    }

    // Some LINE endpoints return 200 with empty body (e.g. push message)
    const text = await res.text();
    if (!text) return {};
    return JSON.parse(text);
  }

  // ── Outbound ─────────────────────────────────────────────────────────────

  async sendTextMessage(recipientId: string, text: string): Promise<{ messageId: string }> {
    const data = await this.fetchApi('/message/push', {
      method: 'POST',
      body: JSON.stringify({
        to: recipientId,
        messages: [{ type: 'text', text }],
      }),
    });

    // LINE push endpoint returns {} on success; no message ID is provided
    const messageId: string = data?.sentMessages?.[0]?.id ?? '';
    console.log(`[LINE] Sent text message to ${recipientId}`);
    return { messageId };
  }

  async sendImageMessage(
    recipientId: string,
    imageUrl: string,
    previewUrl?: string
  ): Promise<{ messageId: string }> {
    const data = await this.fetchApi('/message/push', {
      method: 'POST',
      body: JSON.stringify({
        to: recipientId,
        messages: [
          {
            type: 'image',
            originalContentUrl: imageUrl,
            previewImageUrl: previewUrl ?? imageUrl,
          },
        ],
      }),
    });

    const messageId: string = data?.sentMessages?.[0]?.id ?? '';
    console.log(`[LINE] Sent image message to ${recipientId}`);
    return { messageId };
  }

  // LINE Messaging API does not support native file messages; send as text link instead
  async sendFileMessage(
    recipientId: string,
    fileUrl: string,
    fileName: string
  ): Promise<{ messageId: string }> {
    console.log(`[LINE] sendFileMessage — file attachments not supported natively, sending as text link (${fileName})`);
    return this.sendTextMessage(recipientId, `${fileName}\n${fileUrl}`);
  }

  // ── User profile ──────────────────────────────────────────────────────────

  async getUserProfile(
    userId: string
  ): Promise<{ displayName: string; avatarUrl?: string; language?: string }> {
    try {
      const data = await this.fetchApi(`/profile/${userId}`);
      return {
        displayName: data.displayName ?? userId,
        avatarUrl: data.pictureUrl ?? undefined,
        language: data.language ?? undefined,
      };
    } catch (err) {
      console.error(`[LINE] Failed to fetch profile for user ${userId}:`, err);
      throw err;
    }
  }

  // ── Webhook ───────────────────────────────────────────────────────────────

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const expected = crypto
      .createHmac('sha256', this.channelSecret)
      .update(rawBody, 'utf8')
      .digest('base64');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  async parseWebhookEvents(
    body: any,
    headers: Record<string, string>
  ): Promise<WebhookEvent[]> {
    // Signature is already verified in the webhook route handler — skip here
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    const lineEvents: any[] = parsed?.events ?? [];

    return lineEvents.map((ev): WebhookEvent => {
      const base = {
        timestamp: ev.timestamp ?? Date.now(),
        channelUserId: ev.source?.userId ?? ev.source?.groupId ?? ev.source?.roomId ?? '',
        replyToken: ev.replyToken,
      };

      if (ev.type === 'follow') {
        return { ...base, type: 'follow' };
      }

      if (ev.type === 'unfollow') {
        return { ...base, type: 'unfollow' };
      }

      if (ev.type === 'postback') {
        return { ...base, type: 'postback' };
      }

      // message event
      const lineMsg = ev.message ?? {};
      const msgId: string = lineMsg.id ?? '';

      switch (lineMsg.type) {
        case 'text':
          return {
            ...base,
            type: 'message',
            message: { id: msgId, type: 'text', text: lineMsg.text ?? '' },
          };

        case 'sticker':
          return {
            ...base,
            type: 'message',
            message: {
              id: msgId,
              type: 'sticker',
              metadata: {
                packageId: lineMsg.packageId,
                stickerId: lineMsg.stickerId,
              },
            },
          };

        case 'image':
        case 'video':
        case 'audio': {
          // LINE content URLs require auth headers; store a proxied URL so the
          // browser can load the media without needing Authorization headers.
          const mediaUrl = `/api/channels/line/media?messageId=${msgId}`;
          return {
            ...base,
            type: 'message',
            message: { id: msgId, type: lineMsg.type, mediaUrl },
          };
        }

        case 'file':
          return {
            ...base,
            type: 'message',
            message: {
              id: msgId,
              type: 'file',
              // Same proxy pattern for file downloads
              mediaUrl: `/api/channels/line/media?messageId=${msgId}`,
              metadata: { fileName: lineMsg.fileName, fileSize: lineMsg.fileSize },
            },
          };

        case 'location':
          return {
            ...base,
            type: 'message',
            message: {
              id: msgId,
              type: 'location',
              text: lineMsg.address ?? lineMsg.title ?? '',
              metadata: {
                title: lineMsg.title,
                address: lineMsg.address,
                latitude: lineMsg.latitude,
                longitude: lineMsg.longitude,
              },
            },
          };

        default:
          // Unknown message type — surface as text with raw metadata
          return {
            ...base,
            type: 'message',
            message: { id: msgId, type: 'text', text: '', metadata: { raw: lineMsg } },
          };
      }
    });
  }
}
