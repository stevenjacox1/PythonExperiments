import azure.functions as func
import os
from datetime import UTC, datetime
from uuid import uuid4

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pymysql
from pymysql import MySQLError
from pymysql.cursors import DictCursor
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
MYSQL_HOST = os.getenv("MYSQL_HOST", "localhost")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))
MYSQL_USER = os.getenv("MYSQL_USER", "root")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "")
MYSQL_DATABASE = os.getenv("MYSQL_DATABASE", "calorie_tracker")
MYSQL_TABLE = os.getenv("CALORIE_LOG_TABLE_NAME", "calorie_log")


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


def _validate_table_name(table_name: str) -> str:
    if not table_name.replace("_", "").isalnum():
        raise HTTPException(status_code=500, detail="CALORIE_LOG_TABLE_NAME contains invalid characters.")
    return table_name


def _validate_database_name(database_name: str) -> str:
    if not database_name.replace("_", "").isalnum():
        raise HTTPException(status_code=500, detail="MYSQL_DATABASE contains invalid characters.")
    return database_name


def ensure_database_exists() -> None:
    database_name = _validate_database_name(MYSQL_DATABASE)
    try:
        connection = pymysql.connect(
            host=MYSQL_HOST,
            port=MYSQL_PORT,
            user=MYSQL_USER,
            password=MYSQL_PASSWORD,
            autocommit=True,
        )
    except MySQLError as exc:
        raise HTTPException(status_code=500, detail="Unable to connect to MySQL server.") from exc

    try:
        with connection.cursor() as cursor:
            cursor.execute(f"CREATE DATABASE IF NOT EXISTS {database_name}")
    except MySQLError as exc:
        raise HTTPException(status_code=500, detail="Unable to create or access MySQL database.") from exc
    finally:
        connection.close()


def get_mysql_connection():
    ensure_database_exists()
    try:
        connection = pymysql.connect(
            host=MYSQL_HOST,
            port=MYSQL_PORT,
            user=MYSQL_USER,
            password=MYSQL_PASSWORD,
            database=MYSQL_DATABASE,
        )
        return connection
    except MySQLError as exc:
        print(f"MySQL connection failed for host={MYSQL_HOST} db={MYSQL_DATABASE} user={MYSQL_USER}: {exc}")
        raise HTTPException(status_code=500, detail="Unable to connect to MySQL.") from exc


def ensure_consumption_table(connection) -> None:
    table_name = _validate_table_name(MYSQL_TABLE)
    query = f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            food_description VARCHAR(500) NOT NULL,
            serving_size_text VARCHAR(255) NULL,
            calorie_basis_text VARCHAR(255) NULL,
            quantity DOUBLE NOT NULL,
            calories_per_serving DOUBLE NOT NULL,
            total_calories DOUBLE NOT NULL,
            consumed_at DATETIME(6) NOT NULL,
            fdc_id INT NULL,
            INDEX idx_user_consumed (user_id, consumed_at)
        )
    """
    with connection.cursor() as cursor:
        cursor.execute(query)
    connection.commit()


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
    consumed_at = item.consumed_at or datetime.now(UTC)
    row_key = str(uuid4())
    total_calories = item.quantity * item.calories_per_serving
    normalized_consumed_at = consumed_at.astimezone(UTC).replace(tzinfo=None)

    connection = get_mysql_connection()
    try:
        ensure_consumption_table(connection)
        table_name = _validate_table_name(MYSQL_TABLE)
        insert_query = f"""
            INSERT INTO {table_name} (
                id,
                user_id,
                food_description,
                serving_size_text,
                calorie_basis_text,
                quantity,
                calories_per_serving,
                total_calories,
                consumed_at,
                fdc_id
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """
        with connection.cursor() as cursor:
            cursor.execute(
                insert_query,
                (
                    row_key,
                    item.user_id,
                    item.food_description,
                    item.serving_size_text,
                    item.calorie_basis_text,
                    item.quantity,
                    item.calories_per_serving,
                    total_calories,
                    normalized_consumed_at,
                    item.fdc_id,
                ),
            )
        connection.commit()
    finally:
        connection.close()

    return ConsumedItemOut(
        id=row_key,
        user_id=item.user_id,
        food_description=item.food_description,
        serving_size_text=item.serving_size_text,
        calorie_basis_text=item.calorie_basis_text,
        quantity=item.quantity,
        calories_per_serving=item.calories_per_serving,
        total_calories=total_calories,
        consumed_at=normalized_consumed_at.replace(tzinfo=UTC).isoformat(),
        fdc_id=item.fdc_id,
    )


@fastapi_app.get("/api/consumptions")
async def list_consumptions(user_id: str = "default-user") -> dict:
    connection = get_mysql_connection()
    try:
        ensure_consumption_table(connection)
        table_name = _validate_table_name(MYSQL_TABLE)
        select_query = f"""
            SELECT
                id,
                user_id,
                food_description,
                serving_size_text,
                calorie_basis_text,
                quantity,
                calories_per_serving,
                total_calories,
                consumed_at,
                fdc_id
            FROM {table_name}
            WHERE user_id = %s
            ORDER BY consumed_at DESC
        """
        with connection.cursor(DictCursor) as cursor:
            cursor.execute(select_query, (user_id,))
            rows = cursor.fetchall()
    finally:
        connection.close()

    items = [
        {
            "id": row["id"],
            "user_id": row["user_id"],
            "food_description": row["food_description"] or "",
            "serving_size_text": row["serving_size_text"],
            "calorie_basis_text": row["calorie_basis_text"],
            "quantity": float(row["quantity"]),
            "calories_per_serving": float(row["calories_per_serving"]),
            "total_calories": float(row["total_calories"]),
            "consumed_at": row["consumed_at"].replace(tzinfo=UTC).isoformat(),
            "fdc_id": row["fdc_id"],
        }
        for row in rows
    ]

    return {"items": items}


@fastapi_app.delete("/api/consumptions/{item_id}")
async def delete_consumption(item_id: str, user_id: str = "default-user") -> dict:
    connection = get_mysql_connection()
    try:
        ensure_consumption_table(connection)
        table_name = _validate_table_name(MYSQL_TABLE)
        delete_query = f"DELETE FROM {table_name} WHERE id = %s AND user_id = %s"
        with connection.cursor() as cursor:
            cursor.execute(delete_query, (item_id, user_id))
            affected_rows = cursor.rowcount
        connection.commit()
    finally:
        connection.close()

    if affected_rows == 0:
        raise HTTPException(status_code=404, detail="Item not found")

    return {"message": "Item deleted successfully"}


@app.function_name(name="fastapi")
@app.route(route="{*route}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def api(req: func.HttpRequest, context: func.Context) -> func.HttpResponse:
    return await func.AsgiMiddleware(fastapi_app).handle_async(req, context)
