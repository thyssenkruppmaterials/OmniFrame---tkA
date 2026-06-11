-- =====================================================
-- Migration: Ensure GRS Photos Bucket is Public
-- Version: 073
-- Description: Ensures grs-photos storage bucket is set to public for photo display
-- Date: November 22, 2025
-- =====================================================

-- Create the grs-photos bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('grs-photos', 'grs-photos', true)
ON CONFLICT (id) DO UPDATE
SET public = true;

-- Add bucket comment
COMMENT ON TABLE storage.buckets IS 
  'Storage buckets for Supabase Storage. grs-photos bucket stores photos from GRS cycle count unknown batches.';

-- Drop existing policies if they exist
DO $$ 
BEGIN
  DROP POLICY IF EXISTS "Authenticated users can upload to grs-photos" ON storage.objects;
  DROP POLICY IF EXISTS "Authenticated users can view grs-photos" ON storage.objects;
  DROP POLICY IF EXISTS "Public can view grs-photos" ON storage.objects;
  DROP POLICY IF EXISTS "Authenticated users can update grs-photos" ON storage.objects;
  DROP POLICY IF EXISTS "Admins can delete grs-photos" ON storage.objects;
END $$;

-- Create storage policy to allow authenticated users to upload
CREATE POLICY "Authenticated users can upload to grs-photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'grs-photos');

-- Create storage policy to allow authenticated users to view
CREATE POLICY "Authenticated users can view grs-photos"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'grs-photos');

-- Create storage policy to allow public access
CREATE POLICY "Public can view grs-photos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'grs-photos');

-- Create storage policy to allow authenticated users to update
CREATE POLICY "Authenticated users can update grs-photos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'grs-photos');

-- Create storage policy to allow admins to delete
CREATE POLICY "Admins can delete grs-photos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'grs-photos' 
  AND EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role IN ('superadmin', 'admin', 'manager')
  )
);

-- =====================================================
-- End of Migration 073
-- =====================================================

