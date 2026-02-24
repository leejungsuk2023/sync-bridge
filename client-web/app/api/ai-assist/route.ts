import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();

    if (!text?.trim()) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    if (!GEMINI_API_KEY) {
      return NextResponse.json(mockResponse(text), { status: 200 });
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
                text: `You are an AI assistant for a Korean medical/beauty BPO company that manages Thai remote CS workers.

A Thai CS worker has received a message from a patient (in Thai). Your job:
1. Translate the patient's message to Korean so the Korean manager can understand
2. Analyze the patient's intent (brief, in Korean)
3. Suggest 3 short professional reply options IN THAI (keep each reply under 2 sentences)

Respond in this exact JSON format:
{"translation_ko": "Korean translation", "intent": "Brief intent in Korean", "replies": [{"label": "3-5 word Thai label", "text": "Short Thai reply (1-2 sentences max)"}, {"label": "3-5 word Thai label", "text": "Short Thai reply (1-2 sentences max)"}, {"label": "3-5 word Thai label", "text": "Short Thai reply (1-2 sentences max)"}]}`,
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
            temperature: 0.3,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    if (!res.ok) {
      return NextResponse.json(mockResponse(text), { status: 200 });
    }

    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    try {
      const parsed = JSON.parse(raw);
      if (
        typeof parsed.translation_ko !== 'string' ||
        typeof parsed.intent !== 'string' ||
        !Array.isArray(parsed.replies) ||
        !parsed.replies.every((r: any) => typeof r.label === 'string' && typeof r.text === 'string')
      ) {
        return NextResponse.json(mockResponse(text), { status: 200 });
      }
      return NextResponse.json(parsed);
    } catch {
      return NextResponse.json(mockResponse(text), { status: 200 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function mockResponse(text: string) {
  return {
    translation_ko: `[번역] ${text.slice(0, 80)}`,
    intent: '환자 문의 (AI 미연결 - Mock 응답)',
    replies: [
      { label: 'ขอบคุณครับ', text: 'ขอบคุณที่ติดต่อมาครับ ทางเราจะตรวจสอบและแจ้งกลับโดยเร็วที่สุดครับ' },
      { label: 'รอสักครู่', text: 'กรุณารอสักครู่นะครับ ทางเราจะตรวจสอบข้อมูลให้ครับ' },
      { label: 'สอบถามเพิ่มเติม', text: 'สามารถให้ข้อมูลเพิ่มเติมได้ไหมครับ เพื่อให้ทางเราช่วยเหลือได้ดียิ่งขึ้นครับ' },
    ],
  };
}
