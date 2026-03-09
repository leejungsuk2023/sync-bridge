import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// CORS: Desktop App (Electron) and Extension cross-origin requests
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

async function verifyAdmin(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return false;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  return profile?.role === 'bbg_admin' || profile?.role === 'hospital';
}

function buildAnalysisPrompt(ticket: any): string {
  const commentsText = (ticket.comments || [])
    .map((c: any) => `[${c.author_id}]: ${c.body}`)
    .join('\n\n');

  return `You are analyzing a customer support ticket from a medical tourism agency (BBG) that connects Thai customers with Korean hospitals.

Analyze the following support ticket conversation and return a JSON response with these fields:
- quality_score (1-5): How well the agent handled the inquiry. 5=excellent, 1=very poor
- reservation_converted (boolean): Did the conversation lead to a hospital reservation/booking?
- needs_followup (boolean): Does this customer need follow-up contact?
- followup_reason (string or null): If needs_followup is true, explain why in Korean
- summary (string): 2-3 sentence summary of the conversation IN KOREAN (한국어로 작성)
- issues (string[]): List of any problems found in Korean (e.g., 응답 지연, 잘못된 정보, 기회 놓침)
- hospital_name (string or null): Name of the hospital discussed, if any
- customer_name (string or null): Customer's name mentioned in conversation (Thai or Korean name)
- customer_phone (string or null): Customer's phone number if mentioned (any format)
- interested_procedure (string or null): The medical procedure/surgery the customer is interested in, IN KOREAN (e.g., 눈성형, 코성형, 지방흡입, 가슴성형, 리프팅)
- customer_age (number or null): Customer's age if mentioned or inferable
- followup_reason_th (string or null): If needs_followup is true, translate the followup_reason to Thai
- interested_procedure_th (string or null): Thai translation of interested_procedure (e.g., ทำตาสองชั้น, เสริมจมูก, ดูดไขมัน, เสริมหน้าอก, ยกกระชับ)

IMPORTANT: summary, followup_reason, issues, and interested_procedure MUST be written in Korean (한국어).
followup_reason_th and interested_procedure_th MUST be written in Thai (ภาษาไทย).

Ticket Subject: ${ticket.subject}
Ticket Status: ${ticket.status}
Conversation:
${commentsText}

Respond ONLY with valid JSON, no markdown.`;
}

export async function POST(req: NextRequest) {
  if (!await verifyAdmin(req)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  if (!process.env.GEMINI_API_KEY) {
    return withCors(NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 }));
  }

  const body = await req.json().catch(() => ({}));
  const singleTicketId = body.ticket_id ? Number(body.ticket_id) : null;
  const limit = Math.min(body.limit || 10, 50);

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 2048,
    },
  });

  const errors: string[] = [];
  let analyzed = 0;

  try {
    let batch: any[] = [];

    if (singleTicketId) {
      // Single ticket analysis mode
      const { data: ticket, error: fetchErr } = await supabaseAdmin
        .from('zendesk_tickets')
        .select('*')
        .eq('ticket_id', singleTicketId)
        .single();

      if (fetchErr || !ticket) {
        return withCors(NextResponse.json({ error: 'Ticket not found' }, { status: 404 }));
      }

      // Remove existing analysis if re-analyzing
      await supabaseAdmin.from('zendesk_analyses').delete().eq('ticket_id', singleTicketId);
      batch = [ticket];
    } else {
      // Batch analysis mode: find active tickets with 4+ comments
      const { data: tickets, error: fetchErr } = await supabaseAdmin
        .from('zendesk_tickets')
        .select('*')
        .in('status', ['open', 'pending', 'new'])
        .order('updated_at_zd', { ascending: false });

      if (fetchErr) {
        return withCors(NextResponse.json({ error: fetchErr.message }, { status: 500 }));
      }

      if (!tickets || tickets.length === 0) {
        return withCors(NextResponse.json({ analyzed: 0, message: 'No tickets to analyze' }));
      }

      const ticketIds = tickets.map(t => t.ticket_id);
      const { data: existingAnalyses } = await supabaseAdmin
        .from('zendesk_analyses')
        .select('ticket_id')
        .in('ticket_id', ticketIds);

      const analyzedIds = new Set((existingAnalyses || []).map(a => a.ticket_id));
      const unanalyzed = tickets.filter(t => {
        if (analyzedIds.has(t.ticket_id)) return false;
        const commentCount = Array.isArray(t.comments) ? t.comments.length : 0;
        return commentCount >= 4;
      });

      if (unanalyzed.length === 0) {
        return withCors(NextResponse.json({ analyzed: 0, message: 'No active tickets with 4+ comments to analyze' }));
      }

      batch = unanalyzed.slice(0, limit);
    }

    for (const ticket of batch) {
      try {
        const prompt = buildAnalysisPrompt(ticket);
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const analysis = JSON.parse(text);

        await supabaseAdmin.from('zendesk_analyses').insert({
          ticket_id: ticket.ticket_id,
          quality_score: analysis.quality_score,
          reservation_converted: analysis.reservation_converted,
          needs_followup: analysis.needs_followup,
          followup_reason: analysis.followup_reason || null,
          summary: analysis.summary,
          issues: analysis.issues || [],
          hospital_name: analysis.hospital_name || null,
          customer_name: analysis.customer_name || null,
          customer_phone: analysis.customer_phone || null,
          interested_procedure: analysis.interested_procedure || null,
          customer_age: analysis.customer_age || null,
          followup_reason_th: analysis.followup_reason_th || null,
          interested_procedure_th: analysis.interested_procedure_th || null,
          analyzed_at: new Date().toISOString(),
        });

        analyzed++;
      } catch (err: any) {
        errors.push(`Ticket ${ticket.ticket_id}: ${err.message}`);
      }
    }
  } catch (err: any) {
    return withCors(NextResponse.json({ error: err.message, analyzed, errors }, { status: 500 }));
  }

  return withCors(NextResponse.json({ analyzed, errors }));
}
