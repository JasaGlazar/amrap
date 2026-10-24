import { t } from '../../i18n';

export function BrandMark() {
  return (
    <img className="brand-mark" src="/brand-mark.png" alt={t.app.name} width={280} height={90} />
  );
}
