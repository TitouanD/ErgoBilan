-- Add a non-sensitive `step` integer column to the drafts table so that
-- getDraftsMetadata() can fetch the current workflow step without decrypting
-- the full encrypted_data blob on every dashboard load.
alter table public.drafts
    add column if not exists step integer;
