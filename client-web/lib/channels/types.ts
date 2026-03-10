// Channel adapter interface and shared types for LINE and Facebook direct integration

export interface ChannelAdapter {
  readonly channelType: 'line' | 'facebook';

  // Outbound
  sendTextMessage(recipientId: string, text: string): Promise<{ messageId: string }>;
  sendImageMessage(
    recipientId: string,
    imageUrl: string,
    previewUrl?: string
  ): Promise<{ messageId: string }>;
  sendFileMessage(
    recipientId: string,
    fileUrl: string,
    fileName: string
  ): Promise<{ messageId: string }>;

  // User profile
  getUserProfile(
    userId: string
  ): Promise<{ displayName: string; avatarUrl?: string; language?: string }>;

  // Webhook
  parseWebhookEvents(body: any, headers: Record<string, string>): Promise<WebhookEvent[]>;
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
}

export interface WebhookEvent {
  type: 'message' | 'follow' | 'unfollow' | 'postback';
  timestamp: number;
  channelUserId: string;
  replyToken?: string; // LINE only, expires 1 min
  message?: {
    id: string;
    type: 'text' | 'image' | 'sticker' | 'file' | 'video' | 'audio' | 'location';
    text?: string;
    mediaUrl?: string;
    metadata?: Record<string, any>;
  };
}

export interface SendResult {
  messageId: string;
}
