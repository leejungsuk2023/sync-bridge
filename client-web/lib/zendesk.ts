// Zendesk REST API client for ticket sync

export interface ZendeskTicket {
  id: number;
  subject: string;
  description: string;
  status: string;
  priority: string | null;
  assignee_id: number | null;
  requester_id: number | null;
  group_id: number | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface ZendeskComment {
  id: number;
  body: string;
  author_id: number;
  created_at: string;
  public: boolean;
}

export interface ZendeskUser {
  id: number;
  name: string;
  email: string;
}

export class ZendeskClient {
  private subdomain: string;
  private authHeader: string;

  constructor() {
    this.subdomain = process.env.ZENDESK_SUBDOMAIN || 'bluebridge-globalhelp';
    const email = process.env.ZENDESK_EMAIL || '';
    const token = process.env.ZENDESK_API_TOKEN || '';
    this.authHeader =
      'Basic ' + Buffer.from(`${email}/token:${token}`).toString('base64');
  }

  private async fetchApi(path: string) {
    const url = `https://${this.subdomain}.zendesk.com/api/v2${path}`;
    const res = await fetch(url, {
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`Zendesk API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  async fetchTickets(since?: string): Promise<ZendeskTicket[]> {
    const tickets: ZendeskTicket[] = [];
    let path = '/tickets.json?sort_by=updated_at&sort_order=desc&per_page=100';
    if (since) {
      path += `&updated_after=${encodeURIComponent(since)}`;
    }

    let nextPage: string | null = path;
    while (nextPage) {
      let data: any;
      if (nextPage.startsWith('http')) {
        const r = await fetch(nextPage, {
          headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' },
        });
        if (!r.ok) throw new Error(`Zendesk API error: ${r.status} ${r.statusText}`);
        data = await r.json();
      } else {
        data = await this.fetchApi(nextPage);
      }

      tickets.push(...(data.tickets || []));
      nextPage = data.next_page || null;
    }

    return tickets;
  }

  // Fetch a single page of tickets (for batch processing)
  async fetchTicketsPage(page: number = 1, perPage: number = 20): Promise<{ tickets: ZendeskTicket[]; next_page: string | null; count: number }> {
    const data = await this.fetchApi(`/tickets.json?sort_by=updated_at&sort_order=desc&per_page=${perPage}&page=${page}`);
    return { tickets: data.tickets || [], next_page: data.next_page || null, count: data.count || 0 };
  }

  async fetchTicketComments(ticketId: number): Promise<ZendeskComment[]> {
    const comments: ZendeskComment[] = [];
    let nextPage: string | null = `/tickets/${ticketId}/comments.json`;

    while (nextPage) {
      let data: any;
      if (nextPage.startsWith('http')) {
        const r = await fetch(nextPage, {
          headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' },
        });
        if (!r.ok) throw new Error(`Zendesk API error: ${r.status} ${r.statusText}`);
        data = await r.json();
      } else {
        data = await this.fetchApi(nextPage);
      }

      comments.push(...(data.comments || []));
      nextPage = data.next_page || null;
    }

    return comments;
  }

  async fetchUser(userId: number): Promise<ZendeskUser | null> {
    try {
      const data = await this.fetchApi(`/users/${userId}.json`);
      return data.user || null;
    } catch {
      return null;
    }
  }

  async fetchUsers(userIds: number[]): Promise<Map<number, ZendeskUser>> {
    const map = new Map<number, ZendeskUser>();
    if (userIds.length === 0) return map;

    const uniqueIds = [...new Set(userIds)];
    // Zendesk allows up to 100 IDs per request
    for (let i = 0; i < uniqueIds.length; i += 100) {
      const batch = uniqueIds.slice(i, i + 100);
      const data = await this.fetchApi(
        `/users/show_many.json?ids=${batch.join(',')}`
      );
      for (const user of data.users || []) {
        map.set(user.id, user);
      }
    }

    return map;
  }
}
