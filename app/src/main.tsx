import { start } from './start';
import './styles.css';

// RouterProvider comes from 'react-router' (not 'react-router/dom') in start.tsx so the tests and
// the app render the same component; the /dom variant only adds flushSync for transitions.
void start(document.getElementById('root')!);
