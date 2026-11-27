import { runAction, type ActionResult, type Client } from './client';

export type InviteStatus = 'linked' | 'pending' | 'none';

export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  linked: boolean;
  inviteToken: string | null;
  inviteExpiresAt: Date | null;
  registeredAt: Date | null;
  hasRules: boolean;
};

export type CustomerFields = { name: string; phone: string | null; email: string | null };

const columns =
  'id, name, phone, email, auth_user_id, invite_token, invite_expires_at, registered_at, recurring_rules(count)';

type Row = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  auth_user_id: string | null;
  invite_token: string | null;
  invite_expires_at: string | null;
  registered_at: string | null;
  recurring_rules: { count: number }[];
};

function toCustomer(row: Row): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    linked: row.auth_user_id !== null,
    inviteToken: row.invite_token,
    inviteExpiresAt: row.invite_expires_at === null ? null : new Date(row.invite_expires_at),
    registeredAt: row.registered_at === null ? null : new Date(row.registered_at),
    hasRules: (row.recurring_rules[0]?.count ?? 0) > 0,
  };
}

export function isNewCustomer(customer: Customer): boolean {
  return customer.registeredAt !== null && !customer.hasRules;
}

export function inviteStatus(customer: Customer, now: Date): InviteStatus {
  if (customer.linked) return 'linked';
  if (
    customer.inviteToken !== null &&
    customer.inviteExpiresAt !== null &&
    customer.inviteExpiresAt.getTime() > now.getTime()
  ) {
    return 'pending';
  }
  return 'none';
}

export async function listCustomers(client: Client): Promise<Customer[]> {
  const { data, error } = await client
    .from('customers')
    .select(columns)
    .eq('role', 'customer')
    .order('name');
  if (error) throw error;
  return data.map(toCustomer);
}

export async function getCustomer(client: Client, id: string): Promise<Customer> {
  const { data, error } = await client
    .from('customers')
    .select(columns)
    .eq('id', id)
    .eq('role', 'customer')
    .maybeSingle();
  if (error) throw error;
  if (data === null) throw new Error(`customer ${id} not found`);
  return toCustomer(data);
}

export function createCustomer(
  client: Client,
  fields: CustomerFields,
): Promise<ActionResult<{ id: string } | null>> {
  return runAction(() => client.from('customers').insert(fields).select('id').single());
}

export function updateCustomer(
  client: Client,
  id: string,
  fields: CustomerFields,
): Promise<ActionResult<null>> {
  return runAction(() => client.from('customers').update(fields).eq('id', id));
}

export function createInvite(
  client: Client,
  customerId: string,
): Promise<ActionResult<string | null>> {
  return runAction(() => client.rpc('create_invite', { p_customer_id: customerId }));
}

export function deleteCustomer(client: Client, customerId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { error } = await client.rpc('delete_customer', { p_customer_id: customerId });
    return { data: null, error };
  });
}
