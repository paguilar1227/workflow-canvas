import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/manrope';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/fraunces';
import '@fontsource/patrick-hand';
import '@xyflow/react/dist/base.css';
import './styles.css';
import { App } from './App';
import { connect } from './sync';
import { get } from './store';

connect();
(window as unknown as { __wfc: unknown }).__wfc = { state: get };
createRoot(document.getElementById('root')!).render(<App />);

