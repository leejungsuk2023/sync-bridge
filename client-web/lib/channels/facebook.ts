// Facebook Messenger Platform adapter (raw fetch, no SDK — keeps serverless bundle small)

import crypto from 'crypto';
import { ChannelAdapter, WebhookEvent } from './types';

const FB_API_VERSION = 'v19.0';
const FB_API_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;

export class FacebookAdapter implements ChannelAdapter {
  readonly channelType = 'facebook' as const;

  private readonly pageAccessToken: string;
  private readonly appSecret: string;

  /**
   * @param pageAccessToken - Per-page access token (fetched from DB for multi-page routing)
   */
  constructor(pageAccessToken: string) {
    const appSecret = process.env.FB_APP_SECRET;
    if (!appSecret) {
      throw new Error('FB_APP_SECRET environment variable is not set');
    }
    this.pageAccessToken = pageAccessToken;
    this.appSecret = appSecret;
  }

  private async fetchApi(path: string, options?: RequestInit): Promise<any> {
    const separator = path.includes('?') ? '&' : '?';
    const url = `${FB_API_BASE}${path}${separator}access_token=${this.pageAccessToken}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      console.error(`[Facebook] API error: ${res.status} ${res.statusText}`, errorBody);
      throw new Error(`Facebook API error: ${res.status} ${res.statusText}`);
    }

    return res.json();
  }

  // ── Outbound ─────────────────────────────────────────────────────────────

  async sendTextMessage(recipientId: string, text: string): Promise<{ messageId: string }> {
    const data = await this.fetchApi('/me/messages', {
      method: 'POST',
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
      }),
    });

    const messageId: string = data?.message_id ?? '';
    console.log(`[Facebook] Sent text message to PSID ${recipientId} (message_id: ${messageId})`);
    return { messageId };
  }

  async sendImageMessage(
    recipientId: string,
    imageUrl: string,
    _previewUrl?: string
  ): Promise<{ messageId: string }> {
    const data = await this.fetchApi('/me/messages', {
      method: 'POST',
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: 'image',
            payload: { url: imageUrl, is_reusable: true },
          },
        },
      }),
    });

    const messageId: string = data?.message_id ?? '';
    console.log(`[Facebook] Sent image message to PSID ${recipientId} (message_id: ${messageId})`);
    return { messageId };
  }

  async sendFileMessage(
    recipientId: string,
    fileUrl: string,
    fileName: string
  ): Promise<{ messageId: string }> {
    const data = await this.fetchApi('/me/messages', {
      method: 'POST',
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: 'file',
            payload: { url: fileUrl, is_reusable: true },
          },
        },
      }),
    });

    const messageId: string = data?.message_id ?? '';
    console.log(`[Facebook] Sent file message (${fileName}) to PSID ${recipientId} (message_id: ${messageId})`);
    return { messageId };
  }

  // ── User profile ──────────────────────────────────────────────────────────

  async getUserProfile(
    userId: string
  ): Promise<{ displayName: string; avatarUrl?: string; language?: string }> {
    try {
      const data = await this.fetchApi(
        `/${userId}?fields=first_name,last_name,profile_pic`
      );
      const displayName = [data.first_name, data.last_name].filter(Boolean).join(' ') || userId;
      return {
        displayName,
        avatarUrl: data.profile_pic ?? undefined,
      };
    } catch (err) {
      console.error(`[Facebook] Failed to fetch profile for PSID ${userId}:`, err);
      throw err;
    }
  }

  // ── Webhook ───────────────────────────────────────────────────────────────

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    // Signature format: "sha256=<hex_digest>"
    const expected =
      'sha256=' +
      crypto
        .createHmac('sha256', this.appSecret)
        .update(rawBody, 'utf8')
        .digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      // Buffers of different length throw — means they differ
      return false;
    }
  }

  async parseWebhookEvents(
    body: any,
    headers: Record<string, string>
  ): Promise<WebhookEvent[]> {
    const signature =
      headers['x-hub-signature-256'] ?? headers['X-Hub-Signature-256'] ?? '';

    const rawBody = typeof body === 'string' ? body : JSON.stringify(body);

    if (signature && !this.verifyWebhookSignature(rawBody, signature)) {
      console.error('[Facebook] Webhook signature verification failed');
      throw new Error('Facebook webhook signature mismatch');
    }

    const parsed = typeof body === 'string' ? JSON.parse(body) : body;

    if (parsed?.object !== 'page') {
      console.error('[Facebook] Unexpected webhook object type:', parsed?.object);
      return [];
    }

    const events: WebhookEvent[] = [];

    for (const entry of parsed?.entry ?? []) {
      for (const messaging of entry?.messaging ?? []) {
        const channelUserId: string = messaging?.sender?.id ?? '';
        const timestamp: number = messaging?.timestamp ?? Date.now();
        // recipient.id is the Page ID — important for multi-page routing
        const pageId: string = messaging?.recipient?.id ?? '';
        const fbMessage = messaging?.message;

        if (!fbMessage) {
          // Non-message event (delivery, read, echo, etc.) — skip
          continue;
        }

        // Determine message type
        if (typeof fbMessage.text === 'string' && !fbMessage.attachments) {
          events.push({
            type: 'message',
            timestamp,
            channelUserId,
            message: {
              id: fbMessage.mid ?? '',
              type: 'text',
              text: fbMessage.text,
              metadata: { pageId },
            },
          });
          continue;
        }

        if (fbMessage.sticker_id) {
          events.push({
            type: 'message',
            timestamp,
            channelUserId,
            message: {
              id: fbMessage.mid ?? '',
              type: 'sticker',
              metadata: { stickerId: fbMessage.sticker_id, pageId },
            },
          });
          continue;
        }

        if (Array.isArray(fbMessage.attachments)) {
          for (const attachment of fbMessage.attachments) {
            const payloadUrl: string = attachment?.payload?.url ?? '';
            let msgType: WebhookEvent['message'] extends undefined
              ? never
              : NonNullable<WebhookEvent['message']>['type'] = 'file';

            switch (attachment.type) {
              case 'image':
                msgType = 'image';
                break;
              case 'video':
                msgType = 'video';
                break;
              case 'audio':
                msgType = 'audio';
                break;
              case 'file':
              default:
                msgType = 'file';
            }

            events.push({
              type: 'message',
              timestamp,
              channelUserId,
              message: {
                id: fbMessage.mid ?? '',
                type: msgType,
                mediaUrl: payloadUrl || undefined,
                metadata: {
                  attachmentType: attachment.type,
                  pageId,
                },
              },
            });
          }
          continue;
        }

        // Fallback for unrecognised message shapes
        events.push({
          type: 'message',
          timestamp,
          channelUserId,
          message: {
            id: fbMessage.mid ?? '',
            type: 'text',
            text: '',
            metadata: { raw: fbMessage, pageId },
          },
        });
      }
    }

    return events;
  }
}
