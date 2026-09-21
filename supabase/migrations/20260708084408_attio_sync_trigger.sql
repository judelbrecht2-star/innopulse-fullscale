create extension if not exists pg_net;

create or replace function public.tg_attio_sync() returns trigger
language plpgsql security definer set search_path = public, net as $$
begin
  perform net.http_post(
    url := 'https://jydbinexjckfzjqgsmjf.supabase.co/functions/v1/attio-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-token', 'tgs_ipa_a91f3c7d'
    ),
    body := jsonb_build_object('record', to_jsonb(NEW))
  );
  return NEW;
end;
$$;

drop trigger if exists trg_attio_sync on public.public_assessments;
create trigger trg_attio_sync
  after insert on public.public_assessments
  for each row execute function public.tg_attio_sync();;
