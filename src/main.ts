// Entry point → ui/app.ts
import { startApp } from './ui/app';

const root = document.getElementById('app');
if (root) startApp(root);
