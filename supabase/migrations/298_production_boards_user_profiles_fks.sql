-- Production Boards user-attribution FKs — re-target user_profiles(id).
--
-- Problem
-- -------
-- Migrations 295 (production-boards core) and 296 (sqcdp_chart_type) created
-- user-attribution columns whose foreign keys point at `auth.users(id)`:
--
--     sqcdp_problems.assigned_to            -> auth.users(id)
--     sqcdp_problems.reported_by            -> auth.users(id)
--     sqcdp_metrics.created_by              -> auth.users(id)
--     sqcdp_metrics.updated_by              -> auth.users(id)
--     production_board_posts.posted_by     -> auth.users(id)
--     production_board_post_acks.user_id   -> auth.users(id)
--     production_board_job_postings.posted_by -> auth.users(id)
--
-- PostgREST can only auto-discover (and therefore embed) relationships that
-- are declared by FK constraints whose target table lives in an exposed
-- schema (`public` here). FKs that target `auth.users` are invisible to its
-- relationship cache, which is why the browser saw a stream of:
--
--     PGRST200: Could not find a relationship between
--     'sqcdp_problems' and 'user_profiles' in the schema cache
--
-- every 60 s as the SQCDP problems poll fired.
--
-- Fix
-- ---
-- `public.user_profiles.id` is itself defined as `id REFERENCES
-- auth.users(id) ON DELETE CASCADE`, with a row inserted by trigger for
-- every new auth user. So the set of valid `user_profiles.id` values is
-- exactly the set of valid `auth.users.id` values, and we can swap the FK
-- target with no data loss. We verified zero orphan rows on every
-- affected column before applying this migration.
--
-- Why swap rather than add a SECOND FK
-- ------------------------------------
-- PostgREST picks one relationship per (source-column, target-column)
-- pair when resolving an embed. With two FKs on the same source column
-- (one to auth.users, one to user_profiles) the embed would either
-- ambiguously hint or stay 400. A clean swap is the simplest robust
-- answer; transitively the auth.users link is preserved through
-- user_profiles.id_fkey.
--
-- See:
--   memorybank/OmniFrame/Debug/Fix-Sqcdp-Problems-PostgREST-Embed.md
--   memorybank/OmniFrame/Implementations/Implement-Production-Boards-Hourly-Grid.md (v11)

BEGIN;

-- sqcdp_problems
ALTER TABLE public.sqcdp_problems
  DROP CONSTRAINT IF EXISTS sqcdp_problems_assigned_to_fkey;
ALTER TABLE public.sqcdp_problems
  ADD CONSTRAINT sqcdp_problems_assigned_to_fkey
  FOREIGN KEY (assigned_to) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.sqcdp_problems
  DROP CONSTRAINT IF EXISTS sqcdp_problems_reported_by_fkey;
ALTER TABLE public.sqcdp_problems
  ADD CONSTRAINT sqcdp_problems_reported_by_fkey
  FOREIGN KEY (reported_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- sqcdp_metrics
ALTER TABLE public.sqcdp_metrics
  DROP CONSTRAINT IF EXISTS sqcdp_metrics_created_by_fkey;
ALTER TABLE public.sqcdp_metrics
  ADD CONSTRAINT sqcdp_metrics_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.sqcdp_metrics
  DROP CONSTRAINT IF EXISTS sqcdp_metrics_updated_by_fkey;
ALTER TABLE public.sqcdp_metrics
  ADD CONSTRAINT sqcdp_metrics_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- production_board_posts
ALTER TABLE public.production_board_posts
  DROP CONSTRAINT IF EXISTS production_board_posts_posted_by_fkey;
ALTER TABLE public.production_board_posts
  ADD CONSTRAINT production_board_posts_posted_by_fkey
  FOREIGN KEY (posted_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- production_board_post_acks
ALTER TABLE public.production_board_post_acks
  DROP CONSTRAINT IF EXISTS production_board_post_acks_user_id_fkey;
ALTER TABLE public.production_board_post_acks
  ADD CONSTRAINT production_board_post_acks_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;

-- production_board_job_postings
ALTER TABLE public.production_board_job_postings
  DROP CONSTRAINT IF EXISTS production_board_job_postings_posted_by_fkey;
ALTER TABLE public.production_board_job_postings
  ADD CONSTRAINT production_board_job_postings_posted_by_fkey
  FOREIGN KEY (posted_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

COMMIT;

-- Force PostgREST to refresh its schema cache so the new embeddable
-- relationships are visible to the browser without a service restart.
NOTIFY pgrst, 'reload schema';
