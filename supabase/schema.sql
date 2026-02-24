-- ============================================================
-- SyncBridge MVP: clients, profiles(users), time_logs, tasks + RLS
-- Supabase Dashboard → SQL Editor에서 전체 실행
-- ============================================================

-- 1. 고객사(병원) — client 담당자·worker 할당 단위
CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 2. 프로필(권한) — auth.users와 1:1, 역할·고객사 매핑
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('bbg_admin', 'client', 'worker')),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  display_name text,
  email text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 3. 근태 로그
CREATE TABLE IF NOT EXISTS public.time_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('online', 'away', 'offline')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_time_logs_worker_id ON public.time_logs(worker_id);
CREATE INDEX IF NOT EXISTS idx_time_logs_created_at ON public.time_logs(created_at DESC);

-- 4. 업무(Task)
CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  assignee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id ON public.tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);

-- ========== RLS ==========
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- profiles: 본인만 읽기/수정, BBG는 전체 읽기
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_select_bbg" ON public.profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'bbg_admin')
  );

-- clients: BBG 전체, client는 자사만
CREATE POLICY "clients_select_bbg" ON public.clients
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'bbg_admin')
  );
CREATE POLICY "clients_select_client" ON public.clients
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.client_id = clients.id)
  );
CREATE POLICY "clients_all_bbg" ON public.clients
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'bbg_admin')
  );

-- time_logs: worker는 본인만 insert/select, client·BBG는 담당 직원만 select
CREATE POLICY "time_logs_worker_own" ON public.time_logs
  FOR ALL USING (worker_id = auth.uid())
  WITH CHECK (worker_id = auth.uid());
CREATE POLICY "time_logs_client_select" ON public.time_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('client', 'bbg_admin')
      AND (p.role = 'bbg_admin' OR EXISTS (
        SELECT 1 FROM public.profiles w
        WHERE w.id = time_logs.worker_id AND w.client_id = p.client_id
      ))
    )
  );

-- tasks: client·BBG는 생성/조회/수정, worker는 본인 담당만 조회·완료
CREATE POLICY "tasks_client_insert" ON public.tasks
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('client', 'bbg_admin'))
  );
CREATE POLICY "tasks_select_assignee" ON public.tasks
  FOR SELECT USING (assignee_id = auth.uid());
CREATE POLICY "tasks_select_client" ON public.tasks
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.client_id = tasks.client_id OR p.role = 'bbg_admin'))
  );
CREATE POLICY "tasks_update_assignee" ON public.tasks
  FOR UPDATE USING (assignee_id = auth.uid())
  WITH CHECK (assignee_id = auth.uid());
CREATE POLICY "tasks_update_client" ON public.tasks
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.client_id = tasks.client_id OR p.role = 'bbg_admin'))
  );

-- ========== Realtime (tasks 변경 시 알림) ==========
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
