import { useCustomer } from '../../auth/AuthContext';
import { PushToggle } from '../shared/PushToggle';

export function SettingsNotifications() {
  const trainer = useCustomer();
  return <PushToggle audience="trainer" userId={trainer.auth_user_id ?? ''} />;
}
