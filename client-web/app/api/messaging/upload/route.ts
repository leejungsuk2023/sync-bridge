// Upload an image/file for outbound messaging.
// Stores the file in Supabase Storage (bucket: messaging-attachments) and
// returns a public URL that can be passed to the reply API.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export const maxDuration = 60;

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
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifyUser(
  req: NextRequest
): Promise<{ role: string; userId: string } | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
  } = await supabaseAdmin.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!profile || !['bbg_admin', 'worker', 'client'].includes(profile.role)) return null;
  return { role: profile.role, userId: user.id };
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'application/zip',
]);

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

export async function POST(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return withCors(NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 }));
  }

  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return withCors(NextResponse.json({ error: 'file field is required' }, { status: 400 }));
  }

  if (file.size > MAX_FILE_SIZE) {
    return withCors(
      NextResponse.json({ error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)` }, { status: 400 })
    );
  }

  const mimeType = file.type || 'application/octet-stream';
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return withCors(
      NextResponse.json({ error: `File type not allowed: ${mimeType}` }, { status: 400 })
    );
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
  const storagePath = `${authUser.userId}/${crypto.randomUUID()}.${ext}`;
  const bucket = 'messaging-attachments';

  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  const { error: uploadError } = await supabaseAdmin.storage
    .from(bucket)
    .upload(storagePath, uint8Array, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) {
    console.error('[Messaging Upload] Storage upload failed:', uploadError);
    return withCors(
      NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 })
    );
  }

  const { data: publicUrlData } = supabaseAdmin.storage
    .from(bucket)
    .getPublicUrl(storagePath);

  const publicUrl = publicUrlData?.publicUrl;
  if (!publicUrl) {
    console.error('[Messaging Upload] Failed to get public URL for', storagePath);
    return withCors(NextResponse.json({ error: 'Failed to get public URL' }, { status: 500 }));
  }

  const isImage = mimeType.startsWith('image/');
  console.log(`[Messaging Upload] Uploaded ${file.name} → ${publicUrl} (user: ${authUser.userId})`);

  return withCors(
    NextResponse.json({
      ok: true,
      url: publicUrl,
      message_type: isImage ? 'image' : 'file',
      file_name: file.name,
      mime_type: mimeType,
    })
  );
}
