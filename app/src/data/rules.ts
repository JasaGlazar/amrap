import { t } from '../i18n';
import { runAction, type ActionResult, type Client } from './client';

export type Rule = { id: string; slotTemplateId: string; active: boolean };

export async function rulesOf(client: Client, customerId: string): Promise<Rule[]> {
  const { data, error } = await client
    .from('recurring_rules')
    .select('id, slot_template_id, active')
    .eq('customer_id', customerId)
    .order('created_at');
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    slotTemplateId: row.slot_template_id,
    active: row.active,
  }));
}

export function activateRule(client: Client, ruleId: string): Promise<ActionResult<number | null>> {
  return runAction(() => client.rpc('activate_rule', { p_rule_id: ruleId }));
}

export function deactivateRule(
  client: Client,
  ruleId: string,
): Promise<ActionResult<number | null>> {
  return runAction(() => client.rpc('deactivate_rule', { p_rule_id: ruleId }));
}

export async function addRule(
  client: Client,
  customerId: string,
  slotTemplateId: string,
): Promise<ActionResult<number | null>> {
  const inserted = await runAction(() =>
    client
      .from('recurring_rules')
      .insert({ customer_id: customerId, slot_template_id: slotTemplateId })
      .select('id')
      .single(),
  );
  if (!inserted.ok) return inserted;
  if (inserted.data === null) return { ok: false, message: t.genericError };
  return activateRule(client, inserted.data.id);
}
