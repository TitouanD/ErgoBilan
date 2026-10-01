import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { initSentry, reactRootErrorHandler, withSentryProfiler } from './services/sentryService';

// Local font assets for lower startup latency and fewer third-party requests.
import '@fontsource/quicksand/latin-400.css';
import '@fontsource/quicksand/latin-600.css';
import '@fontsource/quicksand/latin-700.css';
import '@fontsource/merriweather/latin-400.css';
import '@fontsource/merriweather/latin-700.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

initSentry();
const AppWithProfiler = withSentryProfiler(App);

// React 19 root hooks: errors caught by GlobalErrorBoundary arrive through onCaughtError (with the component stack).
const root = ReactDOM.createRoot(rootElement, {
  onUncaughtError: reactRootErrorHandler('uncaught'),
  onCaughtError: reactRootErrorHandler('caught'),
  onRecoverableError: reactRootErrorHandler('recoverable'),
});
root.render(
  <React.StrictMode>
    <AppWithProfiler />
    <Analytics />
    <SpeedInsights />
  </React.StrictMode>,
);
