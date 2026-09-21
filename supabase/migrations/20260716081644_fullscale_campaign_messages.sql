alter table public.fs_campaigns
  add column if not exists thankyou_message text,
  add column if not exists closed_message text;;
