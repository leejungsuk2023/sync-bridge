import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function withCors(response: NextResponse) {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

async function verifyUser(req: NextRequest) {
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
  return profile ? { role: profile.role, userId: user.id } : null;
}

// GET: List glossary entries (optionally filter by category)
export async function GET(req: NextRequest) {
  try {
    const user = await verifyUser(req);
    if (!user) {
      return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    }

    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');

    let query = supabaseAdmin
      .from('glossary')
      .select('*')
      .order('korean', { ascending: true });

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Glossary] GET error:', error);
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    return withCors(NextResponse.json({ glossary: data }));
  } catch (err: any) {
    console.error('[Glossary] GET exception:', err);
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}

// POST: Create single entry or bulk import
export async function POST(req: NextRequest) {
  try {
    const user = await verifyUser(req);
    if (!user || user.role !== 'bbg_admin') {
      return withCors(NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 }));
    }

    const body = await req.json();

    // Bulk import
    if (body.entries && Array.isArray(body.entries)) {
      const rows = body.entries.map((entry: any) => ({
        korean: entry.korean,
        thai: entry.thai,
        category: entry.category || 'general',
        notes: entry.notes || null,
        created_by: user.userId,
      }));

      const { data, error } = await supabaseAdmin
        .from('glossary')
        .upsert(rows, { onConflict: 'korean,thai', ignoreDuplicates: true })
        .select();

      if (error) {
        console.error('[Glossary] Bulk POST error:', error);
        return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
      }

      return withCors(NextResponse.json({ inserted: data?.length || 0, glossary: data }));
    }

    // Single entry
    const { korean, thai, category, notes } = body;
    if (!korean || !thai) {
      return withCors(NextResponse.json({ error: 'korean and thai are required' }, { status: 400 }));
    }

    const { data, error } = await supabaseAdmin
      .from('glossary')
      .upsert(
        { korean, thai, category: category || 'general', notes: notes || null, created_by: user.userId },
        { onConflict: 'korean,thai', ignoreDuplicates: false },
      )
      .select()
      .single();

    if (error) {
      console.error('[Glossary] POST error:', error);
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    return withCors(NextResponse.json({ glossary: data }));
  } catch (err: any) {
    console.error('[Glossary] POST exception:', err);
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}

// PATCH: Update a single entry
export async function PATCH(req: NextRequest) {
  try {
    const user = await verifyUser(req);
    if (!user || user.role !== 'bbg_admin') {
      return withCors(NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 }));
    }

    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) {
      return withCors(NextResponse.json({ error: 'id is required' }, { status: 400 }));
    }

    // Only allow updating specific fields
    const allowedFields: Record<string, any> = {};
    if (updates.korean !== undefined) allowedFields.korean = updates.korean;
    if (updates.thai !== undefined) allowedFields.thai = updates.thai;
    if (updates.category !== undefined) allowedFields.category = updates.category;
    if (updates.notes !== undefined) allowedFields.notes = updates.notes;
    allowedFields.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('glossary')
      .update(allowedFields)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[Glossary] PATCH error:', error);
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    return withCors(NextResponse.json({ glossary: data }));
  } catch (err: any) {
    console.error('[Glossary] PATCH exception:', err);
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}

// DELETE: Remove a single entry
export async function DELETE(req: NextRequest) {
  try {
    const user = await verifyUser(req);
    if (!user || user.role !== 'bbg_admin') {
      return withCors(NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 }));
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return withCors(NextResponse.json({ error: 'id query parameter is required' }, { status: 400 }));
    }

    const { error } = await supabaseAdmin
      .from('glossary')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[Glossary] DELETE error:', error);
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    return withCors(NextResponse.json({ success: true }));
  } catch (err: any) {
    console.error('[Glossary] DELETE exception:', err);
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}
