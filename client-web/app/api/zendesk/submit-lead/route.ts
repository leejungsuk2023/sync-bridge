import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { translateLeadToKorean, formatCSMessage } from '@/lib/lead-extraction';

export const maxDuration = 60;

// CORS: Desktop App (Electron) and Extension cross-origin requests
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
  if (!profile || !['bbg_admin', 'worker', 'client'].includes(profile.role)) return null;
  return { role: profile.role, userId: user.id };
}

export async function POST(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  const body = await req.json().catch(() => ({}));
  const { lead_id } = body;

  if (!lead_id) {
    return withCors(NextResponse.json({ error: 'lead_id required' }, { status: 400 }));
  }

  try {
    // 1. Get lead data
    const { data: lead, error: leadErr } = await supabaseAdmin
      .from('sales_leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) {
      return withCors(NextResponse.json({ error: 'Lead not found' }, { status: 404 }));
    }

    if (lead.status === 'cs_requested') {
      return withCors(NextResponse.json({ error: 'Lead already submitted to CS' }, { status: 400 }));
    }

    console.log(`[SubmitLead] Submitting lead ${lead_id} for ticket #${lead.ticket_id}`);

    // 2. Translate Thai fields to Korean via Gemini
    const translations = await translateLeadToKorean(lead);
    console.log('[SubmitLead] Translation completed');

    // 3. Get worker profile (name + client_id)
    const { data: workerProfile } = await supabaseAdmin
      .from('profiles')
      .select('display_name, client_id')
      .eq('id', authUser.userId)
      .single();

    if (!workerProfile?.client_id) {
      return withCors(NextResponse.json({ error: 'Worker has no client_id assigned' }, { status: 400 }));
    }

    const workerName = workerProfile.display_name || 'Worker';

    // 4. Format structured Korean message
    const csMessage = formatCSMessage(lead, translations, lead.ticket_id, workerName);

    // 5. Find CS chat room task_id
    const { data: csRoom } = await supabaseAdmin
      .from('tasks')
      .select('id')
      .eq('content', '__CHAT_CS__')
      .eq('client_id', workerProfile.client_id)
      .limit(1)
      .single();

    if (!csRoom) {
      console.error('[SubmitLead] CS chat room not found for client_id:', workerProfile.client_id);
      return withCors(NextResponse.json({ error: 'CS chat room not found' }, { status: 404 }));
    }

    // 6. Insert message into CS chat room
    const { data: inserted, error: msgErr } = await supabaseAdmin
      .from('messages')
      .insert({
        task_id: csRoom.id,
        sender_id: authUser.userId,
        content: csMessage,
        content_ko: csMessage,
        sender_lang: 'ko',
      })
      .select('id')
      .single();

    if (msgErr || !inserted) {
      console.error('[SubmitLead] Error inserting message:', msgErr);
      throw new Error('Failed to post message to CS room');
    }

    console.log(`[SubmitLead] Message posted to CS room (message_id: ${inserted.id})`);

    // 7. Update sales_leads status + translations
    const now = new Date().toISOString();
    const leadUpdate: Record<string, any> = {
      status: 'cs_requested',
      cs_requested_at: now,
      cs_message_id: inserted.id,
      updated_at: now,
    };

    // Save Korean translations to the lead
    if (translations.customer_name_ko) leadUpdate.customer_name_ko = translations.customer_name_ko;
    if (translations.procedures_ko) leadUpdate.procedures_ko = translations.procedures_ko;
    if (translations.body_parts_ko) leadUpdate.body_parts_ko = translations.body_parts_ko;
    if (translations.medical_history_ko) leadUpdate.medical_history_ko = translations.medical_history_ko;
    if (translations.allergies_ko) leadUpdate.allergies_ko = translations.allergies_ko;
    if (translations.current_medications_ko) leadUpdate.current_medications_ko = translations.current_medications_ko;
    if (translations.preferred_date_ko) leadUpdate.preferred_date_ko = translations.preferred_date_ko;
    if (translations.special_notes_ko) leadUpdate.special_notes_ko = translations.special_notes_ko;

    const { error: statusErr } = await supabaseAdmin
      .from('sales_leads')
      .update(leadUpdate)
      .eq('id', lead_id);

    if (statusErr) {
      console.error('[SubmitLead] Error updating lead status:', statusErr);
      // Don't fail — message was already sent
    }

    // 8. Record timeline event
    await supabaseAdmin.from('sales_lead_timeline').insert({
      lead_id,
      event_type: 'cs_requested',
      event_data: { cs_message_id: inserted.id, cs_room_task_id: csRoom.id },
      status_before: lead.status,
      status_after: 'cs_requested',
      created_by: authUser.userId,
    });

    console.log(`[SubmitLead] Lead ${lead_id} submitted to CS successfully`);

    return withCors(NextResponse.json({
      lead_id,
      status: 'cs_requested',
      cs_message_id: inserted.id,
    }));
  } catch (error: any) {
    console.error('[SubmitLead] Error:', error?.message || error);
    return withCors(NextResponse.json({ error: error?.message || 'Failed to submit lead' }, { status: 500 }));
  }
}
