CREATE TABLE IF NOT EXISTS delivery_order_extractions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL,
  customer_id UUID,
  product_level INTEGER,
  quantity INTEGER,
  recipient_name TEXT,
  phone TEXT,
  address TEXT,
  survey_name TEXT,
  payment_date DATE,
  payment_amount_krw INTEGER,
  confidence TEXT,
  sheet_row INTEGER,
  status TEXT DEFAULT 'extracted',
  raw_extraction JSONB,
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_extraction_conv ON delivery_order_extractions(conversation_id);
