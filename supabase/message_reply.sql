-- Add reply_to column to messages table for reply threading
SET ROLE postgres;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to uuid REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON public.messages(reply_to);

-- Update policy for messages to allow updating (for adding translations to replies)
DROP POLICY IF EXISTS "messages_update_authenticated" ON public.messages;
CREATE POLICY "messages_update_authenticated" ON public.messages
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
