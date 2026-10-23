import { runAction, type ActionResult, type Client, type TransactionType } from './client';

export type LedgerEntry = {
  id: string;
  amount: number;
  type: TransactionType;
  note: string | null;
  createdAt: Date;
};

export async function balanceOf(client: Client, customerId: string): Promise<number> {
  const { data, error } = await client
    .from('customer_balances')
    .select('balance')
    .eq('customer_id', customerId)
    .maybeSingle();
  if (error) throw error;
  return data?.balance ?? 0;
}

export async function ledgerOf(client: Client, customerId: string): Promise<LedgerEntry[]> {
  const { data, error } = await client
    .from('credit_transactions')
    .select('id, amount, type, note, created_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    amount: row.amount,
    type: row.type,
    note: row.note,
    createdAt: new Date(row.created_at),
  }));
}

export async function allBalances(client: Client): Promise<Map<string, number>> {
  const { data, error } = await client.from('customer_balances').select('customer_id, balance');
  if (error) throw error;
  return new Map(
    data.flatMap((row) => (row.customer_id === null ? [] : [[row.customer_id, row.balance ?? 0]])),
  );
}

export function topUp(
  client: Client,
  customerId: string,
  amount: number,
  note: string | null,
): Promise<ActionResult<string | null>> {
  return runAction(() =>
    client.rpc('top_up', {
      p_customer_id: customerId,
      p_amount: amount,
      p_note: note ?? undefined,
    }),
  );
}

export function adjust(
  client: Client,
  customerId: string,
  amount: number,
  note: string | null,
): Promise<ActionResult<string | null>> {
  return runAction(() =>
    client.rpc('adjust', {
      p_customer_id: customerId,
      p_amount: amount,
      p_note: note ?? undefined,
    }),
  );
}
