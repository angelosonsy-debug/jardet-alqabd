-- Security hardening per Supabase security advisor findings.
-- 1) _actor_name() had a mutable search_path (could be hijacked by a malicious search_path).
alter function public._actor_name() set search_path = public;

-- 2) pg_trgm was installed in the public schema; extensions should live in a dedicated schema.
alter extension pg_trgm set schema extensions;

-- 3) handle_new_user() is a SECURITY DEFINER trigger function for auth.users inserts.
--    It must only ever be invoked by the trigger itself, never callable directly via PostgREST.
revoke all on function public.handle_new_user() from public, anon, authenticated;
