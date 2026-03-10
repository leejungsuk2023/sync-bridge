// Channel registry — factory to get the right adapter by channel type or page ID

import { createClient } from '@supabase/supabase-js';
import { ChannelAdapter } from './types';
import { LineAdapter } from './line';
import { FacebookAdapter } from './facebook';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Get a channel adapter by channel type.
 * LINE uses environment variables; Facebook requires a per-page token fetched from DB.
 *
 * @param channelType - 'line' | 'facebook'
 * @param channelId   - Required for 'facebook'; the messaging_channels row UUID
 */
export async function getChannelAdapter(
  channelType: string,
  channelId?: string
): Promise<ChannelAdapter> {
  if (channelType === 'line') {
    return new LineAdapter();
  }

  if (channelType === 'facebook') {
    if (!channelId) throw new Error('channelId required for Facebook adapter');

    const { data: channel, error } = await supabaseAdmin
      .from('messaging_channels')
      .select('config')
      .eq('id', channelId)
      .single();

    if (error) {
      console.error(`[Facebook] Failed to fetch channel config for ${channelId}:`, error);
      throw new Error(`Failed to fetch channel config: ${error.message}`);
    }

    if (!channel?.config?.page_access_token) {
      throw new Error(`No page_access_token configured for channel ${channelId}`);
    }

    return new FacebookAdapter(channel.config.page_access_token);
  }

  throw new Error(`Unknown channel type: ${channelType}`);
}

/**
 * Get a Facebook adapter by Facebook Page ID.
 * Used during webhook processing when only the page_id is known from the incoming event.
 *
 * @param pageId - Facebook Page ID (from messaging?.recipient?.id in the webhook payload)
 */
export async function getFacebookAdapterByPageId(
  pageId: string
): Promise<{ adapter: FacebookAdapter; channelId: string; hospitalPrefix: string | null }> {
  const { data: channel, error } = await supabaseAdmin
    .from('messaging_channels')
    .select('id, config, hospital_prefix')
    .eq('channel_type', 'facebook')
    .filter('config->>page_id', 'eq', pageId)
    .single();

  if (error) {
    console.error(`[Facebook] Failed to look up channel for page ID ${pageId}:`, error);
    throw new Error(`Failed to look up Facebook channel: ${error.message}`);
  }

  if (!channel) {
    throw new Error(`No Facebook channel found for page ID: ${pageId}`);
  }

  if (!channel.config?.page_access_token) {
    throw new Error(`No page_access_token configured for page ID: ${pageId}`);
  }

  return {
    adapter: new FacebookAdapter(channel.config.page_access_token),
    channelId: channel.id,
    hospitalPrefix: channel.hospital_prefix ?? null,
  };
}
