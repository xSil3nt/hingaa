# Project workflow

Keep UI copy concise and art as placeholders for the team designers.

After completing a requested app change, run relevant checks, commit and push to main, and verify the resulting Vercel production deployment at https://hingaa.shazin.dev. The user explicitly requests deployment after changes. GitHub pushes deploy automatically; avoid a duplicate CLI deployment when the automatic deployment succeeds.

Vercel CLI is authenticated on this machine and the ignored .vercel directory links this folder to the hingaa project. npm run dev:vercel starts Vercel local development on port 4173 (stop any existing npm start server on that port first). npm run deploy is the manual production deployment fallback. npm run deploy:status checks production deployments.

Never commit or upload .env.local, .runtime, or .vercel. Keep the server Maps key in Vercel environment variables. Browser-key referrers allow localhost:4173 and shazin.dev/subdomains.
