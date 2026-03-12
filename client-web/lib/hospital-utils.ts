// Hospital Knowledge Base utilities
// Consolidates HOSPITAL_NAMES map and hospital prefix logic from 4 files:
// - app/api/zendesk/stats/route.ts
// - app/api/zendesk/hospital-stats/route.ts
// - app/api/zendesk/insights/route.ts
// - components/HospitalDashboard.tsx

import { SupabaseClient } from '@supabase/supabase-js';

// --- Types ---

export interface HospitalInfo {
  id: string;
  client_id: string | null;
  hospital_prefix: string;
  display_name_ko: string | null;
  display_name_th: string | null;
  address_ko: string | null;
  address_th: string | null;
  google_maps_url: string | null;
  phone: string | null;
  website: string | null;
  operating_hours: Record<string, string> | null;
  logo_url: string | null;
  description_ko: string | null;
  description_th: string | null;
  specialties: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface HospitalDoctor {
  id: string;
  hospital_id: string;
  name_ko: string;
  name_th: string | null;
  title_ko: string | null;
  title_th: string | null;
  specialties: string[] | null;
  bio_ko: string | null;
  bio_th: string | null;
  photo_url: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface HospitalProcedure {
  id: string;
  hospital_id: string;
  category: string;
  name_ko: string;
  name_th: string | null;
  description_ko: string | null;
  description_th: string | null;
  price_min: number | null;
  price_max: number | null;
  price_currency: string;
  price_note: string | null;
  duration_minutes: number | null;
  recovery_days: number | null;
  is_popular: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface HospitalPromotion {
  id: string;
  hospital_id: string;
  title_ko: string;
  title_th: string | null;
  description_ko: string | null;
  description_th: string | null;
  discount_type: string | null;
  discount_value: number | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
}

export interface SuccessfulCase {
  id: string;
  hospital_id: string;
  zendesk_ticket_id: number | null;
  conversation_id: string | null;
  procedure_category: string | null;
  procedure_name_ko: string | null;
  procedure_name_th: string | null;
  customer_concern: string | null;
  customer_concern_th: string | null;
  outcome: string | null;
  full_conversation: string;
  contextual_summary: string | null;
  tags: string[] | null;
  quality_score: number | null;
  is_verified: boolean;
  is_masked: boolean;
}

export interface HospitalKBContext {
  hospitalInfo: HospitalInfo | null;
  doctors: Pick<HospitalDoctor, 'name_th' | 'title_th' | 'specialties'>[];
  procedures: Pick<HospitalProcedure, 'name_th' | 'category' | 'price_min' | 'price_max' | 'price_currency' | 'price_note' | 'is_popular'>[];
  activePromotions: Pick<HospitalPromotion, 'title_th' | 'description_th' | 'discount_type' | 'discount_value' | 'ends_at'>[];
  successfulCases: Pick<SuccessfulCase, 'full_conversation' | 'contextual_summary' | 'procedure_name_th' | 'outcome'>[];
}

// --- Constants ---

// Hospital tag prefix -> display name mapping (consolidated from 4 files)
export const HOSPITAL_NAMES: Record<string, string> = {
  thebb: 'TheBB',
  delphic: 'Delphic Clinic',
  will: 'Will Plastic Surgery',
  mikclinicthai: 'MikClinic',
  jyclinicthai: 'JY Clinic',
  du: 'DU Plastic Surgery',
  koreandiet: 'Korean Diet',
  ourpthai: 'OURP',
  everbreastthai: 'EverBreast',
  clyveps_th: 'Clyveps',
  mycell: 'Mycell Clinic',
  nbclinici: 'NB Clinic',
  'dr.song': 'Dr. Song',
  lacela: 'Lacela',
  artline: 'Artline',
  kleam: 'Kleam',
};

// Sorted longest-first so longer prefixes match before shorter ones (e.g. "mikclinicthai" before "mik")
const KNOWN_PREFIXES = Object.keys(HOSPITAL_NAMES).sort((a, b) => b.length - a.length);

// --- Core helpers ---

/**
 * Extract hospital prefix from an array of Zendesk tags.
 * Tags can be exact prefix ("thebb") or prefixed with underscore ("thebb_fb").
 * Returns the first matching hospital prefix, or null if none found.
 */
export function extractHospitalPrefix(tags: string[]): string | null {
  for (const tag of tags) {
    for (const prefix of KNOWN_PREFIXES) {
      if (tag === prefix || tag.startsWith(prefix + '_')) {
        return prefix;
      }
    }
  }
  return null;
}

/**
 * Get the display name for a hospital prefix.
 * Falls back to the prefix itself if not in the map.
 */
export function getHospitalDisplayName(prefix: string): string {
  return HOSPITAL_NAMES[prefix] ?? prefix;
}

// --- DB fetch ---

/**
 * Fetch all Hospital KB data for a given hospital prefix in parallel.
 * Uses the passed supabaseAdmin client (service role) — server-side only.
 *
 * Returns null hospitalInfo if the hospital is not yet in the DB.
 * Doctors/procedures/promotions/cases are empty arrays in that case.
 */
export async function fetchHospitalKBContext(
  supabaseAdmin: SupabaseClient,
  hospitalPrefix: string
): Promise<HospitalKBContext> {
  // 1. Fetch hospital_info first (need its id for subsequent queries)
  const { data: hospitalInfo } = await supabaseAdmin
    .from('hospital_info')
    .select('*')
    .eq('hospital_prefix', hospitalPrefix)
    .single();

  if (!hospitalInfo) {
    return {
      hospitalInfo: null,
      doctors: [],
      procedures: [],
      activePromotions: [],
      successfulCases: [],
    };
  }

  const today = new Date().toISOString().slice(0, 10);

  // 2. Parallel fetch of doctors, procedures, promotions, successful cases
  const [doctorsRes, proceduresRes, promotionsRes, casesRes] = await Promise.all([
    // Doctors (limit 5, active only)
    supabaseAdmin
      .from('hospital_doctors')
      .select('name_th, title_th, specialties')
      .eq('hospital_id', hospitalInfo.id)
      .eq('is_active', true)
      .order('sort_order')
      .limit(5),

    // Procedures (popular first, limit 15, active only)
    supabaseAdmin
      .from('hospital_procedures')
      .select('name_th, category, price_min, price_max, price_currency, price_note, is_popular')
      .eq('hospital_id', hospitalInfo.id)
      .eq('is_active', true)
      .order('is_popular', { ascending: false })
      .order('sort_order')
      .limit(15),

    // Active promotions (ongoing or no end date)
    supabaseAdmin
      .from('hospital_promotions')
      .select('title_th, description_th, discount_type, discount_value, ends_at')
      .eq('hospital_id', hospitalInfo.id)
      .eq('is_active', true)
      .or(`ends_at.is.null,ends_at.gte.${today}`),

    // Verified successful cases (best quality first, limit 2)
    supabaseAdmin
      .from('successful_cases')
      .select('full_conversation, contextual_summary, procedure_name_th, outcome')
      .eq('hospital_id', hospitalInfo.id)
      .eq('is_verified', true)
      .order('quality_score', { ascending: false })
      .limit(2),
  ]);

  return {
    hospitalInfo: hospitalInfo as HospitalInfo,
    doctors: (doctorsRes.data ?? []) as HospitalKBContext['doctors'],
    procedures: (proceduresRes.data ?? []) as HospitalKBContext['procedures'],
    activePromotions: (promotionsRes.data ?? []) as HospitalKBContext['activePromotions'],
    successfulCases: (casesRes.data ?? []) as HospitalKBContext['successfulCases'],
  };
}
