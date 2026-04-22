# Azure Static Web App: Next.js + FastAPI

This workspace contains:

- `frontend/`: React app built with Next.js
- `api/`: Python FastAPI app hosted through Azure Functions (for Azure Static Web Apps)

## Architecture

- Azure Static Web Apps builds and hosts the Next.js frontend.
- Azure Static Web Apps routes `/api/*` requests to the Python Azure Functions API.
- Azure Functions runs FastAPI through ASGI middleware.

## Local development

### 1) Frontend

```powershell
cd frontend
npm install
npm run dev
```

This starts the frontend at `http://localhost:3000`.

### 2) Backend (FastAPI in Azure Functions)

Install Azure Functions Core Tools and then run:

```powershell
cd api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
func start
```

By default, the API is available under `http://localhost:7071/api`.
Health endpoint: `http://localhost:7071/api/health`

### 3) Connect frontend to local backend

In another shell:

```powershell
cd frontend
$env:NEXT_PUBLIC_API_BASE_URL="http://localhost:7071/api"
npm run dev
```

## Deploy to Azure Static Web Apps

1. Push this repo to GitHub.
2. Create an Azure Static Web App and connect it to your GitHub repository.
3. In the Static Web App, set the deployment source to the `main` branch.
4. Add the secret `AZURE_STATIC_WEB_APPS_API_TOKEN` in your GitHub repo secrets.
5. The workflow in `.github/workflows/azure-static-web-apps.yml` will build and deploy both `frontend` and `api`.

## API endpoints

- `GET /api/` returns a welcome message
- `GET /api/health` returns service health
