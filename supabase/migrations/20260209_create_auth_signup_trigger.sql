-- Migration: ensure handle_new_user trigger on auth.users
-- Creates practitioner + org + membership + subscription on new Auth user.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
