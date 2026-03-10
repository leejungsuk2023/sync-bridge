// LINE media proxy — fetches media content from LINE's API with auth headers
// and streams it back to the browser so <img src> works without needing
// an Authorization header on the client side.
//
// Usage: GET /api/channels/line/media?messageId=<LINE_message_id>

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

async function verifyUser(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
  } = await supabaseAdmin.auth.getUser(token);
  return !!user;
}

export async function GET(req: NextRequest) {
  // Auth check — only logged-in users can proxy LINE media
  const authed = await verifyUser(req);
  if (!authed) {
    return withCors(new NextResponse('Unauthorized', { status: 401 }));
  }

  const { searchParams } = new URL(req.url);
  const messageId = searchParams.get('messageId');

  if (!messageId) {
    return withCors(new NextResponse('messageId query param is required', { status: 400 }));
  }

  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('[LINE Media Proxy] LINE_CHANNEL_ACCESS_TOKEN is not set');
    return withCors(new NextResponse('Server misconfiguration', { status: 500 }));
  }

  const lineUrl = `https://api-data.line.me/v2/bot/message/${messageId}/content`;

  let lineRes: Response;
  try {
    lineRes = await fetch(lineUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (err) {
    console.error('[LINE Media Proxy] Fetch failed:', err);
    return withCors(new NextResponse('Failed to fetch media from LINE', { status: 502 }));
  }

  if (!lineRes.ok) {
    console.error(`[LINE Media Proxy] LINE returned ${lineRes.status} for message ${messageId}`);
    return withCors(
      new NextResponse(`LINE API error: ${lineRes.status}`, { status: lineRes.status })
    );
  }

  const contentType = lineRes.headers.get('content-type') ?? 'application/octet-stream';
  const body = await lineRes.arrayBuffer();

  const response = new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      // Cache for 1 hour — LINE content URLs are stable per message ID
      'Cache-Control': 'private, max-age=3600',
    },
  });

  return withCors(response);
}
