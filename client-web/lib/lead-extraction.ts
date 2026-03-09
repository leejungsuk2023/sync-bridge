// AI lead extraction logic using Gemini for sales lead collection
// Pattern: follows lib/ai-suggest.ts

import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

export interface ExtractionField<T = string | null> {
  value: T;
  confidence: number;
}

export interface LeadExtraction {
  customer: {
    name: ExtractionField<string>;
    age: ExtractionField<number | null>;
    gender: ExtractionField<'male' | 'female' | 'other' | null>;
    phone: ExtractionField;
    line_id: ExtractionField;
    instagram: ExtractionField;
  };
  procedures: {
    requested: ExtractionField<string[]>;
    body_parts: ExtractionField<string[]>;
  };
  medical: {
    history: ExtractionField & { confirmed: boolean };
    allergies: ExtractionField & { confirmed: boolean };
    medications: ExtractionField & { confirmed: boolean };
  };
  photos: string[];
  budget: ExtractionField<number | null> & { currency: string };
  preferred_date: ExtractionField;
  special_notes: ExtractionField;
  missing_fields: string[];
  suggested_questions: Array<{
    field: string;
    question_th: string;
    question_ko: string;
  }>;
}

function buildExtractionPrompt(
  conversations: any[],
  existingLead: any | null,
): string {
  const conversationText = conversations
    .map((c: any) => {
      const body = (c.body || '').slice(0, 500);
      return `[${c.author_type === 'customer' ? 'Customer' : 'Agent'}] ${body}`;
    })
    .join('\n');

  const existingInfo = existingLead
    ? `\nPrevious extraction data (use as base, update with new information):\n${JSON.stringify(existingLead, null, 2)}`
    : '\nNo previous extraction available.';

  return `System: You are a medical tourism information extraction AI for a Korean plastic surgery clinic.
Your task is to extract structured patient information from a Thai-language Zendesk support conversation.

Instructions:
- Extract ALL available information from the conversation
- For each field, provide a confidence score (0.0-1.0)
- If information is not explicitly mentioned, set confidence to 0.0 and value to null
- Detect images shared in the conversation (attachment URLs)
- Convert Thai names to a readable format
- Identify the specific procedures mentioned (use medical terminology when possible)
- Flag any medical concerns (allergies, medications, pre-existing conditions)

Output JSON format:
{
  "customer": {
    "name": { "value": "string", "confidence": 0.0-1.0 },
    "age": { "value": number|null, "confidence": 0.0-1.0 },
    "gender": { "value": "male"|"female"|"other"|null, "confidence": 0.0-1.0 },
    "phone": { "value": "string|null", "confidence": 0.0-1.0 },
    "line_id": { "value": "string|null", "confidence": 0.0-1.0 },
    "instagram": { "value": "string|null", "confidence": 0.0-1.0 }
  },
  "procedures": {
    "requested": { "value": ["string"], "confidence": 0.0-1.0 },
    "body_parts": { "value": ["string"], "confidence": 0.0-1.0 }
  },
  "medical": {
    "history": { "value": "string|null", "confidence": 0.0-1.0, "confirmed": boolean },
    "allergies": { "value": "string|null", "confidence": 0.0-1.0, "confirmed": boolean },
    "medications": { "value": "string|null", "confidence": 0.0-1.0, "confirmed": boolean }
  },
  "photos": ["url1", "url2"],
  "budget": { "value": number|null, "currency": "THB", "confidence": 0.0-1.0 },
  "preferred_date": { "value": "string|null", "confidence": 0.0-1.0 },
  "special_notes": { "value": "string|null", "confidence": 0.0-1.0 },
  "missing_fields": ["field1", "field2"],
  "suggested_questions": [
    { "field": "allergies", "question_th": "คุณมีอาการแพ้ยาหรืออาหารหรือไม่คะ?", "question_ko": "약물이나 음식 알레르기가 있으신가요?" }
  ]
}

Conversation:
${conversationText}
${existingInfo}

Respond ONLY with valid JSON (no markdown, no code fences).`;
}

