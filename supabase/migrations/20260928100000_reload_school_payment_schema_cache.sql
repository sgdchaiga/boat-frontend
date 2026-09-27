-- Ensure PostgREST exposes the new school payment routing columns immediately.
NOTIFY pgrst, 'reload schema';
