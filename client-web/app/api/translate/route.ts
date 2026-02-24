import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export async function POST(req: NextRequest) {
  try {
    const { text, targetLang } = await req.json();

    if (!text?.trim()) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
    }

    const langName = targetLang === 'th' ? 'Thai' : targetLang === 'ko' ? 'Korean' : targetLang;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: `You are a professional translator for a BPO company managing remote workers. Translate the given work instruction to ${langName}. Only return the translated text, nothing else.`,
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
            maxOutputTokens: 1024,
          },
        }),
      }
    );

    if (!res.ok) {
      const errBody = await res.text();
      return NextResponse.json({ error: `Gemini API error: ${res.status}`, detail: errBody }, { status: 502 });
    }

    const data = await res.json();
    const translated = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    return NextResponse.json({ translated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
