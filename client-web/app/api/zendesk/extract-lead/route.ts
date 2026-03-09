import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  extractLeadInfo,
  extractionToLeadRecord,
  computeMissingRequired,
} from '@/lib/lead-extraction';

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

// POST: Extract lead info from Zendesk conversation using AI
export async function POST(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  const body = await req.json().catch(() => ({}));
  const { ticket_id } = body;

  if (!ticket_id) {
    return withCors(NextResponse.json({ error: 'ticket_id required' }, { status: 400 }));
  }

  try {
    const ticketIdNum = typeof ticket_id === 'number' ? ticket_id : parseInt(ticket_id, 10);
    if (isNaN(ticketIdNum)) {
      return withCors(NextResponse.json({ error: 'ticket_id must be a number' }, { status: 400 }));
    }

    // Check for existing lead for this ticket
    const { data: existingLead } = await supabaseAdmin
      .from('sales_leads')
      .select('*')
      .eq('ticket_id', ticketIdNum)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const isExisting = !!existingLead;

    // Get hospital_tag from zendesk_tickets tags
    let hospitalTag: string | null = null;
    const { data: ticketData } = await supabaseAdmin
      .from('zendesk_tickets')
      .select('tags')
      .eq('ticket_id', ticketIdNum)
      .single();

    if (ticketData?.tags && Array.isArray(ticketData.tags)) {
      // Find first tag that looks like a hospital prefix
      const knownPrefixes = ['thebb', 'delphic', 'will', 'mikclinicthai', 'jyclinicthai'];
      hospitalTag = ticketData.tags.find((t: string) => knownPrefixes.includes(t)) || null;
    }

    console.log(`[ExtractLead] Extracting lead for ticket #${ticketIdNum} (existing: ${isExisting})`);

    // Run AI extraction
    const { extraction, responseTimeMs } = await extractLeadInfo(
      ticketIdNum,
      isExisting ? existingLead.ai_extraction : null,
    );

    console.log(`[ExtractLead] AI extraction completed in ${responseTimeMs}ms for ticket #${ticketIdNum}`);

    // Build lead record from extraction
    const leadRecord = extractionToLeadRecord(extraction, ticketIdNum, authUser.userId, hospitalTag);

    // Upsert into sales_leads
    let leadId: string;
    if (isExisting) {
      // Update existing lead
      const { error: updateErr } = await supabaseAdmin
        .from('sales_leads')
        .update(leadRecord)
        .eq('id', existingLead.id);

      if (updateErr) {
        console.error('[ExtractLead] Error updating lead:', updateErr);
        throw new Error('Failed to update lead');
      }
      leadId = existingLead.id;
    } else {
      // Insert new lead
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('sales_leads')
        .insert({ ...leadRecord, status: 'collecting' })
        .select('id')
        .single();

      if (insertErr || !inserted) {
        console.error('[ExtractLead] Error inserting lead:', insertErr);
        throw new Error('Failed to create lead');
      }
      leadId = inserted.id;
    }

    // Record timeline event
    await supabaseAdmin.from('sales_lead_timeline').insert({
      lead_id: leadId,
      event_type: isExisting ? 'info_updated' : 'created',
      event_data: { response_time_ms: responseTimeMs, model: 'gemini-2.5-flash' },
      status_before: isExisting ? existingLead.status : null,
      status_after: isExisting ? existingLead.status : 'collecting',
      created_by: authUser.userId,
    });

    // Compute missing required fields from the saved lead
    const savedLead = { ...leadRecord, id: leadId };
    const missingRequired = computeMissingRequired(savedLead);

    console.log(`[ExtractLead] Lead ${leadId} ${isExisting ? 'updated' : 'created'} for ticket #${ticketIdNum}, missing: ${missingRequired.join(', ') || 'none'}`);

    return withCors(NextResponse.json({
      lead_id: leadId,
      extraction,
      is_existing: isExisting,
      missing_required: missingRequired,
      suggested_questions: extraction.suggested_questions || [],
    }));
  } catch (error: any) {
    console.error('[ExtractLead] Error:', error?.message || error);
    return withCors(NextResponse.json({ error: error?.message || 'Failed to extract lead info' }, { status: 500 }));
  }
}

// PATCH: Manually update lead info
export async function PATCH(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  const body = await req.json().catch(() => ({}));
  const { lead_id, updates } = body;

  if (!lead_id) {
    return withCors(NextResponse.json({ error: 'lead_id required' }, { status: 400 }));
  }
  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    return withCors(NextResponse.json({ error: 'updates required' }, { status: 400 }));
  }

  try {
    // Get current lead
    const { data: currentLead, error: fetchErr } = await supabaseAdmin
      .from('sales_leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (fetchErr || !currentLead) {
      return withCors(NextResponse.json({ error: 'Lead not found' }, { status: 404 }));
    }

    // Allowlist of updatable fields
    const allowedFields = [
      'customer_name', 'customer_name_ko', 'customer_age', 'customer_gender',
      'customer_phone', 'customer_line', 'customer_instagram', 'customer_sns_other',
      'procedures', 'procedures_ko', 'body_parts', 'body_parts_ko', 'reference_photos',
      'medical_history', 'medical_history_ko', 'allergies', 'allergies_ko',
      'current_medications', 'current_medications_ko', 'medical_confirmed',
      'budget_thb', 'budget_krw', 'preferred_date', 'preferred_date_ko',
      'special_notes', 'special_notes_ko',
    ];

    const sanitizedUpdates: Record<string, any> = {};
    const updatedFields: string[] = [];
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        sanitizedUpdates[key] = value;
        updatedFields.push(key);
      }
    }

    if (updatedFields.length === 0) {
      return withCors(NextResponse.json({ error: 'No valid fields to update' }, { status: 400 }));
    }

    sanitizedUpdates.updated_at = new Date().toISOString();

    const { error: updateErr } = await supabaseAdmin
      .from('sales_leads')
      .update(sanitizedUpdates)
      .eq('id', lead_id);

    if (updateErr) {
      console.error('[ExtractLead] Error updating lead:', updateErr);
      throw new Error('Failed to update lead');
    }

    // Record timeline event
    await supabaseAdmin.from('sales_lead_timeline').insert({
      lead_id,
      event_type: 'info_updated',
      event_data: { updated_fields: updatedFields, source: 'manual' },
      status_before: currentLead.status,
      status_after: currentLead.status,
      created_by: authUser.userId,
    });

    // Compute missing required from updated lead
    const merged = { ...currentLead, ...sanitizedUpdates };
    const missingRequired = computeMissingRequired(merged);

    console.log(`[ExtractLead] Lead ${lead_id} manually updated: ${updatedFields.join(', ')}`);

    return withCors(NextResponse.json({
      lead_id,
      updated_fields: updatedFields,
      missing_required: missingRequired,
    }));
  } catch (error: any) {
    console.error('[ExtractLead] PATCH error:', error?.message || error);
    return withCors(NextResponse.json({ error: error?.message || 'Failed to update lead' }, { status: 500 }));
  }
}
