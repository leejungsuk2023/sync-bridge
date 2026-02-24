-- Worker가 업무를 제안할 수 있도록 tasks 테이블 확장
-- Supabase Dashboard → SQL Editor에서 실행

-- 1. source 컬럼 추가: 'client'(기존 기본값) / 'worker_proposed'
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'client'
  CHECK (source IN ('client', 'worker_proposed'));

-- 2. Worker INSERT RLS 정책: 본인을 assignee로 지정한 제안만 허용
CREATE POLICY "tasks_worker_propose" ON public.tasks
  FOR INSERT WITH CHECK (
    assignee_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'worker'
    )
  );
