-- Allow authenticated users to read zendesk_conversations (required for Supabase Realtime)
CREATE POLICY "Authenticated users can read zendesk_conversations"
  ON zendesk_conversations
  FOR SELECT
  TO authenticated
  USING (true);
