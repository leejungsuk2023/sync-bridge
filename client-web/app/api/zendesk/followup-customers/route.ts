import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// CORS: Desktop App (Electron) and Extension cross-origin requests
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
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

export async function GET(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  try {
    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get('status');

    let query = supabaseAdmin
      .from('zendesk_analyses')
      .select('ticket_id, customer_name, customer_phone, interested_procedure, customer_age, hospital_name, followup_reason, needs_followup, followup_status, followup_note, followup_updated_by, followup_updated_at, next_check_at, last_checked_at, check_count, lost_reason, lost_reason_detail, followup_reason_th, interested_procedure_th')
      .not('followup_status', 'is', null)
      .order('followup_updated_at', { ascending: false });

    if (statusFilter) {
      query = query.eq('followup_status', statusFilter);
    }

    const { data: analyses, error } = await query;

    if (error) {
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    // Enrich with ticket subject
    const ticketIds = (analyses || []).map(a => a.ticket_id);
    const { data: tickets } = ticketIds.length > 0
      ? await supabaseAdmin
          .from('zendesk_tickets')
          .select('ticket_id, subject')
          .in('ticket_id', ticketIds)
      : { data: [] };

    const ticketMap = new Map((tickets || []).map(t => [t.ticket_id, t.subject]));

    const customers = (analyses || []).map(a => ({
      ...a,
      subject: ticketMap.get(a.ticket_id) || null,
    }));

    // Translate Korean fields to Thai for workers (backfill missing translations)
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (GEMINI_API_KEY) {
      const needsTranslation = customers.filter((c: any) =>
        (c.followup_reason && !c.followup_reason_th) ||
        (c.interested_procedure && !c.interested_procedure_th)
      );

      if (needsTranslation.length > 0) {
        try {
          // Build a batch translation request
          const toTranslate = needsTranslation.map((c: any) => ({
            ticket_id: c.ticket_id,
            followup_reason: c.followup_reason && !c.followup_reason_th ? c.followup_reason : null,
            interested_procedure: c.interested_procedure && !c.interested_procedure_th ? c.interested_procedure : null,
          }));

          const translationPrompt = `Translate the following Korean medical/business texts to Thai. Return a JSON array with the same structure, replacing Korean text with Thai translations. Keep null values as null.

Input:
${JSON.stringify(toTranslate, null, 2)}

Return ONLY valid JSON array with objects having: ticket_id, followup_reason (Thai), interested_procedure (Thai). Keep ticket_id as-is.`;

          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: translationPrompt }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: 'application/json' },
              }),
            }
          );

          if (geminiRes.ok) {
            const geminiData = await geminiRes.json();
            const translatedText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (translatedText) {
              const translations: any[] = JSON.parse(translatedText);

              // Apply translations to customers array and save to DB
              for (const t of translations) {
                const customer = customers.find((c: any) => c.ticket_id === t.ticket_id);
                if (!customer) continue;

                const dbUpdate: Record<string, any> = {};
                if (t.followup_reason && customer.followup_reason && !customer.followup_reason_th) {
                  customer.followup_reason_th = t.followup_reason;
                  dbUpdate.followup_reason_th = t.followup_reason;
                }
                if (t.interested_procedure && customer.interested_procedure && !customer.interested_procedure_th) {
                  customer.interested_procedure_th = t.interested_procedure;
                  dbUpdate.interested_procedure_th = t.interested_procedure;
                }

                // Save back to DB for caching
                if (Object.keys(dbUpdate).length > 0) {
                  supabaseAdmin.from('zendesk_analyses').update(dbUpdate).eq('ticket_id', t.ticket_id).then(() => {});
                }
              }
            }
          }
        } catch (translateErr) {
          console.error('[followup-customers] Translation backfill error:', translateErr);
          // Continue without translation — Korean text is better than no text
        }
      }
    }

    return withCors(NextResponse.json({ customers }));
  } catch (err: any) {
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}

const VALID_STATUSES = ['pending', 'contacted', 'scheduled', 'converted', 'lost'];

