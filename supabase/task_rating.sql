-- 업무 품질 평가 (QA & Rating)
-- Supabase SQL Editor에서 실행

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS rating int CHECK (rating >= 1 AND rating <= 5);
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS rated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS rated_at timestamptz;
