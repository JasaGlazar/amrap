import { randomInt, randomUUID } from 'node:crypto';
import { test as base, devices, expect, type BrowserContext, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/database.types';
import { sl } from '../src/i18n/sl';
import { env, LOCAL_HOSTS } from './env';

type Client = SupabaseClient<Database>;
type Credentials = { email: string; password: string };

export type Customer = Credentials & { id: string; name: string };
export type Registrant = Credentials & { name: string; phone: string };
export type SlotTemplate = { id: string; weekday: number; startTime: string; capacity: number };
export type FixedAppointment = {
  templateId: string;
  ruleId: string;
  startTime: string;
  capacity: number;
};

export const TRAINER: Credentials = { email: 'trainer@amrap.local', password: 'password' };

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

function newClient(key: string): Client {
  return createClient<Database>(env.supabaseUrl, key, clientOptions);
}

async function bestEffort(
  what: string,
  step: () => PromiseLike<{ error: unknown }>,
): Promise<boolean> {
  try {
    const { error } = await step();
    if (!error) return true;
    console.warn(`e2e cleanup: ${what} failed`, error);
  } catch (error) {
    console.warn(`e2e cleanup: ${what} failed`, error);
  }
  return false;
}

async function deleteAppointmentsAndCharges(
  deleteTransactions: () => Promise<boolean>,
  deleteAppointments: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await deleteTransactions();
    if (await deleteAppointments()) return;
  }
}

// A charge can land between the two deletes and block the appointments delete, so retry.
async function deleteCustomerAndUser(admin: Client, id: string, userId: string): Promise<void> {
  await deleteAppointmentsAndCharges(
    () =>
      bestEffort('deleting credit transactions', () =>
        admin.from('credit_transactions').delete().eq('customer_id', id),
      ),
    () =>
      bestEffort('deleting appointments', () =>
        admin.from('appointments').delete().eq('customer_id', id),
      ),
  );
  await bestEffort('deleting recurring rules', () =>
    admin.from('recurring_rules').delete().eq('customer_id', id),
  );
  await bestEffort('deleting the customer row', () =>
    admin.from('customers').delete().eq('id', id),
  );
  await bestEffort('deleting the auth user', () => admin.auth.admin.deleteUser(userId));
}

async function findAuthUserId(admin: Client, email: string): Promise<string | null> {
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.warn(`e2e cleanup: listing auth users to find ${email} failed`, error);
      return null;
    }
    const user = data.users.find((candidate) => candidate.email === email);
    if (user) return user.id;
    if (data.users.length < perPage) return null;
  }
}

async function setRegistrationCode(admin: Client, code: string | null) {
  return admin
    .from('registration_settings')
    .update({ code, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select('id');
}

// data: and blob: URLs have no host and never leave the browser.
async function blockNonLocalRequests(context: BrowserContext, blocked: Set<string>) {
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === '' || LOCAL_HOSTS.includes(host)) return route.fallback();
    blocked.add(host);
    return route.abort('blockedbyclient');
  });
  await context.routeWebSocket(
    (url) => !LOCAL_HOSTS.includes(url.hostname),
    (ws) => {
      blocked.add(new URL(ws.url()).hostname);
      return ws.close();
    },
  );
}

export async function signIn(page: Page, who: Credentials): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(sl.login.email).fill(who.email);
  await page.getByLabel(sl.login.password).fill(who.password);
  await page.getByRole('button', { name: sl.login.submit }).click();
  await page.waitForURL(who.email === TRAINER.email ? /\/t$/ : /\/c$/);
}

type TestFixtures = {
  blockedHosts: Set<string>;
  newGuardedPage: () => Promise<Page>;
  customer: Customer;
  slotTemplate: SlotTemplate;
  fixedAppointment: FixedAppointment;
  registrationCode: string;
  registrant: Registrant;
};
type WorkerFixtures = { admin: Client; trainerClient: Client };

