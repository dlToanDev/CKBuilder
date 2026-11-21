import { createRoot } from 'react-dom/client';
import App from './App';
import { LayoutProvider } from './layoutProvider';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing.');
createRoot(root).render(<LayoutProvider><App /></LayoutProvider>);
