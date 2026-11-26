import { randomUUID } from 'node:crypto';
import { test as base, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/database.types';
import { sl } from '../src/i18n/sl';
import { env } from './env';

type Client = SupabaseClient<Database>;
type Credentials = { email: string; password: string };

export type Customer = Credentials & { id: string; name: string };
export type FixedAppointment = { templateId: string; ruleId: string };

export const TRAINER: Credentials = { email: 'trainer@amrap.local', password: 'password' };

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

function newClient(key: string): Client {
  return createClient<Database>(env.supabaseUrl, key, clientOptions);
}

async function bestEffort(what: string, step: () => PromiseLike<{ error: unknown }>) {
  try {
    const { error } = await step();
    if (error) console.warn(`e2e cleanup: ${what} failed`, error);
  } catch (error) {
    console.warn(`e2e cleanup: ${what} failed`, error);
  }
}

export async function signIn(page: Page, who: Credentials): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(sl.login.email).fill(who.email);
  await page.getByLabel(sl.login.password).fill(who.password);
  await page.getByRole('button', { name: sl.login.submit }).click();
  await page.waitForURL(who.email === TRAINER.email ? /\/t$/ : /\/c$/);
}

type TestFixtures = { customer: Customer; fixedAppointment: FixedAppointment };
type WorkerFixtures = { admin: Client; trainerClient: Client };

export const test = base.extend<TestFixtures, WorkerFixtures>({
  admin: [
    async ({}, use) => {
      await use(newClient(env.serviceRoleKey));
    },
    { scope: 'worker' },
  ],

  // One API sign-in per worker: the local stack allows 30 sign-ins per 5 minutes.
  trainerClient: [
    async ({}, use) => {
      const client = newClient(env.anonKey);
      const { error } = await client.auth.signInWithPassword(TRAINER);
      if (error) throw new Error(`e2e: trainer API sign-in failed: ${error.message}`);
      await use(client);
      // Local scope: a global sign-out would end the trainer's browser sessions in other tests.
      await client.auth.signOut({ scope: 'local' });
    },
    { scope: 'worker' },
  ],

  customer: async ({ admin }, use) => {
    const tag = randomUUID().slice(0, 8);
    const email = `e2e-${tag}@test.local`;
    const password = `e2e-${randomUUID()}`;
    const name = `E2E ${tag}`;

    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(`e2e: creating ${email} failed: ${created.error.message}`);
    const userId = created.data.user.id;

    const row = await admin
      .from('customers')
      .insert({ name, email, auth_user_id: userId })
      .select('id')
      .single();
    if (row.error) {
      await bestEffort('deleting the auth user', () => admin.auth.admin.deleteUser(userId));
      throw new Error(`e2e: creating the customer row for ${email} failed: ${row.error.message}`);
    }
    const id = row.data.id;

    await use({ id, name, email, password });

    // The customer row cannot go while rows that reference it remain.
    await bestEffort('deleting credit transactions', () =>
      admin.from('credit_transactions').delete().eq('customer_id', id),
    );
    await bestEffort('deleting appointments', () =>
      admin.from('appointments').delete().eq('customer_id', id),
    );
    await bestEffort('deleting recurring rules', () =>
      admin.from('recurring_rules').delete().eq('customer_id', id),
    );
    await bestEffort('deleting the customer row', () =>
      admin.from('customers').delete().eq('id', id),
    );
    await bestEffort('deleting the auth user', () => admin.auth.admin.deleteUser(userId));
  },

  // The same calls as addRule in src/data/rules.ts, made as the trainer.
  fixedAppointment: async ({ customer, trainerClient }, use) => {
    const template = await trainerClient
      .from('slot_templates')
      .insert({ weekday: 3, start_time: '12:00', capacity: 5 })
      .select('id')
      .single();
    if (template.error)
      throw new Error(`e2e: creating a slot template failed: ${template.error.message}`);
    const templateId = template.data.id;

    try {
      const rule = await trainerClient
        .from('recurring_rules')
        .insert({ customer_id: customer.id, slot_template_id: templateId })
        .select('id')
        .single();
      if (rule.error)
        throw new Error(`e2e: creating a recurring rule failed: ${rule.error.message}`);
      const activated = await trainerClient.rpc('activate_rule', { p_rule_id: rule.data.id });
      if (activated.error) {
        throw new Error(`e2e: activate_rule failed: ${activated.error.message}`);
      }

      await use({ templateId, ruleId: rule.data.id });
    } finally {
      await bestEffort('deactivating the slot template', () =>
        trainerClient.from('slot_templates').update({ active: false }).eq('id', templateId),
      );
    }
  },
});

export { expect };
