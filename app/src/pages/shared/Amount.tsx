import { formatAmount, formatBalance } from '../../i18n';

export function Amount({ value, signed = false }: { value: number; signed?: boolean }) {
  const tone = value < 0 ? ' negative' : value > 0 ? ' positive' : '';
  return (
    <span className={`amount${tone}`}>{signed ? formatAmount(value) : formatBalance(value)}</span>
  );
}
