alter table public.fs_groups drop constraint if exists fs_groups_type_check;
alter table public.fs_groups add constraint fs_groups_type_check
  check (type in ('executive','employee','customer','partner','other'));;
