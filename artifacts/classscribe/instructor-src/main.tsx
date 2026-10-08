import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {ClerkProvider} from '@clerk/react';
import App from './portal';
import portalStyles from './style.css?inline';

const stylesheet=document.createElement('style');
stylesheet.textContent=portalStyles;
document.head.appendChild(stylesheet);
const key=import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if(!key)createRoot(document.getElementById('root')!).render(<div style={{padding:32}}>ClassScribe sign-in is not configured. Set VITE_CLERK_PUBLISHABLE_KEY and rebuild the EDU portal.</div>);
else createRoot(document.getElementById('root')!).render(<StrictMode><ClerkProvider publishableKey={key} proxyUrl={import.meta.env.VITE_CLERK_PROXY_URL||undefined} signInUrl="/instructor/sign-in" signUpUrl="/instructor/sign-up"><App/></ClerkProvider></StrictMode>);