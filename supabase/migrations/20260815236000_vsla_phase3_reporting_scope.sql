-- Complete cycle scoping for attendance reporting and optimize report filters.

ALTER TABLE public.vsla_meeting_attendance
  ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES public.vsla_cycles(id) ON DELETE RESTRICT;
UPDATE public.vsla_meeting_attendance a SET cycle_id = m.cycle_id
FROM public.vsla_meetings m WHERE a.cycle_id IS NULL AND m.id = a.meeting_id;
CREATE INDEX IF NOT EXISTS idx_vsla_attendance_cycle ON public.vsla_meeting_attendance (cycle_id, meeting_id, member_id);
DROP TRIGGER IF EXISTS trg_vsla_attendance_assign_cycle ON public.vsla_meeting_attendance;
CREATE TRIGGER trg_vsla_attendance_assign_cycle BEFORE INSERT ON public.vsla_meeting_attendance
FOR EACH ROW EXECUTE FUNCTION public.vsla_assign_active_cycle();
DROP TRIGGER IF EXISTS trg_vsla_attendance_lock_cycle ON public.vsla_meeting_attendance;
CREATE TRIGGER trg_vsla_attendance_lock_cycle BEFORE UPDATE OR DELETE ON public.vsla_meeting_attendance
FOR EACH ROW EXECUTE FUNCTION public.vsla_prevent_closed_cycle_change();

CREATE INDEX IF NOT EXISTS idx_vsla_fines_cycle ON public.vsla_fines (cycle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vsla_funds_cycle ON public.vsla_fund_transactions (cycle_id, created_at DESC);
