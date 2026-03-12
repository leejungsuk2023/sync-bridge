// LINE media proxy — fallback for old messages that still have proxy URLs.
//
// New messages store media directly in Supabase Storage (public URL) via
// downloadAndStoreMedia() in lib/channels/line.ts, so this proxy is only
// needed for messages received before that change was deployed.
//
// Auth requirement removed: <img src> cannot send Authorization headers, so
// requiring Bearer auth here caused 401s for every image. The route simply
// validates that messageId is present and proxies the content from LINE.
//
// Usage: GET /api/channels/line/media?messageId=<LINE_message_id>

import { NextRequest, NextResponse } from 'next/server';

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

export async function GET(req: NextRequest) {
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
      'Cache-Control': 'public, max-age=3600',
    },
  });

  return withCors(response);
}
