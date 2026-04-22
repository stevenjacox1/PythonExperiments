import azure.functions as func
from fastapi import FastAPI

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)
fastapi_app = FastAPI(title="swa-fastapi-api", version="1.0.0")


@fastapi_app.get("/")
async def root() -> dict[str, str]:
    return {"message": "FastAPI backend is running on Azure Static Web Apps API."}


@fastapi_app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.function_name(name="fastapi")
@app.route(route="{*route}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
def api(req: func.HttpRequest, context: func.Context) -> func.HttpResponse:
    return func.AsgiMiddleware(fastapi_app).handle(req, context)
