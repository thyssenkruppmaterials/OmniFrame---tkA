-- =====================================================
-- Standard Work hardening
-- Migration: 234_standard_work_hardening.sql
-- Created:   April 25, 2026
-- Purpose:
--   1) Tighten standard_work_responses RLS so users cannot upsert other
--      users' response rows merely by being in the same organization.
--   2) Restrict the "Managers can manage templates" / items policies that
--      were named for managers but evaluated against any org member.
--   3) Add a partial index supporting the "open draft for today" lookup
--      used by the runner to resume rather than create parallel drafts.
--   4) Provision the `standard-work-attachments` storage bucket used by
--      photo and signature checklist items, with org-scoped RLS.
-- =====================================================

-- 1) Responses RLS -----------------------------------------------------------
-- The original policy let any user in the same organization manage any
-- response row. We replace it with submission-ownership scoping plus a
-- supervisor/manager carve-out so escalations still work.

DROP POLICY IF EXISTS "Users can manage responses for their submissions" ON public.standard_work_responses;
DROP POLICY IF EXISTS "swr_select_org" ON public.standard_work_responses;
DROP POLICY IF EXISTS "swr_insert_owner_or_manager" ON public.standard_work_responses;
DROP POLICY IF EXISTS "swr_update_owner_or_manager" ON public.standard_work_responses;
DROP POLICY IF EXISTS "swr_delete_owner_or_manager" ON public.standard_work_responses;

-- View remains org-scoped so QA/managers can review history.
CREATE POLICY "swr_select_org" ON public.standard_work_responses
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "swr_insert_owner_or_manager" ON public.standard_work_responses
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.standard_work_submissions s
            WHERE s.id = submission_id
              AND s.organization_id = standard_work_responses.organization_id
              AND (
                  s.submitted_by = auth.uid()
                  OR s.organization_id IN (
                      SELECT up.organization_id
                      FROM public.user_profiles up
                      WHERE up.id = auth.uid()
                        AND up.role IN ('superadmin', 'admin', 'manager')
                  )
              )
        )
    );

CREATE POLICY "swr_update_owner_or_manager" ON public.standard_work_responses
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.standard_work_submissions s
            WHERE s.id = submission_id
              AND (
                  s.submitted_by = auth.uid()
                  OR s.organization_id IN (
                      SELECT up.organization_id
                      FROM public.user_profiles up
                      WHERE up.id = auth.uid()
                        AND up.role IN ('superadmin', 'admin', 'manager')
                  )
              )
        )
    ) WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.standard_work_submissions s
            WHERE s.id = submission_id
              AND (
                  s.submitted_by = auth.uid()
                  OR s.organization_id IN (
                      SELECT up.organization_id
                      FROM public.user_profiles up
                      WHERE up.id = auth.uid()
                        AND up.role IN ('superadmin', 'admin', 'manager')
                  )
              )
        )
    );

CREATE POLICY "swr_delete_owner_or_manager" ON public.standard_work_responses
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.standard_work_submissions s
            WHERE s.id = submission_id
              AND (
                  s.submitted_by = auth.uid()
                  OR s.organization_id IN (
                      SELECT up.organization_id
                      FROM public.user_profiles up
                      WHERE up.id = auth.uid()
                        AND up.role IN ('superadmin', 'admin', 'manager')
                  )
              )
        )
    );

-- 2) Templates / items: enforce the "manager" name on the policy ------------
-- The original policies were called "Managers can manage…" but had no role
-- predicate. Replace them with proper role-gated ALL policies.

DROP POLICY IF EXISTS "Managers can manage templates in their organization" ON public.standard_work_templates;
DROP POLICY IF EXISTS "swt_manager_all" ON public.standard_work_templates;