export const test = base.extend<TestFixtures, WorkerFixtures>({
  admin: [
    async ({}, use) => {
      await use(newClient(env.serviceRoleKey));
    },
    { scope: 'worker' },
  ],

  // One API sign-in per worker keeps the run far below the sign-in rate limit.
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

  blockedHosts: async ({}, use) => {
    const blocked = new Set<string>();
    await use(blocked);
    if (blocked.size > 0) {
      throw new Error(
        `e2e: blocked requests to hosts outside the local stack: ${[...blocked].join(', ')}`,
      );
    }
  },

  context: async ({ context, blockedHosts }, use) => {
    await blockNonLocalRequests(context, blockedHosts);
    await use(context);
  },

  // A second user needs a second context, and it must carry the same guard as the default one.
  newGuardedPage: async ({ browser, blockedHosts }, use, testInfo) => {
    const contexts: BrowserContext[] = [];
    await use(async () => {
      const context = await browser.newContext({
        ...devices['Pixel 7'],
        baseURL: testInfo.project.use.baseURL,
      });
      contexts.push(context);
      await blockNonLocalRequests(context, blockedHosts);
      return context.newPage();
    });
    for (const context of contexts) await context.close();
  },

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

    await deleteCustomerAndUser(admin, id, userId);
  },

  // The service-role client bypasses RLS; set_registration_code accepts only the trainer.
  registrationCode: async ({ admin }, use) => {
    const code = `e2e-${randomUUID()}`;
    const set = await setRegistrationCode(admin, code);
    if (set.error)
      throw new Error(`e2e: setting the registration code failed: ${set.error.message}`);
    if (set.data.length !== 1)
      throw new Error('e2e: the registration_settings row (id 1) is missing');

    await use(code);

    await bestEffort('clearing the registration code', () => setRegistrationCode(admin, null));
  },

  // The test signs up through the app, so cleanup finds what it made by the email.
  registrant: async ({ admin }, use) => {
    const tag = randomUUID().slice(0, 8);
    const email = `e2e-${tag}@test.local`;
    await use({
      email,
      password: `e2e-${randomUUID()}`,
      name: `E2E ${tag}`,
      phone: `040 ${randomInt(100_000, 1_000_000)}`,
    });

    const userId = await findAuthUserId(admin, email);
    if (userId === null) return;
    const row = await admin.from('customers').select('id').eq('auth_user_id', userId).maybeSingle();
    if (row.error)
      console.warn(`e2e cleanup: finding the customer row of ${email} failed`, row.error);
    if (row.data) {
      await deleteCustomerAndUser(admin, row.data.id, userId);
    } else {
      await bestEffort('deleting the auth user', () => admin.auth.admin.deleteUser(userId));
    }
  },

  // Thursday 12:xx: a random minute keeps parallel tests' sessions apart on screen.
  slotTemplate: async ({ admin, trainerClient }, use) => {
    const weekday = 3;
    const capacity = 5;
    const startTime = `12:${String(randomInt(60)).padStart(2, '0')}`;
    const template = await trainerClient
      .from('slot_templates')
      .insert({ weekday, start_time: startTime, capacity })
      .select('id')
      .single();
    if (template.error)
      throw new Error(`e2e: creating a slot template failed: ${template.error.message}`);
    const id = template.data.id;

    await use({ id, weekday, startTime, capacity });

    // The template is this test's own, so every row that references it is too.
    await deleteAppointmentsAndCharges(
      async () => {
        const appointments = await admin
          .from('appointments')
          .select('id')
          .eq('slot_template_id', id);
        const appointmentIds = (appointments.data ?? []).map((row) => row.id);
        return bestEffort("deleting the template's credit transactions", () =>
          admin.from('credit_transactions').delete().in('appointment_id', appointmentIds),
        );
      },
      () =>
        bestEffort("deleting the template's appointments", () =>
          admin.from('appointments').delete().eq('slot_template_id', id),
        ),
    );
    await bestEffort("deleting the template's recurring rules", () =>
      admin.from('recurring_rules').delete().eq('slot_template_id', id),
    );
    const deleted = await bestEffort('deleting the slot template', () =>
      admin.from('slot_templates').delete().eq('id', id),
    );
    if (!deleted) {
      await bestEffort('deactivating the slot template', () =>
        admin.from('slot_templates').update({ active: false }).eq('id', id),
      );
    }
  },

  // The same calls as addRule in src/data/rules.ts, made as the trainer.
  fixedAppointment: async ({ customer, slotTemplate, trainerClient }, use) => {
    const rule = await trainerClient
      .from('recurring_rules')
      .insert({ customer_id: customer.id, slot_template_id: slotTemplate.id })
      .select('id')
      .single();
    if (rule.error) throw new Error(`e2e: creating a recurring rule failed: ${rule.error.message}`);
    const activated = await trainerClient.rpc('activate_rule', { p_rule_id: rule.data.id });
    if (activated.error) throw new Error(`e2e: activate_rule failed: ${activated.error.message}`);
    if (activated.data < 3) {
      throw new Error(
        `e2e: activate_rule created ${activated.data} appointments for rule ${rule.data.id}, ` +
          'expected at least 3. A blocked period in the next four weeks in the local database ' +
          'is the likely cause.',
      );
    }

    await use({
      templateId: slotTemplate.id,
      ruleId: rule.data.id,
      startTime: slotTemplate.startTime,
      capacity: slotTemplate.capacity,
    });
  },
});

export { expect };
