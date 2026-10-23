import type { LedgerEntry } from '../../data/credits';
import { fill, formatAmount, t } from '../../i18n';
import { formatDate, formatTime } from '../../lib/time';

export function LedgerList({ ledger, timeZone }: { ledger: LedgerEntry[]; timeZone: string }) {
  if (ledger.length === 0) return <p>{t.history.noTransactions}</p>;
  return (
    <ul className="list">
      {ledger.map((entry) => (
        <li key={entry.id} className="row ledger">
          <span className="ledger-main">
            <span>{t.transactionType[entry.type]}</span>
            {entry.note !== null && <span className="detail">{entry.note}</span>}
            <span className="detail">
              {fill(t.slot.when, {
                day: formatDate(entry.createdAt, timeZone),
                time: formatTime(entry.createdAt, timeZone),
              })}
            </span>
          </span>
          <span className={entry.amount < 0 ? 'amount negative' : 'amount'}>
            {formatAmount(entry.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}
