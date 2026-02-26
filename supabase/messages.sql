-- 채팅 메시지 테이블
-- Supabase SQL Editor에서 실행
-- schema.sql 실행 후에 실행해야 함 (tasks 테이블 참조)

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id),
  content text NOT NULL,
  content_ko text,
  content_th text,
  sender_lang text NOT NULL DEFAULT 'th',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- 인증된 사용자 메시지 조회/전송
CREATE POLICY "messages_select_authenticated" ON public.messages
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "messages_insert_authenticated" ON public.messages
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_messages_task_id ON public.messages(task_id);

-- Realtime 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
