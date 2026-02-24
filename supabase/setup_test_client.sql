-- ============================================================
-- 테스트용 Client 및 Worker 할당 설정
-- ============================================================

-- 1. clients 테이블에 "테스트 병원" 추가
INSERT INTO clients (name) 
VALUES ('테스트 병원') 
ON CONFLICT DO NOTHING;

-- 2. admin@bbg.com을 client role로 변경하고 테스트 병원에 할당
UPDATE profiles 
SET 
  role = 'client',
  client_id = (SELECT id FROM clients WHERE name = '테스트 병원' LIMIT 1),
  display_name = '테스트 병원 담당자'
WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@bbg.com' LIMIT 1);

-- 3. worker@test.com을 테스트 병원에 할당 (profiles에 없으면 추가)
INSERT INTO profiles (id, role, email, display_name, client_id)
SELECT 
  au.id,
  'worker',
  'worker@test.com',
  '테스트 직원',
  (SELECT id FROM clients WHERE name = '테스트 병원' LIMIT 1)
FROM auth.users au
WHERE au.email = 'worker@test.com'
ON CONFLICT (id) DO UPDATE 
SET 
  role = 'worker',
  email = EXCLUDED.email,
  display_name = COALESCE(profiles.display_name, EXCLUDED.display_name),
  client_id = COALESCE(profiles.client_id, EXCLUDED.client_id);

-- 4. 확인용 쿼리
SELECT 
  p.id,
  p.role,
  p.email,
  p.display_name,
  c.name as client_name
FROM profiles p
LEFT JOIN clients c ON p.client_id = c.id
WHERE p.email IN ('admin@bbg.com', 'worker@test.com')
ORDER BY p.role, p.email;
