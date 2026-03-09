import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// CORS: Desktop App (Electron) 및 Extension에서의 cross-origin 요청 허용
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

export async function POST(req: NextRequest) {
  try {
    const { text, targetLang } = await req.json();

    if (!text?.trim()) {
      return withCors(NextResponse.json({ error: 'text is required' }, { status: 400 }));
    }

    if (!GEMINI_API_KEY) {
      return withCors(NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 }));
    }

    const langName = targetLang === 'th' ? 'Thai' : targetLang === 'ko' ? 'Korean' : targetLang;

    // Fetch glossary entries for improved translation accuracy
    let glossaryText = '';
    try {
      const { data: glossaryEntries } = await supabaseAdmin
        .from('glossary')
        .select('korean, thai, notes');

      if (glossaryEntries && glossaryEntries.length > 0) {
        const GLOSSARY_THRESHOLD = 200;
        let entries = glossaryEntries;

        // If glossary is large, only include entries relevant to the source text
        if (entries.length > GLOSSARY_THRESHOLD) {
          const lowerText = text.toLowerCase();
          entries = entries.filter((e: any) => {
            if (targetLang === 'th') {
              return lowerText.includes(e.korean.toLowerCase());
            } else {
              return lowerText.includes(e.thai.toLowerCase());
            }
          });
        }

        if (entries.length > 0) {
          glossaryText = entries
            .map((e: any) => {
              const arrow = targetLang === 'th'
                ? `${e.korean} → ${e.thai}`
                : `${e.thai} → ${e.korean}`;
              return e.notes ? `- ${arrow} (${e.notes})` : `- ${arrow}`;
            })
            .join('\n');
        }
      }
    } catch (glossaryErr) {
      console.error('[Translate] Failed to fetch glossary, proceeding without it:', glossaryErr);
    }

    // Build system instruction with or without glossary
    let systemPrompt: string;
    if (glossaryText) {
      systemPrompt = `You are a professional translator for a medical tourism BPO company (BBG) managing Thai remote workers for Korean hospitals. Translate the given text to ${langName}.

IMPORTANT - Use these exact medical/business term translations (glossary):
${glossaryText}

Rules:
1. Use the glossary terms EXACTLY as specified above
2. For medical terms not in the glossary, use standard medical translations
3. Only return the translated text, nothing else`;
    } else {
      systemPrompt = `You are a professional translator for a medical tourism BPO company (BBG) managing Thai remote workers for Korean hospitals. Translate the given text to ${langName}. Only return the translated text, nothing else.`;
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: systemPrompt,
              },
            ],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text }],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
          },
        }),
      }
    );

    if (!res.ok) {
      const errBody = await res.text();
      return withCors(NextResponse.json({ error: `Gemini API error: ${res.status}`, detail: errBody }, { status: 502 }));
    }

    const data = await res.json();
    const translated = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    return withCors(NextResponse.json({ translated }));
  } catch (err: any) {
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}
