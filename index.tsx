import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Local font assets for lower startup latency and fewer third-party requests.
import '@fontsource/quicksand/latin-300.css';
import '@fontsource/quicksand/latin-400.css';
import '@fontsource/quicksand/latin-500.css';
import '@fontsource/quicksand/latin-600.css';
import '@fontsource/quicksand/latin-700.css';
import '@fontsource/merriweather/latin-300.css';
import '@fontsource/merriweather/latin-400.css';
import '@fontsource/merriweather/latin-700.css';
import '@fontsource/merriweather/latin-900.css';
import '@fontsource/merriweather/latin-300-italic.css';
import '@fontsource/merriweather/latin-400-italic.css';
import '@fontsource/merriweather/latin-700-italic.css';
import '@fontsource/merriweather/latin-900-italic.css';
import '@fontsource/roboto/latin-300.css';
import '@fontsource/roboto/latin-400.css';
import '@fontsource/roboto/latin-500.css';
import '@fontsource/roboto/latin-700.css';
import '@fontsource/playfair-display/latin-400.css';
import '@fontsource/playfair-display/latin-700.css';
import '@fontsource/playfair-display/latin-400-italic.css';
import '@fontsource/open-sans/latin-400.css';
import '@fontsource/open-sans/latin-600.css';
import '@fontsource/open-sans/latin-700.css';
import '@fontsource/lato/latin-400.css';
import '@fontsource/lato/latin-700.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
