// LINE Messaging API adapter (raw fetch, no SDK — keeps serverless bundle small)

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { ChannelAdapter, WebhookEvent } from './types';

const LINE_API_BASE = 'https://api.line.me/v2/bot';
const LINE_DATA_BASE = 'https://api-data.line.me/v2/bot';

// Extension lookup based on MIME type
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/mpeg': 'mpeg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
  'application/pdf': 'pdf',
};

/**
 * Downloads a LINE media message from the LINE Content API and uploads it to
 * Supabase Storage (bucket: messaging-attachments), returning a public URL.
 *
 * This avoids the auth-header problem: <img src> cannot send Bearer tokens,
 * and LINE content URLs are not publicly accessible without them.
 *
 * Falls back to the proxy URL on any error so old messages keep working.
 */
async function downloadAndStoreMedia(
  messageId: string,
  accessToken: string
): Promise<string> {
  const proxyFallback = `/api/channels/line/media?messageId=${messageId}`;

  try {
    const lineUrl = `${LINE_DATA_BASE}/message/${messageId}/content`;
    const lineRes = await fetch(lineUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!lineRes.ok) {
      console.warn(
        `[LINE] downloadAndStoreMedia: LINE returned ${lineRes.status} for message ${messageId} — falling back to proxy`
      );
      return proxyFallback;
    }

    const contentType = lineRes.headers.get('content-type') ?? 'application/octet-stream';
    const ext = MIME_TO_EXT[contentType.split(';')[0].trim()] ?? 'bin';
    const storagePath = `line/${messageId}.${ext}`;
    const bucket = 'messaging-attachments';

    const arrayBuffer = await lineRes.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { error: uploadError } = await supabaseAdmin.storage
      .from(bucket)
      .upload(storagePath, uint8Array, {
        contentType,
        upsert: true, // idempotent: same message ID → same path
      });

    if (uploadError) {
      console.warn(
        `[LINE] downloadAndStoreMedia: storage upload failed for ${messageId}:`,
        uploadError.message,
        '— falling back to proxy'
      );
      return proxyFallback;
    }

    const { data: publicUrlData } = supabaseAdmin.storage
      .from(bucket)
      .getPublicUrl(storagePath);

    const publicUrl = publicUrlData?.publicUrl;
    if (!publicUrl) {
      console.warn(
        `[LINE] downloadAndStoreMedia: could not get public URL for ${storagePath} — falling back to proxy`
      );
      return proxyFallback;
    }

    console.log(`[LINE] Stored media for message ${messageId} → ${publicUrl}`);
    return publicUrl;
  } catch (err) {
    console.error(
      `[LINE] downloadAndStoreMedia: unexpected error for message ${messageId}:`,
      err,
      '— falling back to proxy'
    );
    return proxyFallback;
  }
}

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

    // Process events sequentially to avoid hammering LINE's Content API in parallel
    const results: WebhookEvent[] = [];

    for (const ev of lineEvents) {
      const base = {
        timestamp: ev.timestamp ?? Date.now(),
        channelUserId: ev.source?.userId ?? ev.source?.groupId ?? ev.source?.roomId ?? '',
        replyToken: ev.replyToken,
      };

      if (ev.type === 'follow') {
        results.push({ ...base, type: 'follow' });
        continue;
      }

      if (ev.type === 'unfollow') {
        results.push({ ...base, type: 'unfollow' });
        continue;
      }

      if (ev.type === 'postback') {
        results.push({ ...base, type: 'postback' });
        continue;
      }

      // message event
      const lineMsg = ev.message ?? {};
      const msgId: string = lineMsg.id ?? '';

      switch (lineMsg.type) {
        case 'text':
          results.push({
            ...base,
            type: 'message',
            message: { id: msgId, type: 'text', text: lineMsg.text ?? '' },
          });
          break;

        case 'sticker':
          results.push({
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
          });
          break;

        case 'image':
        case 'video':
        case 'audio': {
          // Download the media from LINE and store it in Supabase Storage so
          // the browser can load it directly via a public URL (no auth header
          // needed). Falls back to the proxy URL if download/upload fails.
          const mediaUrl = await downloadAndStoreMedia(msgId, this.accessToken);
          results.push({
            ...base,
            type: 'message',
            message: { id: msgId, type: lineMsg.type, mediaUrl },
          });
          break;
        }

        case 'file': {
          // Same: download and store so LINE can access the file without auth
          const mediaUrl = await downloadAndStoreMedia(msgId, this.accessToken);
          results.push({
            ...base,
            type: 'message',
            message: {
              id: msgId,
              type: 'file',
              mediaUrl,
              metadata: { fileName: lineMsg.fileName, fileSize: lineMsg.fileSize },
            },
          });
          break;
        }

        case 'location':
          results.push({
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
          });
          break;

        default:
          // Unknown message type — surface as text with raw metadata
          results.push({
            ...base,
            type: 'message',
            message: { id: msgId, type: 'text', text: '', metadata: { raw: lineMsg } },
          });
          break;
      }
    }

    return results;
  }
}
