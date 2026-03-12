-- ============================================================
-- Staff Hierarchy Migration
-- - profiles: hierarchy_level, team 컬럼 추가, role에 'staff' 추가
-- - tasks: client_id NOT NULL 해제, source에 'staff' 추가, request_type 추가
-- - RLS 정책: staff 포함 업데이트
-- - 기존 직원 데이터 마이그레이션
-- ============================================================

-- Elevate to postgres role for DDL permissions
SET ROLE postgres;

-- ============================================================
-- 1. profiles 테이블 변경
-- ============================================================

-- hierarchy_level, team 컬럼 추가
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hierarchy_level int,
  ADD COLUMN IF NOT EXISTS team text;

-- hierarchy_level 인덱스
CREATE INDEX IF NOT EXISTS idx_profiles_hierarchy_level ON public.profiles(hierarchy_level);

-- role CHECK 제약조건에 'staff' 추가 (DROP 후 재생성)
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('bbg_admin', 'client', 'worker', 'staff', 'hospital'));

-- ============================================================
-- 2. tasks 테이블 변경
-- ============================================================

-- client_id NOT NULL 제거
ALTER TABLE public.tasks ALTER COLUMN client_id DROP NOT NULL;

-- source CHECK 제약조건에 'staff' 추가 (DROP 후 재생성)
-- 기존: 'client', 'worker_proposed' → 신규: 'client', 'worker_proposed', 'bbg_admin', 'staff'
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_source_check
  CHECK (source IN ('client', 'worker_proposed', 'bbg_admin', 'staff'));

-- request_type 컬럼 추가
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS request_type text DEFAULT 'directive'
  CHECK (request_type IN ('directive', 'cooperation'));

-- ============================================================
-- 3. RLS 정책 업데이트
-- ============================================================

-- --- tasks INSERT: staff도 업무 생성 가능 ---
DROP POLICY IF EXISTS "tasks_client_insert" ON public.tasks;
CREATE POLICY "tasks_client_insert" ON public.tasks
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('client', 'bbg_admin', 'staff')
    )
  );

-- --- tasks SELECT: assignee_id OR created_by ---
DROP POLICY IF EXISTS "tasks_select_assignee" ON public.tasks;
CREATE POLICY "tasks_select_assignee" ON public.tasks
  FOR SELECT USING (
    assignee_id = auth.uid()
    OR created_by = auth.uid()
  );

-- --- tasks UPDATE: assignee_id OR created_by ---
DROP POLICY IF EXISTS "tasks_update_assignee" ON public.tasks;
CREATE POLICY "tasks_update_assignee" ON public.tasks
  FOR UPDATE USING (
    assignee_id = auth.uid()
    OR created_by = auth.uid()
  )
  WITH CHECK (
    assignee_id = auth.uid()
    OR created_by = auth.uid()
  );

-- --- profiles SELECT: 인증된 사용자는 프로필 조회 가능 ---
-- NOTE: 이전 profiles_select_bbg 정책은 profiles 테이블 자기참조로 무한 재귀 발생.
-- profiles_select_authenticated 정책이 이미 존재하므로 추가 정책 불필요.
-- DROP POLICY IF EXISTS "profiles_select_bbg" ON public.profiles; (이미 삭제됨)

-- ============================================================
-- 4. 기존 직원 데이터 마이그레이션
-- ============================================================

-- jungseok (bbg_admin 유지) → hierarchy_level=10
UPDATE public.profiles
SET hierarchy_level = 10
WHERE email = 'jungseok@bbg.com';

-- juhee (bbg_admin → staff) → hierarchy_level=20
UPDATE public.profiles
SET role = 'staff', hierarchy_level = 20
WHERE email = 'juhee@bbg.com';

-- surin (bbg_admin → staff) → hierarchy_level=30, team='operations'
UPDATE public.profiles
SET role = 'staff', hierarchy_level = 30, team = 'operations'
WHERE email = 'surin@bbg.com';

-- yanggeun (client → staff) → hierarchy_level=30, team='business_admin'
UPDATE public.profiles
SET role = 'staff', hierarchy_level = 30, team = 'business_admin'
WHERE email = 'yanggeun@bbg.com';

-- sumin (client → staff) → hierarchy_level=40
UPDATE public.profiles
SET role = 'staff', hierarchy_level = 40
WHERE email = 'sumin@bbg.com';

-- nikki (client → staff) → hierarchy_level=40
-- Note: 'nicky' 요구사항이지만 실제 DB 이메일은 nikki@bbg.com
UPDATE public.profiles
SET role = 'staff', hierarchy_level = 40
WHERE email = 'nikki@bbg.com';

-- 태국 직원 (worker) → hierarchy_level=100
UPDATE public.profiles
SET hierarchy_level = 100
WHERE role = 'worker';
