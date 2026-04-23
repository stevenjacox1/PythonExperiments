import azure.functions as func
import os
from datetime import UTC, datetime
from uuid import uuid4

import httpx
from azure.data.tables import TableServiceClient
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

fastapi_app = FastAPI(title="swa-fastapi-api", version="1.0.0")

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

USDA_BASE_URL = "https://api.nal.usda.gov/fdc/v1"
USDA_API_KEY = os.getenv("USDA_API_KEY")
TABLE_NAME = os.getenv("CALORIE_LOG_TABLE_NAME", "CalorieLog")
TABLE_CONNECTION_STRING = os.getenv("AZURE_TABLE_STORAGE_CONNECTION_STRING")


class ConsumedItemIn(BaseModel):
    user_id: str = Field(default="default-user")
    food_description: str
    serving_size_text: str | None = None
    calorie_basis_text: str | None = None
    quantity: float = Field(default=1.0, gt=0)
    calories_per_serving: float = Field(ge=0)
    consumed_at: datetime | None = None
    fdc_id: int | None = None


class ConsumedItemOut(BaseModel):
    id: str
    user_id: str
    food_description: str
    serving_size_text: str | None = None
    calorie_basis_text: str | None = None
    quantity: float
    calories_per_serving: float
    total_calories: float
    consumed_at: str
    fdc_id: int | None = None


def get_table_client():
    if not TABLE_CONNECTION_STRING:
        return None

    service_client = TableServiceClient.from_connection_string(TABLE_CONNECTION_STRING)
    service_client.create_table_if_not_exists(table_name=TABLE_NAME)
    table_client = service_client.get_table_client(table_name=TABLE_NAME)
    return table_client


def extract_calories(food: dict) -> float:
    for nutrient in food.get("foodNutrients", []):
        name = str(nutrient.get("nutrientName", "")).lower()
        unit = str(nutrient.get("unitName", "")).lower()
        if "energy" in name and unit == "kcal":
            value = nutrient.get("value")
            return float(value) if value is not None else 0.0
    return 0.0


def extract_serving_size_text(food: dict) -> str | None:
    serving_size = food.get("servingSize")
    serving_unit = food.get("servingSizeUnit")
    household_text = food.get("householdServingFullText")

    if serving_size is not None and serving_unit:
        return f"{serving_size} {serving_unit}"
    if household_text:
        return str(household_text)
    return None


def extract_calorie_basis_text(food: dict) -> str:
    serving_size = food.get("servingSize")
    serving_unit = food.get("servingSizeUnit")
    if serving_size is not None and serving_unit:
        return f"per serving ({serving_size} {serving_unit})"
    household_text = food.get("householdServingFullText")
    if household_text:
        return f"per serving ({household_text})"
    return "per 100 g"


def require_usda_api_key() -> str:
    if not USDA_API_KEY:
        raise HTTPException(status_code=500, detail="USDA_API_KEY is not configured.")
    return USDA_API_KEY


@fastapi_app.get("/api")
async def root() -> dict[str, str]:
    return {"message": "FastAPI backend is running on Azure Static Web Apps API."}


@fastapi_app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@fastapi_app.get("/api/foods/search")
async def search_foods(q: str, page_size: int = 10) -> dict:
    api_key = require_usda_api_key()
    payload = {"query": q, "pageSize": page_size}

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                f"{USDA_BASE_URL}/foods/search",
                params={"api_key": api_key},
                json=payload,
            )
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail="USDA search request failed.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Unable to reach USDA FoodData Central.") from exc

    foods = response.json().get("foods", [])
    mapped = [
        {
            "fdc_id": food.get("fdcId"),
            "description": food.get("description"),
            "brand_name": food.get("brandOwner"),
            "calories_per_serving": extract_calories(food),
            "serving_size_text": extract_serving_size_text(food),
            "calorie_basis_text": extract_calorie_basis_text(food),
        }
        for food in foods
    ]
    return {"items": mapped}


