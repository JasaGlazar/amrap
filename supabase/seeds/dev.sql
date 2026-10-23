-- Local development data. Loaded by `supabase db reset` after test_helpers.sql (it uses
-- tests.create_user). Never pushed to the remote project.
--
-- Sign-ins (password "password"):
--   trainer@amrap.local  trainer
--   ana@amrap.local      customer, linked, 8 credits
-- Marko is invited but not linked (token "dev-invite-token", valid 7 days from the reset).

do $$
declare
  v_trainer_user uuid := tests.create_user('trainer@amrap.local');
  v_ana_user uuid := tests.create_user('ana@amrap.local');
  v_ana uuid;
begin
  insert into public.customers (name, email, role, auth_user_id)
  values ('Trener', 'trainer@amrap.local', 'trainer', v_trainer_user);

  insert into public.customers (name, phone, email, auth_user_id)
  values ('Ana Novak', '+386 40 111 111', 'ana@amrap.local', v_ana_user)
  returning id into v_ana;

  insert into public.customers (name, phone, invite_token, invite_expires_at)
  values ('Marko Kranjc', '+386 40 222 222', 'dev-invite-token', now() + interval '7 days');

  -- Monday 07:00 (default 60 min, capacity 5) and Wednesday 18:00 (90 min, capacity 4).
  insert into public.slot_templates (weekday, start_time) values (0, '07:00');
  insert into public.slot_templates (weekday, start_time, duration_minutes, capacity)
  values (2, '18:00', 90, 4);

  insert into public.credit_transactions (customer_id, amount, type, created_by, note)
  values (v_ana, 8, 'topup', v_trainer_user, 'Dev seed top-up');
end;
$$;
