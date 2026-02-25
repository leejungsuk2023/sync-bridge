import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn('SyncBridge: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing. Create .env in project folder.');
}

export const supabase = createClient(url || '', anonKey || '', {
  auth: { persistSession: true, storageKey: 'syncbridge-auth' },
});

/**
 * Worker가 업무를 제안 (Thai 원문 + 한국어 번역)
 * @param {string} userId - 현재 로그인된 worker의 user id
 * @param {string} contentTh - 태국어 원문
 * @param {string} contentKo - 한국어 번역 (없으면 원문 사용)
 */
export async function proposeTask(userId, contentTh, contentKo) {
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('client_id')
    .eq('id', userId)
    .single();

  if (profileErr || !profile?.client_id) {
    return { data: null, error: { message: 'ไม่พบข้อมูลบริษัท (소속 고객사를 찾을 수 없습니다)' } };
  }

  return supabase.from('tasks').insert({
    client_id: profile.client_id,
    assignee_id: userId,
    content: contentKo || contentTh,
    content_th: contentTh,
    source: 'worker_proposed',
  });
}
