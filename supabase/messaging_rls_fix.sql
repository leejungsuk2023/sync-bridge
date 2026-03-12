-- Fix RLS policies for messaging tables
-- Allows authenticated users (workers, clients, admins) to read data
-- that was previously service-role only.

-- conversation_analyses: add read access for authenticated users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'conversation_analyses'
      AND policyname = 'Authenticated users can read conversation_analyses'
  ) THEN
    CREATE POLICY "Authenticated users can read conversation_analyses"
      ON conversation_analyses FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

-- customers: add read access for authenticated users
-- (needed for channel_conversations -> customers join in AISuggestPanel)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'customers'
      AND policyname = 'Authenticated users can read customers'
  ) THEN
    CREATE POLICY "Authenticated users can read customers"
      ON customers FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;
