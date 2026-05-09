import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  
  return {
    // ⚠️ AJOUT CRUCIAL POUR GITHUB PAGES
    // Cela indique à Vite que le projet est dans le sous-dossier /yamehome_appli/
    base: '/', // ⚠️ Doit être un slash tout seul maintenant puisque on part sur vercel

    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      // Injected at CI build time (GitHub Actions sets GITHUB_SHA). Shows in app footer to verify live deploy.
      __BUILD_REVISION__: JSON.stringify(
        process.env.GITHUB_SHA?.slice(0, 7) ||
          process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
          'local',
      ),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});