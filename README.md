# Azure Static Web App: Calorie Tracker (Next.js + FastAPI)

This workspace contains:

- `frontend/`: React app built with Next.js
- `api/`: Python FastAPI app hosted through Azure Functions (for Azure Static Web Apps)

## What this app does

- Lets users search foods via USDA FoodData Central.
- Allows users to save consumed items.
- Persists consumption logs in Azure Table Storage.
- Shows total calories from logged items.

## Architecture

- Azure Static Web Apps builds and hosts the Next.js frontend.
- Azure Static Web Apps routes `/api/*` requests to the Python Azure Functions API.
- Azure Functions runs FastAPI through ASGI middleware.
- FastAPI calls USDA FoodData Central and Azure Table Storage.

## Required configuration

Set these values in your Functions app settings (and in `api/local.settings.json` for local):

- `USDA_API_KEY`: API key from USDA FoodData Central.
- `AZURE_TABLE_STORAGE_CONNECTION_STRING`: Storage connection string.
- `CALORIE_LOG_TABLE_NAME`: Optional table name. Default is `CalorieLog`.

## Local development

### 1) Backend (FastAPI in Azure Functions)

Install Azure Functions Core Tools and run:

```powershell
cd api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .\local.settings.sample.json .\local.settings.json
# Edit local.settings.json and set USDA_API_KEY and AZURE_TABLE_STORAGE_CONNECTION_STRING
func start
```

By default, the API is available under `http://localhost:7071/api`.

### 2) Frontend

In a separate terminal:

```powershell
cd frontend
npm install
$env:NEXT_PUBLIC_API_BASE_URL="http://localhost:7071/api"
npm run dev
```

The UI runs at `http://localhost:3000`.

## API endpoints

- `GET /api/health` returns service health.
- `GET /api/foods/search?q=<term>&page_size=10` searches USDA foods.
- `GET /api/foods/{fdc_id}` gets details for one USDA food.
- `POST /api/consumptions` saves a consumed item to Azure Table Storage.
- `GET /api/consumptions?user_id=<id>` lists saved consumed items.

## Deploy to Azure Static Web Apps

1. Push this repo to GitHub.
2. Create an Azure Static Web App and connect it to this repository.
3. In Azure, set application settings for the API:
   - `USDA_API_KEY`
   - `AZURE_TABLE_STORAGE_CONNECTION_STRING`
   - `CALORIE_LOG_TABLE_NAME` (optional)
4. Add `AZURE_STATIC_WEB_APPS_API_TOKEN` in GitHub repository secrets.
5. The workflow in `.github/workflows/azure-static-web-apps.yml` builds and deploys both `frontend` and `api`.
