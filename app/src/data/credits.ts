import type { Client, TransactionType } from './client';

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
