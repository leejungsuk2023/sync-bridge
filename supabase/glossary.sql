-- Glossary table for medical/business term translations (Korean ↔ Thai)
-- Used by the translate API to ensure consistent terminology

CREATE TABLE IF NOT EXISTS public.glossary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  korean text NOT NULL,
  thai text NOT NULL,
  category text DEFAULT 'general',
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.glossary ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read glossary
CREATE POLICY "Authenticated users can read glossary"
  ON public.glossary FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only bbg_admin can insert/update/delete
CREATE POLICY "Admin can manage glossary"
  ON public.glossary FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'bbg_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'bbg_admin'
    )
  );

CREATE INDEX IF NOT EXISTS idx_glossary_korean ON public.glossary (korean);
CREATE INDEX IF NOT EXISTS idx_glossary_category ON public.glossary (category);

-- Unique constraint to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_glossary_korean_thai ON public.glossary (korean, thai);
