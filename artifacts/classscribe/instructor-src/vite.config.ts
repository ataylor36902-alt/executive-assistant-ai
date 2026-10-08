import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({root:here,base:'/instructor/',plugins:[react()],build:{outDir:path.resolve(here,'../web-public/instructor'),emptyOutDir:true},resolve:{dedupe:['react','react-dom']}});