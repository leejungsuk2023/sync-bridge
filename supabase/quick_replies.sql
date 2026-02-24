-- 퀵 리플라이(자동답변) 테이블
-- Supabase SQL Editor에서 실행
CREATE TABLE IF NOT EXISTS public.quick_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  title_ko text NOT NULL,
  title_th text,
  body_ko text NOT NULL,
  body_th text,
  display_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quick_replies_client_id ON public.quick_replies(client_id);

ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;

-- BBG: 전체 CRUD
CREATE POLICY "quick_replies_bbg_all" ON public.quick_replies
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'bbg_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'bbg_admin'));

-- client: 자사 것만 CRUD (client_id = 본인 client_id)
CREATE POLICY "quick_replies_client_all" ON public.quick_replies
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.client_id = quick_replies.client_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.client_id = quick_replies.client_id));

-- worker: client_id 일치 또는 null(전사 공용)인 것 읽기
CREATE POLICY "quick_replies_worker_select" ON public.quick_replies
  FOR SELECT USING (
    quick_replies.client_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.profiles w
      WHERE w.id = auth.uid() AND w.role = 'worker' AND w.client_id = quick_replies.client_id
    )
  );
