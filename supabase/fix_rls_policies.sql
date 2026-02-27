-- ============================================================
-- RLS 정책 수정 — messages UPDATE 정책 추가
-- Supabase Dashboard → SQL Editor에서 실행
-- ============================================================

-- =====================
-- 1. messages UPDATE 정책 추가
-- 번역 완료 후 content_ko/content_th 업데이트에 필요
-- =====================
CREATE POLICY "messages_update_sender" ON public.messages
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());

-- =====================
-- 참고: profiles SELECT는 profiles_select_authenticated 정책이
-- 이미 모든 인증 사용자에게 전체 프로필 조회를 허용하므로 추가 불필요.
-- (profiles 자기참조 정책은 무한 재귀를 유발하므로 사용하지 않음)
-- =====================
