-- Migration: 213_create_sap_transaction_logs
-- Date: 2026-04-02
-- Purpose: Create table to log SAP GUI transactions executed via the OneBox SAP Bridge HTA.
--          Records Post Goods Issue (VL02N) and other SAP transactions triggered from the app.

-- Create enum for SAP transaction status
DO $$ BEGIN
    CREATE TYPE public.sap_transaction_status AS ENUM ('success', 'error', 'skipped', 'pending');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Create the sap_transaction_logs table
CREATE TABLE IF NOT EXISTS public.sap_transaction_logs (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    delivery_id     TEXT NOT NULL,
    transaction_code TEXT NOT NULL,               -- e.g. 'VL02N'
    action          TEXT NOT NULL,                 -- e.g. 'post_goods_issue'
    status          sap_transaction_status NOT NULL DEFAULT 'pending',
    sap_message     TEXT,                          -- status bar message from SAP
    executed_by     UUID REFERENCES auth.users(id),
    organization_id UUID NOT NULL REFERENCES public.organizations(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sap_tx_logs_delivery ON public.sap_transaction_logs(delivery_id);
CREATE INDEX IF NOT EXISTS idx_sap_tx_logs_org ON public.sap_transaction_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_sap_tx_logs_created ON public.sap_transaction_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sap_tx_logs_status ON public.sap_transaction_logs(status);

-- RLS
ALTER TABLE public.sap_transaction_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sap_tx_logs_select_own_org"
    ON public.sap_transaction_logs
    FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "sap_tx_logs_insert_own_org"
    ON public.sap_transaction_logs
    FOR INSERT
    WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "sap_tx_logs_update_own_org"
    ON public.sap_transaction_logs
    FOR UPDATE
    USING (
        organization_id IN (
            SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
        )
    );

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_sap_tx_logs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_sap_tx_logs_updated_at
    BEFORE UPDATE ON public.sap_transaction_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_sap_tx_logs_updated_at();