export async function PATCH(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  try {
    const body = await req.json();
    const { ticket_id, status, note, action_comment, lost_reason, lost_reason_detail } = body;

    if (!ticket_id) {
      return withCors(NextResponse.json({ error: 'ticket_id is required' }, { status: 400 }));
    }

    // Fetch current status before update
    const { data: current, error: fetchError } = await supabaseAdmin
      .from('zendesk_analyses')
      .select('followup_status, lost_reason, lost_reason_detail')
      .eq('ticket_id', ticket_id)
      .single();

    if (fetchError || !current) {
      return withCors(NextResponse.json({ error: 'Ticket not found' }, { status: 404 }));
    }

    const statusBefore = current.followup_status;

    // If no explicit status provided, auto-determine
    let targetStatus = status;
    if (!targetStatus) {
      // Worker comment-only: auto-set to "contacted" if pending, otherwise keep current
      targetStatus = statusBefore === 'pending' ? 'contacted' : statusBefore;
    }

    if (!VALID_STATUSES.includes(targetStatus)) {
      return withCors(NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 }));
    }

    // Validate lost status requires lost_reason
    if (targetStatus === 'lost' && !lost_reason) {
      return withCors(NextResponse.json({ error: 'lost_reason is required when status is lost' }, { status: 400 }));
    }

    // Validate lost_reason='other' requires detail
    if (lost_reason === 'other' && !lost_reason_detail) {
      return withCors(NextResponse.json({ error: 'lost_reason_detail is required when lost_reason is other' }, { status: 400 }));
    }

    const isRevert = statusBefore === 'lost' && targetStatus === 'contacted';

    // Validate: lost→contacted revert is bbg_admin only
    if (isRevert && authUser.role !== 'bbg_admin') {
      return withCors(NextResponse.json({ error: 'Only admin can revert lost status' }, { status: 403 }));
    }

    // Build update data
    const updateData: Record<string, any> = {
      followup_status: targetStatus,
      followup_updated_by: authUser.userId,
      followup_updated_at: new Date().toISOString(),
    };

    if (note !== undefined) {
      updateData.followup_note = note;
    }

    // Set next_check_at: active statuses get refreshed, terminal statuses get null
    if (targetStatus === 'contacted' || targetStatus === 'scheduled') {
      updateData.next_check_at = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    } else if (targetStatus === 'lost' || targetStatus === 'converted') {
      updateData.next_check_at = null;
    }

    // Handle lost status: save reason
    if (targetStatus === 'lost') {
      updateData.lost_reason = lost_reason;
      updateData.lost_reason_detail = lost_reason_detail || null;
    }

    // Handle revert from lost: clear lost fields
    if (isRevert) {
      updateData.lost_reason = null;
      updateData.lost_reason_detail = null;
    }

    const { data, error } = await supabaseAdmin
      .from('zendesk_analyses')
      .update(updateData)
      .eq('ticket_id', ticket_id)
      .select()
      .single();

    if (error) {
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    // Insert followup_actions record
    // Status labels in Thai for worker-facing content
    const STATUS_LABELS_TH: Record<string, string> = {
      pending: 'รอดำเนินการ', contacted: 'ติดต่อแล้ว', scheduled: 'นัดหมายแล้ว',
      converted: 'สำเร็จ', lost: 'ไม่สำเร็จ',
    };
    const LOST_REASON_LABELS_TH: Record<string, string> = {
      no_response: 'ติดต่อไม่ได้', customer_rejected: 'ลูกค้าปฏิเสธ',
      competitor: 'เลือกคู่แข่ง', price_issue: 'ปัญหาเรื่องราคา', other: 'อื่นๆ',
    };

    // Translate worker's Thai comment to Korean for admin view
    let contentKo = action_comment || `Status changed to ${targetStatus}`;
    let contentTh = action_comment || `เปลี่ยนสถานะเป็น ${STATUS_LABELS_TH[targetStatus] || targetStatus}`;

    if (action_comment && authUser.role === 'worker' && process.env.GEMINI_API_KEY) {
      try {
        const translateRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `Translate the following Thai text to Korean. Return ONLY the Korean translation, nothing else.\n\n${action_comment}` }] }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
            }),
          }
        );
        if (translateRes.ok) {
          const translateData = await translateRes.json();
          const translated = translateData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (translated) contentKo = translated;
        }
      } catch (translateErr) {
        console.error('[followup-customers] Translation error:', translateErr);
      }
    }

    const actionRecord: Record<string, any> = {
      ticket_id,
      action_type: isRevert ? 'system_note' : 'worker_action',
      content: isRevert
        ? `Admin reverted status from lost to contacted (previous reason: ${current.lost_reason || 'unknown'})`
        : contentKo,
      content_th: isRevert
        ? `แอดมินเปลี่ยนสถานะจาก ไม่สำเร็จ เป็น ติดต่อแล้ว (เหตุผลเดิม: ${LOST_REASON_LABELS_TH[current.lost_reason] || current.lost_reason || '-'})`
        : contentTh,
      status_before: statusBefore,
      status_after: targetStatus,
      created_by: authUser.userId,
    };

    await supabaseAdmin.from('followup_actions').insert(actionRecord);

    return withCors(NextResponse.json({ updated: data }));
  } catch (err: any) {
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}