@fastapi_app.get("/api/foods/{fdc_id}")
async def get_food(fdc_id: int) -> dict:
    api_key = require_usda_api_key()

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                f"{USDA_BASE_URL}/food/{fdc_id}",
                params={"api_key": api_key},
            )
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail="USDA food lookup failed.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Unable to reach USDA FoodData Central.") from exc

    data = response.json()
    calories = 0.0
    for nutrient in data.get("foodNutrients", []):
        nutrient_name = str(nutrient.get("nutrient", {}).get("name", "")).lower()
        unit_name = str(nutrient.get("nutrient", {}).get("unitName", "")).lower()
        if "energy" in nutrient_name and unit_name == "kcal":
            amount = nutrient.get("amount")
            calories = float(amount) if amount is not None else 0.0
            break

    return {
        "fdc_id": data.get("fdcId"),
        "description": data.get("description"),
        "calories_per_serving": calories,
        "serving_size_text": extract_serving_size_text(data),
        "calorie_basis_text": extract_calorie_basis_text(data),
    }


@fastapi_app.post("/api/consumptions", response_model=ConsumedItemOut)
async def add_consumption(item: ConsumedItemIn) -> ConsumedItemOut:
    table_client = get_table_client()
    if not table_client:
        raise HTTPException(
            status_code=500,
            detail="AZURE_TABLE_STORAGE_CONNECTION_STRING is not configured.",
        )

    consumed_at = item.consumed_at or datetime.now(UTC)
    row_key = str(uuid4())
    total_calories = item.quantity * item.calories_per_serving

    entity = {
        "PartitionKey": item.user_id,
        "RowKey": row_key,
        "food_description": item.food_description,
        "serving_size_text": item.serving_size_text,
        "calorie_basis_text": item.calorie_basis_text,
        "quantity": item.quantity,
        "calories_per_serving": item.calories_per_serving,
        "total_calories": total_calories,
        "consumed_at": consumed_at.isoformat(),
        "fdc_id": item.fdc_id,
    }
    table_client.upsert_entity(entity=entity)

    return ConsumedItemOut(
        id=row_key,
        user_id=item.user_id,
        food_description=item.food_description,
        serving_size_text=item.serving_size_text,
        calorie_basis_text=item.calorie_basis_text,
        quantity=item.quantity,
        calories_per_serving=item.calories_per_serving,
        total_calories=total_calories,
        consumed_at=entity["consumed_at"],
        fdc_id=item.fdc_id,
    )


@fastapi_app.get("/api/consumptions")
async def list_consumptions(user_id: str = "default-user") -> dict:
    table_client = get_table_client()
    if not table_client:
        raise HTTPException(
            status_code=500,
            detail="AZURE_TABLE_STORAGE_CONNECTION_STRING is not configured.",
        )

    entities = table_client.query_entities(
        query_filter="PartitionKey eq @pk",
        parameters={"pk": user_id},
    )

    items = [
        {
            "id": entity["RowKey"],
            "user_id": entity["PartitionKey"],
            "food_description": entity.get("food_description", ""),
            "serving_size_text": entity.get("serving_size_text"),
            "calorie_basis_text": entity.get("calorie_basis_text"),
            "quantity": float(entity.get("quantity", 0)),
            "calories_per_serving": float(entity.get("calories_per_serving", 0)),
            "total_calories": float(entity.get("total_calories", 0)),
            "consumed_at": entity.get("consumed_at", ""),
            "fdc_id": entity.get("fdc_id"),
        }
        for entity in entities
    ]

    items.sort(key=lambda x: x["consumed_at"], reverse=True)
    return {"items": items}


@fastapi_app.delete("/api/consumptions/{item_id}")
async def delete_consumption(item_id: str, user_id: str = "default-user") -> dict:
    table_client = get_table_client()
    if not table_client:
        raise HTTPException(
            status_code=500,
            detail="AZURE_TABLE_STORAGE_CONNECTION_STRING is not configured.",
        )

    try:
        table_client.delete_entity(partition_key=user_id, row_key=item_id)
        return {"message": "Item deleted successfully"}
    except Exception as exc:
        raise HTTPException(status_code=404, detail="Item not found") from exc


@app.function_name(name="fastapi")
@app.route(route="{*route}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def api(req: func.HttpRequest, context: func.Context) -> func.HttpResponse:
    return await func.AsgiMiddleware(fastapi_app).handle_async(req, context)
