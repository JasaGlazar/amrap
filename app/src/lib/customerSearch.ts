import { isNewCustomer, type Customer } from '../data/customers';

export type SearchableCustomer = Customer & { balance: number };

export const customerFilters = ['vsi', 'dolzniki', 'brez', 'novi'] as const;

export type CustomerFilter = (typeof customerFilters)[number];

export function customerFilterOf(value: string | null): CustomerFilter {
  return customerFilters.find((filter) => filter === value) ?? 'vsi';
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function phoneDigits(text: string): string {
  const digits = text.replace(/\D/g, '');
  if (digits.startsWith('00386')) return `0${digits.slice(5)}`;
  if (text.trim().startsWith('+') && digits.startsWith('386')) return `0${digits.slice(3)}`;
  return digits;
}

export function matchesCustomer(customer: SearchableCustomer, query: string): boolean {
  const trimmed = query.trim();
  if (trimmed === '') return true;
  if (/^[\d\s+()./-]+$/.test(trimmed)) {
    const digits = phoneDigits(trimmed);
    return digits !== '' && customer.phone !== null && phoneDigits(customer.phone).includes(digits);
  }
  const text = `${fold(customer.name)} ${fold(customer.email ?? '')}`;
  return fold(trimmed)
    .split(/\s+/)
    .every((word) => text.includes(word));
}

function passes(customer: SearchableCustomer, filter: CustomerFilter): boolean {
  if (filter === 'dolzniki') return customer.balance < 0;
  if (filter === 'brez') return !customer.linked;
  if (filter === 'novi') return isNewCustomer(customer);
  return true;
}

export function searchCustomers(
  customers: SearchableCustomer[],
  query: string,
  filter: CustomerFilter,
): SearchableCustomer[] {
  return customers
    .filter((customer) => passes(customer, filter) && matchesCustomer(customer, query))
    .sort((a, b) => a.name.localeCompare(b.name, 'sl'));
}
