-- RAG: pgvector 활성화 + case_index + case_conversations 테이블

CREATE EXTENSION IF NOT EXISTS vector;

-- 색인 원본 대화 보관 (검색 테이블과 분리하여 벡터 스캔 성능 확보)
CREATE TABLE IF NOT EXISTS case_conversations (
  ticket_id bigint PRIMARY KEY REFERENCES zendesk_tickets(ticket_id),
  conversation_full jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- RAG 검색 핵심 테이블 (경량화)
CREATE TABLE IF NOT EXISTS case_index (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id bigint NOT NULL UNIQUE REFERENCES zendesk_tickets(ticket_id),

  -- 검색용 (색인 시 AI가 태국어로 생성)
  search_summary text NOT NULL,        -- 태국어 구조화 요약 (한국어 시술명 병기)
  embedding vector(768),               -- search_summary의 임베딩 (Gemini text-embedding-004)

  -- AI 컨텍스트용
  key_turns jsonb NOT NULL,            -- 전환에 결정적이었던 3-5턴 (각 메시지 100자 이내)

  -- 필터용 메타데이터
  hospital_name text,
  procedure_category text,
  customer_concern text[],             -- 고객 주요 우려사항 태그

  -- 성공 지표
  quality_score integer,

  -- 색인 관리
  status text NOT NULL DEFAULT 'indexed',  -- 'indexed' | 'failed' | 'invalidated'
  embedding_model text NOT NULL DEFAULT 'text-embedding-004',

  created_at timestamptz DEFAULT now()
);

-- 초기에는 벡터 인덱스 생략 (1,000건 미만에서는 순차 스캔이 더 빠름)
-- 1,000건 이상 시:
-- CREATE INDEX idx_case_index_embedding
--   ON case_index USING ivfflat (embedding vector_cosine_ops)
--   WITH (lists = {sqrt(n)});

CREATE INDEX IF NOT EXISTS idx_case_index_hospital ON case_index(hospital_name);
CREATE INDEX IF NOT EXISTS idx_case_index_procedure ON case_index(procedure_category);
CREATE INDEX IF NOT EXISTS idx_case_index_status ON case_index(status);

-- RLS: 클라이언트 직접 접근 차단, API route(service_role_key)만 접근
ALTER TABLE case_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_conversations ENABLE ROW LEVEL SECURITY;
