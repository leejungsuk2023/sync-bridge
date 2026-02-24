-- 업무 지시 프리셋 (Task Preset)
-- Supabase SQL Editor에서 실행

CREATE TABLE IF NOT EXISTS public.task_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  title_ko text NOT NULL,
  title_th text,
  content_ko text NOT NULL,
  content_th text,
  display_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.task_presets ENABLE ROW LEVEL SECURITY;

-- bbg_admin: 전체 CRUD
CREATE POLICY "task_presets_bbg_all" ON public.task_presets
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'bbg_admin')
  );

-- client: 자기 병원 + 글로벌(client_id IS NULL) 조회만
CREATE POLICY "task_presets_client_select" ON public.task_presets
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'client'
      AND (task_presets.client_id = p.client_id OR task_presets.client_id IS NULL)
    )
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.task_presets;
