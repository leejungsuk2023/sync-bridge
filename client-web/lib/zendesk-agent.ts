// Agent-specific Zendesk client with individual agent token support

import { createClient } from '@supabase/supabase-js';
import { decrypt } from './crypto';

export interface AgentZendeskConfig {
  email: string;
  token: string;
  zendeskUserId: number;
}

export class AgentZendeskClient {
  private subdomain: string;
  private authHeader: string;
  private zendeskUserId: number;

  constructor(config: AgentZendeskConfig) {
    this.subdomain = process.env.ZENDESK_SUBDOMAIN || 'bluebridge-globalhelp';
    this.authHeader =
      'Basic ' + Buffer.from(`${config.email}/token:${config.token}`).toString('base64');
    this.zendeskUserId = config.zendeskUserId;
  }

  // Helper method for API calls (follows existing ZendeskClient.fetchApi pattern)
  async fetchApi(path: string, options?: RequestInit): Promise<any> {
    const url = `https://${this.subdomain}.zendesk.com/api/v2${path}`;
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
      console.error(`[ZendeskAgent] API error: ${res.status} ${res.statusText}`, errorBody);
      throw new Error(`Zendesk API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  // Add comment to ticket (public reply or internal note)
  async addComment(
    ticketId: number,
    body: string,
    isPublic: boolean,
    status?: string
  ): Promise<{ comment_id: number }> {
    const ticketUpdate: Record<string, any> = {
      comment: {
        body,
        public: isPublic,
        author_id: this.zendeskUserId || undefined,
      },
    };
    if (status) {
      ticketUpdate.status = status;
    }

    const data = await this.fetchApi(`/tickets/${ticketId}.json`, {
      method: 'PUT',
      body: JSON.stringify({ ticket: ticketUpdate }),
    });

    // Zendesk returns the updated ticket; get latest comment ID from audit
    const audit = data.audit;
    let commentId = 0;
    if (audit?.events) {
      const commentEvent = audit.events.find((e: any) => e.type === 'Comment');
      if (commentEvent) {
        commentId = commentEvent.id;
      }
    }
    // Fallback: use negative timestamp to prevent unique constraint violations
    if (commentId === 0) {
      commentId = -Date.now();
      console.warn(`[ZendeskAgent] No comment event in audit for ticket #${ticketId}, using synthetic comment_id: ${commentId}`);
    }

    console.log(`[ZendeskAgent] Added comment to ticket #${ticketId} (public: ${isPublic}, comment_id: ${commentId})`);
    return { comment_id: commentId };
  }

  // Update ticket status/tags
  async updateTicket(
    ticketId: number,
    updates: { status?: string; tags?: string[] }
  ): Promise<void> {
    await this.fetchApi(`/tickets/${ticketId}.json`, {
      method: 'PUT',
      body: JSON.stringify({ ticket: updates }),
    });
    console.log(`[ZendeskAgent] Updated ticket #${ticketId}`, updates);
  }

  // Fetch single comment detail
  async fetchComment(ticketId: number, commentId: number): Promise<any> {
    const data = await this.fetchApi(`/tickets/${ticketId}/comments.json`);
    const comments = data.comments || [];
    const comment = comments.find((c: any) => c.id === commentId);
    if (!comment) {
      throw new Error(`Comment ${commentId} not found on ticket ${ticketId}`);
    }
    return comment;
  }

  // Fetch ticket details
  async fetchTicket(ticketId: number): Promise<any> {
    const data = await this.fetchApi(`/tickets/${ticketId}.json`);
    return data.ticket || null;
  }

  // Verify token is valid
  async verifyToken(): Promise<boolean> {
    try {
      const data = await this.fetchApi('/users/me.json');
      console.log(`[ZendeskAgent] Token verified for user: ${data.user?.email}`);
      return true;
    } catch (err) {
      console.error('[ZendeskAgent] Token verification failed:', err);
      return false;
    }
  }

  // Get the Zendesk user ID for this agent
  getZendeskUserId(): number {
    return this.zendeskUserId;
  }
}

// Factory: get agent client from user_id, falls back to admin token
export async function getAgentClient(userId: string): Promise<AgentZendeskClient> {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Try to get agent's personal token from zendesk_agent_tokens
  const { data: agentToken, error } = await supabaseAdmin
    .from('zendesk_agent_tokens')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .single();

  if (agentToken && !error) {
    const decryptedToken = decrypt(agentToken.encrypted_token);
    console.log(`[ZendeskAgent] Using personal token for user ${userId} (zendesk_email: ${agentToken.zendesk_email})`);
    return new AgentZendeskClient({
      email: agentToken.zendesk_email,
      token: decryptedToken,
      zendeskUserId: agentToken.zendesk_user_id,
    });
  }

  // Fallback: use admin token from env
  console.log(`[ZendeskAgent] No personal token for user ${userId}, falling back to admin token`);
  return new AgentZendeskClient({
    email: process.env.ZENDESK_EMAIL || '',
    token: process.env.ZENDESK_API_TOKEN || '',
    zendeskUserId: 0,
  });
}
