-- Local development data; contents in docs/schema.md "Test helpers and seeds".

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

  insert into public.slot_templates (weekday, start_time) values (0, '07:00');
  insert into public.slot_templates (weekday, start_time, duration_minutes, capacity)
  values (2, '18:00', 90, 4);

  insert into public.credit_transactions (customer_id, amount, type, created_by, note)
  values (v_ana, 8, 'topup', v_trainer_user, 'Dev seed top-up');
end;
$$;
