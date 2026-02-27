-- ============================================================
-- 채팅 파일 첨부 기능 — messages 컬럼 추가 + Storage RLS
-- Supabase Dashboard → SQL Editor에서 실행
-- ============================================================

-- 1. messages 테이블에 파일 관련 컬럼 추가
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_url text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_name text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_type text;

-- 2. Storage RLS 정책 (chat-files 버킷)
-- 인증된 사용자 누구나 업로드 가능
INSERT INTO storage.buckets (id, name, public) 
VALUES ('chat-files', 'chat-files', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "chat_files_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-files');

CREATE POLICY "chat_files_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'chat-files');

CREATE POLICY "chat_files_public_read" ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'chat-files');
