-- v1.4 Improvements: created_by column for task assigner tracking
-- Run this in Supabase Dashboard SQL Editor

-- 1. Add created_by column to track who assigned the task
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS created_by uuid;

-- Done. due_date is already timestamptz, no type change needed.
