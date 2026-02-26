-- ============================================================
-- RLS 정책 수정 — messages UPDATE + profiles 동료 조회
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
-- 2. profiles SELECT 정책 추가
-- 같은 client_id 소속 사용자끼리 프로필 조회 허용 (그룹 채팅 발신자 이름 표시)
-- =====================
CREATE POLICY "profiles_select_same_client" ON public.profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND p.client_id IS NOT NULL
      AND p.client_id = profiles.client_id
    )
  );

-- =====================
-- 3. worker도 해당 client_id의 profiles 조회 가능 (현재 own + bbg_admin만 가능)
-- client 역할도 같은 조직 직원 프로필 볼 수 있도록
-- 위 정책(profiles_select_same_client)이 이미 커버함
-- =====================

-- =====================
-- 확인용 쿼리: messages 테이블 정책 목록
-- =====================
SELECT policyname, cmd, permissive, roles, qual
FROM pg_policies
WHERE tablename = 'messages'
ORDER BY policyname;

-- 확인용 쿼리: profiles 테이블 정책 목록
SELECT policyname, cmd, permissive, roles, qual
FROM pg_policies
WHERE tablename = 'profiles'
ORDER BY policyname;
