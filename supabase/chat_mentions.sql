-- ============================================================
-- @멘션 기능 — messages에 mentions 컬럼 추가
-- Supabase Dashboard → SQL Editor에서 실행
-- ============================================================

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS mentions jsonb DEFAULT '[]';
