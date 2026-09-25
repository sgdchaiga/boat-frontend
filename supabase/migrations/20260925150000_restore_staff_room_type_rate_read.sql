-- Cash Room Register reads the room type price when no room override is set.
-- Staff need read access to their own organization's types, independently of
-- the manager-only policies used to edit room setup.
BEGIN;
DROP POLICY IF EXISTS room_types_select_same_org ON public.room_types;
CREATE POLICY room_types_select_same_org
  ON public.room_types FOR SELECT TO authenticated
  USING (
    organization_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = (SELECT auth.uid())
        AND s.organization_id = room_types.organization_id
        AND COALESCE(s.is_active, true)
    )
  );
COMMIT;
