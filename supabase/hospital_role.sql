-- Add hospital_prefix column to profiles for hospital role users
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS hospital_prefix text;

-- Example: To create a hospital user for TheBB:
-- UPDATE profiles SET role = 'hospital', hospital_prefix = 'thebb' WHERE email = 'thebb@hospital.com';
