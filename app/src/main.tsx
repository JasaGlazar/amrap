import { listenForInstallPrompt } from './install/capture';
import { installPlatform } from './install/platform';
import { start } from './start';
import './styles.css';

listenForInstallPrompt(window, installPlatform.store);
void start(document.getElementById('root')!);
