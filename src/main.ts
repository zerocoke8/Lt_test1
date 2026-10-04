// Entry point → ui/app.ts
import { startApp } from './ui/app';
import { preventZoom } from './ui/nozoom';

preventZoom();
const root = document.getElementById('app');
if (root) startApp(root);
