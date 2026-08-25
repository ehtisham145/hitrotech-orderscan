-- Create employees_advances table
CREATE TABLE IF NOT EXISTS public.employees_advances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    amount DECIMAL(12, 2) NOT NULL,
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    description TEXT,
    is_settled BOOLEAN NOT NULL DEFAULT FALSE,
    settled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add missing columns to employees if not already present (from previous failed run)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='cnic') THEN
        ALTER TABLE public.employees ADD COLUMN cnic TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='phone') THEN
        ALTER TABLE public.employees ADD COLUMN phone TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='employee_id') THEN
        ALTER TABLE public.employees ADD COLUMN employee_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='role') THEN
        CREATE TYPE public.employee_role AS ENUM ('bdo', 'asm', 'rsm');
        ALTER TABLE public.employees ADD COLUMN role public.employee_role DEFAULT 'bdo' NOT NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='status') THEN
        ALTER TABLE public.employees ADD COLUMN status TEXT DEFAULT 'active';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='joining_date') THEN
        ALTER TABLE public.employees ADD COLUMN joining_date DATE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='city') THEN
        ALTER TABLE public.employees ADD COLUMN city TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='area') THEN
        ALTER TABLE public.employees ADD COLUMN area TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='manager_id') THEN
        ALTER TABLE public.employees ADD COLUMN manager_id UUID REFERENCES public.employees(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='target_activations') THEN
        ALTER TABLE public.employees ADD COLUMN target_activations INTEGER DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='notes') THEN
        ALTER TABLE public.employees ADD COLUMN notes TEXT;
    END IF;
END $$;

-- Enable RLS
ALTER TABLE public.employees_advances ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees_advances TO authenticated;
GRANT ALL ON public.employees_advances TO service_role;

-- Policies
CREATE POLICY "Users can view advances in their workspace"
    ON public.employees_advances
    FOR SELECT
    TO authenticated
    USING (workspace_id IN (
        SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    ));

CREATE POLICY "Admins/Owners can manage advances"
    ON public.employees_advances
    FOR ALL
    TO authenticated
    USING (
        workspace_id IN (
            SELECT workspace_id FROM public.workspace_members 
            WHERE user_id = auth.uid() 
            AND role IN ('owner', 'admin', 'manager')
        )
    );

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_employees_advances_updated_at
    BEFORE UPDATE ON public.employees_advances
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
