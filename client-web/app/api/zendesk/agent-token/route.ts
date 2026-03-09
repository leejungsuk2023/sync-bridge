import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { encrypt } from '@/lib/crypto';
import { AgentZendeskClient } from '@/lib/zendesk-agent';

export const maxDuration = 30;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function withCors(response: NextResponse) {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyUser(req: NextRequest): Promise<{ role: string; userId: string } | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!profile || (profile.role !== 'bbg_admin' && profile.role !== 'worker')) return null;
  return { role: profile.role, userId: user.id };
}

// GET: Return current user's Zendesk connection info (no token returned)
export async function GET(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  try {
    const { data: agentToken, error } = await supabaseAdmin
      .from('zendesk_agent_tokens')
      .select('zendesk_email, zendesk_user_id, is_active, verified_at, created_at, updated_at')
      .eq('user_id', authUser.userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('[AgentToken] Error fetching token info:', error);
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    if (!agentToken) {
      return withCors(NextResponse.json({ connected: false }));
    }

    console.log(`[AgentToken] GET token info for user ${authUser.userId}`);

    return withCors(NextResponse.json({
      connected: true,
      zendesk_email: agentToken.zendesk_email,
      zendesk_user_id: agentToken.zendesk_user_id,
      is_active: agentToken.is_active,
      verified_at: agentToken.verified_at,
    }));
  } catch (err: any) {
    console.error('[AgentToken] GET error:', err);
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}

// PUT: Register or update Zendesk token
export async function PUT(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  try {
    const body = await req.json();
    const { zendesk_email, api_token, polite_particle } = body;

    if (!zendesk_email || typeof zendesk_email !== 'string') {
      return withCors(NextResponse.json({ error: 'zendesk_email is required' }, { status: 400 }));
    }
    if (!api_token || typeof api_token !== 'string') {
      return withCors(NextResponse.json({ error: 'api_token is required' }, { status: 400 }));
    }

    // Verify the credentials by calling Zendesk API
    console.log(`[AgentToken] Verifying Zendesk credentials for ${zendesk_email}`);
    const tempClient = new AgentZendeskClient({
      email: zendesk_email,
      token: api_token,
      zendeskUserId: 0,
    });

    let zendeskUser: any;
    try {
      const data = await tempClient.fetchApi('/users/me.json');
      zendeskUser = data.user;
    } catch (verifyErr: any) {
      console.error('[AgentToken] Zendesk verification failed:', verifyErr);
      return withCors(NextResponse.json({
        error: 'Invalid Zendesk credentials. Please check your email and API token.',
      }, { status: 401 }));
    }

    if (!zendeskUser || !zendeskUser.id) {
      return withCors(NextResponse.json({ error: 'Could not verify Zendesk user' }, { status: 401 }));
    }

    // Encrypt the API token
    const encryptedToken = encrypt(api_token);

    // UPSERT into zendesk_agent_tokens
    const { error: upsertError } = await supabaseAdmin
      .from('zendesk_agent_tokens')
      .upsert({
        user_id: authUser.userId,
        zendesk_email: zendesk_email.trim(),
        zendesk_user_id: zendeskUser.id,
        encrypted_token: encryptedToken,
        is_active: true,
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (upsertError) {
      console.error('[AgentToken] Error upserting token:', upsertError);
      return withCors(NextResponse.json({ error: upsertError.message }, { status: 500 }));
    }

    // Update profile: zendesk_connected + optional polite_particle
    const profileUpdate: Record<string, any> = {
      zendesk_connected: true,
    };
    if (polite_particle !== undefined) {
      profileUpdate.polite_particle = polite_particle;
    }

    await supabaseAdmin
      .from('profiles')
      .update(profileUpdate)
      .eq('id', authUser.userId);

    console.log(`[AgentToken] Token registered for user ${authUser.userId}, zendesk_user_id: ${zendeskUser.id}`);

    return withCors(NextResponse.json({
      ok: true,
      zendesk_user_id: zendeskUser.id,
      name: zendeskUser.name,
    }));
  } catch (err: any) {
    console.error('[AgentToken] PUT error:', err);
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}

// DELETE: Remove Zendesk token
export async function DELETE(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  try {
    // Delete from zendesk_agent_tokens
    const { error: deleteError } = await supabaseAdmin
      .from('zendesk_agent_tokens')
      .delete()
      .eq('user_id', authUser.userId);

    if (deleteError) {
      console.error('[AgentToken] Error deleting token:', deleteError);
      return withCors(NextResponse.json({ error: deleteError.message }, { status: 500 }));
    }

    // Update profile
    await supabaseAdmin
      .from('profiles')
      .update({ zendesk_connected: false })
      .eq('id', authUser.userId);

    console.log(`[AgentToken] Token removed for user ${authUser.userId}`);

    return withCors(NextResponse.json({ ok: true }));
  } catch (err: any) {
    console.error('[AgentToken] DELETE error:', err);
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}
