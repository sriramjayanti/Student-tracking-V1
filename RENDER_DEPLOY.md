# Render Deployment

This project is ready to run as a Render Node web service.

## Service Settings

- Runtime: `Node`
- Root directory: `school-transport-tracker` if you deploy from the outer folder
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Health check path: `/api/health`
- Node version: `20.18.0`

## Required Environment Variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_JSON`

## Blueprint

A repo-root [render.yaml](../render.yaml) is included for Blueprint deploys. It already points Render at the nested app folder and sets the health check path.
