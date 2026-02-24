-- Whisper(본사 지시) 메시지 기능
-- Supabase Dashboard → SQL Editor에서 실행

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS is_whisper boolean NOT NULL DEFAULT false;

-- client 역할에게 whisper 메시지 숨기기 (bbg_admin, worker는 전체 조회)
-- 기존 messages_select_authenticated 정책을 대체
DROP POLICY IF EXISTS "messages_select_authenticated" ON public.messages;
CREATE POLICY "messages_select_non_whisper" ON public.messages
  FOR SELECT USING (
    CASE
      WHEN EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'client')
      THEN is_whisper = false
      ELSE true
    END
  );