export async function extractLeadInfo(
  ticketId: number,
  existingLead: any | null,
): Promise<{ extraction: LeadExtraction; responseTimeMs: number }> {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Fetch recent 20 conversations for this ticket
  const { data: conversations } = await supabaseAdmin
    .from('zendesk_conversations')
    .select('author_type, body, created_at')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false })
    .limit(20);

  const orderedConversations = (conversations || []).reverse();

  if (orderedConversations.length === 0) {
    throw new Error('No conversations found for this ticket');
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = buildExtractionPrompt(orderedConversations, existingLead);
  const startTime = Date.now();

  console.log(`[LeadExtraction] Extracting lead info from ticket #${ticketId} (${orderedConversations.length} conversations)`);
  const result = await model.generateContent(prompt);
  const responseTimeMs = Date.now() - startTime;

  const responseText = result.response.text();
  console.log(`[LeadExtraction] Gemini responded in ${responseTimeMs}ms for ticket #${ticketId}`);

  // Parse JSON response — strip markdown code fences if present
  let extraction: LeadExtraction;
  try {
    const cleaned = responseText
      .replace(/^```(?:json)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim();
    extraction = JSON.parse(cleaned);
  } catch (parseErr) {
    console.error('[LeadExtraction] Failed to parse Gemini response:', parseErr, responseText);
    throw new Error('Failed to parse AI extraction response');
  }

  return { extraction, responseTimeMs };
}

// Build a flat lead record from AI extraction for DB upsert
export function extractionToLeadRecord(
  extraction: LeadExtraction,
  ticketId: number,
  collectedBy: string,
  hospitalTag: string | null,
): Record<string, any> {
  return {
    ticket_id: ticketId,
    customer_name: extraction.customer?.name?.value || 'Unknown',
    customer_age: extraction.customer?.age?.value || null,
    customer_gender: extraction.customer?.gender?.value || null,
    customer_phone: extraction.customer?.phone?.value || null,
    customer_line: extraction.customer?.line_id?.value || null,
    customer_instagram: extraction.customer?.instagram?.value || null,
    procedures: extraction.procedures?.requested?.value || [],
    body_parts: extraction.procedures?.body_parts?.value || [],
    reference_photos: extraction.photos || [],
    medical_history: extraction.medical?.history?.value || null,
    allergies: extraction.medical?.allergies?.value || null,
    current_medications: extraction.medical?.medications?.value || null,
    medical_confirmed:
      (extraction.medical?.history?.confirmed ?? false) &&
      (extraction.medical?.allergies?.confirmed ?? false) &&
      (extraction.medical?.medications?.confirmed ?? false),
    budget_thb: extraction.budget?.value || null,
    preferred_date: extraction.preferred_date?.value || null,
    special_notes: extraction.special_notes?.value || null,
    collected_by: collectedBy,
    hospital_tag: hospitalTag,
    ai_extraction: extraction,
    ai_confidence: computeOverallConfidence(extraction),
    extraction_model: 'gemini-2.5-flash',
    updated_at: new Date().toISOString(),
  };
}

function computeOverallConfidence(extraction: LeadExtraction): number {
  const scores: number[] = [];
  if (extraction.customer?.name?.confidence != null) scores.push(extraction.customer.name.confidence);
  if (extraction.customer?.phone?.confidence != null) scores.push(extraction.customer.phone.confidence);
  if (extraction.procedures?.requested?.confidence != null) scores.push(extraction.procedures.requested.confidence);
  if (extraction.medical?.history?.confidence != null) scores.push(extraction.medical.history.confidence);
  if (extraction.medical?.allergies?.confidence != null) scores.push(extraction.medical.allergies.confidence);
  if (extraction.medical?.medications?.confidence != null) scores.push(extraction.medical.medications.confidence);
  if (scores.length === 0) return 0;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100;
}

// Compute which required fields are still missing
export function computeMissingRequired(leadData: Record<string, any>): string[] {
  const missing: string[] = [];
  if (!leadData.customer_name || leadData.customer_name === 'Unknown') missing.push('customer_name');
  if (!leadData.customer_phone && !leadData.customer_line && !leadData.customer_instagram) missing.push('contact_info');
  if (!leadData.procedures || leadData.procedures.length === 0) missing.push('procedures');
  if (!leadData.body_parts || leadData.body_parts.length === 0) missing.push('body_parts');
  if (leadData.medical_history === null || leadData.medical_history === undefined) missing.push('medical_history');
  if (leadData.allergies === null || leadData.allergies === undefined) missing.push('allergies');
  if (leadData.current_medications === null || leadData.current_medications === undefined) missing.push('current_medications');
  return missing;
}

// Translate lead fields from Thai to Korean using Gemini
export async function translateLeadToKorean(
  leadData: Record<string, any>,
): Promise<Record<string, any>> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const fieldsToTranslate: Record<string, any> = {
    customer_name: leadData.customer_name,
    procedures: leadData.procedures,
    body_parts: leadData.body_parts,
    medical_history: leadData.medical_history,
    allergies: leadData.allergies,
    current_medications: leadData.current_medications,
    preferred_date: leadData.preferred_date,
    special_notes: leadData.special_notes,
  };

  const prompt = `System: Translate the following medical tourism patient information from Thai to Korean.
Maintain medical terminology accuracy. Use formal business Korean.
Preserve the data structure exactly.

Input:
${JSON.stringify(fieldsToTranslate, null, 2)}

Output JSON format (same keys with _ko suffix for string fields, keep arrays as arrays):
{
  "customer_name_ko": "Korean name",
  "procedures_ko": ["Korean procedure names"],
  "body_parts_ko": ["Korean body part names"],
  "medical_history_ko": "Korean text or null",
  "allergies_ko": "Korean text or null",
  "current_medications_ko": "Korean text or null",
  "preferred_date_ko": "Korean text or null",
  "special_notes_ko": "Korean text or null"
}

Respond ONLY with valid JSON (no markdown, no code fences).`;

  console.log('[LeadExtraction] Translating lead data to Korean');
  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  try {
    const cleaned = responseText
      .replace(/^```(?:json)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim();
    return JSON.parse(cleaned);
  } catch (parseErr) {
    console.error('[LeadExtraction] Failed to parse translation response:', parseErr, responseText);
    return {};
  }
}

// Format the lead data as a structured Korean message for CS chat room
export function formatCSMessage(
  leadData: Record<string, any>,
  translations: Record<string, any>,
  ticketId: number,
  workerName: string,
): string {
  const name = translations.customer_name_ko || leadData.customer_name || 'Unknown';
  const age = leadData.customer_age ? `${leadData.customer_age}세` : 'N/A';
  const genderMap: Record<string, string> = { male: '남성', female: '여성', other: '기타' };
  const gender = leadData.customer_gender ? genderMap[leadData.customer_gender] || leadData.customer_gender : 'N/A';

  const contacts: string[] = [];
  if (leadData.customer_phone) contacts.push(`전화: ${leadData.customer_phone}`);
  if (leadData.customer_line) contacts.push(`LINE: ${leadData.customer_line}`);
  if (leadData.customer_instagram) contacts.push(`Instagram: ${leadData.customer_instagram}`);
  const contactStr = contacts.length > 0 ? contacts.join('\n  ') : 'N/A';

  const procedures = (translations.procedures_ko || leadData.procedures || []).join(', ') || 'N/A';
  const bodyParts = (translations.body_parts_ko || leadData.body_parts || []).join(', ') || 'N/A';
  const photoCount = (leadData.reference_photos || []).length;

  const medHistory = translations.medical_history_ko || leadData.medical_history || '미확인';
  const allergy = translations.allergies_ko || leadData.allergies || '미확인';
  const medications = translations.current_medications_ko || leadData.current_medications || '미확인';

  const budgetStr = leadData.budget_thb
    ? `${Number(leadData.budget_thb).toLocaleString()} THB${leadData.budget_krw ? ` (약 ${Number(leadData.budget_krw).toLocaleString()}원)` : ''}`
    : 'N/A';
  const preferredDate = translations.preferred_date_ko || leadData.preferred_date || 'N/A';
  const specialNotes = translations.special_notes_ko || leadData.special_notes || '없음';

  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  return `[견적 문의] 새 고객 - ${name} (#${ticketId})

■ 고객 정보
  이름: ${name}
  나이/성별: ${age} / ${gender}
  ${contactStr}

■ 시술 정보
  원하는 시술: ${procedures}
  시술 부위: ${bodyParts}
  참고 사진: ${photoCount > 0 ? `${photoCount}장` : '없음'}

■ 의료 정보
  과거 병력: ${medHistory}
  알레르기: ${allergy}
  복용 약물: ${medications}

■ 기타
  예산: ${budgetStr}
  희망 일정: ${preferredDate}
  특이사항: ${specialNotes}

─────────────────
담당 워커: ${workerName}
Zendesk 티켓: #${ticketId}
수집일시: ${now}`;
}
