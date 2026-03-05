-- Add description fields to tasks table
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description_th text;
