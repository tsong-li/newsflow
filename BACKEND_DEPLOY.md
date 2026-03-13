# Backend Deployment

This repo is now prepared to deploy the NewsFlow API as a standalone Node service.

## Recommended target

Use Render for the backend. The repo now includes `render.yaml`, so you can create the service from the repository directly.

## What was prepared

- `npm start` launches `server/index.js`
- `PORT` and `HOST` are respected in production
- `CORS_ORIGIN` can lock the API down to your GitHub Pages frontend
- `GET /api/health` is available for health checks
- `render.yaml` defines a ready-to-import Render web service

## Required environment variables

Required for current production behavior:

- `SILICONFLOW_API_KEY`
- `AZURE_SPEECH_KEY`
- `AZURE_SPEECH_REGION`

Optional but supported:

- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_DEPLOYMENT`
- `YOUTUBE_DATA_API_KEY`
- `CORS_ORIGIN`

Defaults already wired in code:

- `PORT=3001`
- `HOST=0.0.0.0`
- `SILICONFLOW_MODEL=Qwen/Qwen2.5-7B-Instruct`
- `AZURE_OPENAI_API_VERSION=2024-10-21`
- `AZURE_SPEECH_VOICE=en-US-AndrewMultilingualNeural`
- `AZURE_SPEECH_OUTPUT_FORMAT=audio-24khz-48kbitrate-mono-mp3`

## Render steps

1. Push the latest code to GitHub.
2. In Render, choose `New +` -> `Blueprint`.
3. Select this repository.
4. Render will detect `render.yaml` and propose the `newsflow-api` service.
5. Fill in the secret env vars before first deploy.
6. Deploy and wait for the health check on `/api/health` to pass.
7. Copy the final backend URL, for example `https://newsflow-api.onrender.com`.

## After backend deploy

Set the frontend repository variable:

- GitHub repo -> `Settings` -> `Secrets and variables` -> `Actions` -> `Variables`
- Add `VITE_API_BASE_URL=https://your-backend-domain`

Then push to `main` again or re-run the GitHub Pages workflow so the frontend rebuild picks up the backend URL.

## Quick verification

After deployment, these URLs should work:

- `/api/health`
- `/api/news?category=All`
- `/api/tts?text=hello`

If `/api/tts` fails, check Azure Speech credentials first.
If `/api/youtube-search` returns empty data, the YouTube Data API key or Google project permissions are still not configured correctly.
