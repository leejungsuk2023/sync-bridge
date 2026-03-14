-- Add survey_name to customers table for prescription notification matching
ALTER TABLE customers ADD COLUMN IF NOT EXISTS survey_name TEXT;
CREATE INDEX IF NOT EXISTS idx_customers_survey_name ON customers(survey_name) WHERE survey_name IS NOT NULL;