CREATE POLICY "swt_manager_all" ON public.standard_work_templates
    FOR ALL USING (
        organization_id IN (
            SELECT up.organization_id
            FROM public.user_profiles up
            WHERE up.id = auth.uid()
              AND up.role IN (
                  'superadmin', 'admin', 'manager',
                  'tka_supervisors', 'tka_leaders', 'tka_branchcoordinator'
              )
        )
    ) WITH CHECK (
        organization_id IN (
            SELECT up.organization_id
            FROM public.user_profiles up
            WHERE up.id = auth.uid()
              AND up.role IN (
                  'superadmin', 'admin', 'manager',
                  'tka_supervisors', 'tka_leaders', 'tka_branchcoordinator'
              )
        )
    );

DROP POLICY IF EXISTS "Managers can manage items in their organization" ON public.standard_work_items;
DROP POLICY IF EXISTS "swi_manager_all" ON public.standard_work_items;

CREATE POLICY "swi_manager_all" ON public.standard_work_items
    FOR ALL USING (
        organization_id IN (
            SELECT up.organization_id
            FROM public.user_profiles up
            WHERE up.id = auth.uid()
              AND up.role IN (
                  'superadmin', 'admin', 'manager',
                  'tka_supervisors', 'tka_leaders', 'tka_branchcoordinator'
              )
        )
    ) WITH CHECK (
        organization_id IN (
            SELECT up.organization_id
            FROM public.user_profiles up
            WHERE up.id = auth.uid()
              AND up.role IN (
                  'superadmin', 'admin', 'manager',
                  'tka_supervisors', 'tka_leaders', 'tka_branchcoordinator'
              )
        )
    );

-- 3) Partial index for "open drafts today" ----------------------------------
-- Speeds up findOpenDraft / dashboard-tasks bucket calculation that filters
-- on (organization_id, template_id, shift_date, submitted_by) where status
-- is in ('draft','in_progress').

CREATE INDEX IF NOT EXISTS idx_sw_submissions_open_drafts
    ON public.standard_work_submissions (organization_id, template_id, shift_date, submitted_by)
    WHERE status IN ('draft', 'in_progress');

-- 4) Storage bucket for photo / signature checklist items -------------------
-- Public read (so submission review pages can display the photo without
-- requiring storage tokens), authenticated write scoped by organization id
-- prefix.

INSERT INTO storage.buckets (id, name, public)
VALUES ('standard-work-attachments', 'standard-work-attachments', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "sw_attachments_read" ON storage.objects;
DROP POLICY IF EXISTS "sw_attachments_insert" ON storage.objects;
DROP POLICY IF EXISTS "sw_attachments_update" ON storage.objects;
DROP POLICY IF EXISTS "sw_attachments_delete" ON storage.objects;

-- Anyone in the org can read (bucket is public, but keep an explicit policy
-- to allow future tightening to authenticated-only without rewriting code).
CREATE POLICY "sw_attachments_read" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'standard-work-attachments'
    );

-- Inserts must place the object under the user's own organization id
-- prefix (the first path segment).
CREATE POLICY "sw_attachments_insert" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'standard-work-attachments'
        AND auth.uid() IS NOT NULL
        AND (storage.foldername(name))[1] IN (
            SELECT up.organization_id::text
            FROM public.user_profiles up
            WHERE up.id = auth.uid()
        )
    );

CREATE POLICY "sw_attachments_update" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'standard-work-attachments'
        AND auth.uid() IS NOT NULL
        AND (storage.foldername(name))[1] IN (
            SELECT up.organization_id::text
            FROM public.user_profiles up
            WHERE up.id = auth.uid()
        )
    );

CREATE POLICY "sw_attachments_delete" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'standard-work-attachments'
        AND auth.uid() IS NOT NULL
        AND (storage.foldername(name))[1] IN (
            SELECT up.organization_id::text
            FROM public.user_profiles up
            WHERE up.id = auth.uid()
        )
    );

-- =====================================================
-- Documentation: streak edge cases
--   `update_user_streak` (migration 098) increments on consecutive
--   *calendar* days. There is no weekend skip / holiday freeze. If product
--   wants either, gate the streak increment on whether the missed day was
--   in `standard_work_holidays` (not yet present) or part of the user's
--   off-shift schedule.
-- =====================================================
