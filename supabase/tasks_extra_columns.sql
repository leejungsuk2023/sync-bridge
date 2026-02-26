-- tasks 테이블 추가 컬럼 (번역 + 마감일)
-- Supabase SQL Editor에서 실행
-- schema.sql 실행 후에 실행해야 함

-- 태국어 번역 컬럼
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS content_th text;

-- 마감일 컬럼 (날짜만, 시간 없음)
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS due_date date;
