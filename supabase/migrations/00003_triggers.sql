-- 00003_triggers.sql
-- Database triggers for business logic

-- Auto-create profile + free subscription on user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));

  insert into public.subscriptions (user_id, tier, status, credits_per_month, credits_remaining)
  values (new.id, 'free', 'active', 1, 1);

  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Auto-refund credit on podcast generation failure
create or replace function public.handle_podcast_failure()
returns trigger as $$
begin
  if new.status = 'failed' and old.status != 'failed' then
    -- Insert refund transaction
    insert into public.credit_transactions (user_id, type, amount, podcast_id)
    values (new.user_id, 'refund', 1, new.id);

    -- Increment credits remaining
    update public.subscriptions
    set credits_remaining = credits_remaining + 1
    where user_id = new.user_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_podcast_status_failed
  after update of status on public.podcasts
  for each row execute function public.handle_podcast_failure();
