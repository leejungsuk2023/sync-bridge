-- Track when each user last read each chat room/task
CREATE TABLE IF NOT EXISTS public.chat_read_status (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, task_id)
);

-- RLS
ALTER TABLE public.chat_read_status ENABLE ROW LEVEL SECURITY;

-- Users can read/write their own read status
CREATE POLICY "Users can manage their own read status"
  ON public.chat_read_status
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for fast unread count queries
CREATE INDEX IF NOT EXISTS idx_chat_read_status_user
  ON public.chat_read_status (user_id);
