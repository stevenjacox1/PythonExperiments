"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type FoodSearchItem = {
  fdc_id: number;
  description: string;
  brand_name?: string;
  serving_size_text?: string | null;
  calorie_basis_text?: string;
  calories_per_serving: number;
};

type ConsumptionItem = {
  id: string;
  user_id: string;
  food_description: string;
  serving_size_text?: string | null;
  calorie_basis_text?: string | null;
  quantity: number;
  calories_per_serving: number;
  total_calories: number;
  consumed_at: string;
  fdc_id?: number;
};

// Mock data generator for testing
function generateMockData(userId: string, daysBack: number): ConsumptionItem[] {
  const mockItems = [
    { description: "Banana", calories: 89, servingSize: "1 medium (118g)", basis: "per serving" },
    { description: "Chicken Breast", calories: 165, servingSize: "100g", basis: "per 100 g" },
    { description: "Brown Rice", calories: 112, servingSize: "1 cup cooked (195g)", basis: "per serving" },
    { description: "Broccoli", calories: 55, servingSize: "1 cup (156g)", basis: "per serving" },
    { description: "Salmon Fillet", calories: 280, servingSize: "100g", basis: "per 100 g" },
    { description: "Greek Yogurt", calories: 130, servingSize: "1 cup (227g)", basis: "per serving" },
    { description: "Almonds", calories: 579, servingSize: "100g", basis: "per 100 g" },
    { description: "Whole Wheat Bread", calories: 80, servingSize: "1 slice (28g)", basis: "per serving" },
  ];

  const result: ConsumptionItem[] = [];

  for (let dayOffset = 0; dayOffset <= daysBack; dayOffset++) {
    const date = new Date();
    date.setDate(date.getDate() - dayOffset);
    date.setHours(Math.floor(Math.random() * 20), Math.floor(Math.random() * 60), 0, 0);

    // 2-4 items per day
    const itemsPerDay = Math.floor(Math.random() * 3) + 2;

    for (let i = 0; i < itemsPerDay; i++) {
      const mockItem = mockItems[Math.floor(Math.random() * mockItems.length)];
      const quantity = Math.random() < 0.5 ? 1 : Math.round(Math.random() * 2 * 4) / 4;

      result.push({
        id: `mock-${dayOffset}-${i}-${Math.random().toString(36).substr(2, 9)}`,
        user_id: userId,
        food_description: mockItem.description,
        serving_size_text: mockItem.servingSize,
        calorie_basis_text: mockItem.basis,
        quantity,
        calories_per_serving: mockItem.calories,
        total_calories: mockItem.calories * quantity,
        consumed_at: date.toISOString(),
      });
    }
  }

  return result.sort((a, b) => new Date(b.consumed_at).getTime() - new Date(a.consumed_at).getTime());
}

export default function Home() {
  const apiBaseUrl = useMemo(
    () => process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api",
    [],
  );
  const userId = "default-user";

  const [status, setStatus] = useState("Checking API...");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<FoodSearchItem[]>([]);
  const [allConsumptions, setAllConsumptions] = useState<ConsumptionItem[]>([]);
  const [quantityByFood, setQuantityByFood] = useState<Record<number, number>>({});
  const [message, setMessage] = useState("");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [useMockData, setUseMockData] = useState(false);
  const [pendingDeleteItem, setPendingDeleteItem] = useState<ConsumptionItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    async function checkApi() {
      try {
        const response = await fetch(`${apiBaseUrl}/health`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Health check failed with status ${response.status}`);
        }

        const data = (await response.json()) as { status?: string };
        setStatus(`API status: ${data.status ?? "unknown"}`);
      } catch {
        setStatus("API status: unavailable");
      }
    }

    void checkApi();
  }, [apiBaseUrl]);

  const loadConsumptions = useCallback(async () => {
    try {
      if (useMockData) {
        const mockData = generateMockData(userId, 4);
        setAllConsumptions(mockData);
        return;
      }

      const response = await fetch(
        `${apiBaseUrl}/consumptions?user_id=${encodeURIComponent(userId)}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        throw new Error("Failed to load consumptions.");
      }

      const data = (await response.json()) as { items: ConsumptionItem[] };
      setAllConsumptions(data.items ?? []);
    } catch {
      setMessage("Could not load consumption log. Check backend configuration.");
    }
  }, [apiBaseUrl, userId, useMockData]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadConsumptions();
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [loadConsumptions]);

  const getDateString = (date: Date) => {
    return date.toISOString().split("T")[0];
  };

  const isSameDay = (date1: Date, date2: Date) => {
    return getDateString(date1) === getDateString(date2);
  };

  const consumptions = useMemo(() => {
    return allConsumptions.filter((item) => isSameDay(new Date(item.consumed_at), selectedDate));
  }, [allConsumptions, selectedDate]);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) {
      return;
    }

    setSearching(true);
    setMessage("");
    try {
      const response = await fetch(
        `${apiBaseUrl}/foods/search?q=${encodeURIComponent(query.trim())}&page_size=8`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        throw new Error("Search failed.");
      }

      const data = (await response.json()) as { items: FoodSearchItem[] };
      setResults(data.items ?? []);
      if (!data.items?.length) {
        setMessage("No foods found for that search.");
      }
    } catch {
      setMessage("USDA search failed. Verify USDA_API_KEY in the backend settings.");
    } finally {
      setSearching(false);
    }
  }

  async function addConsumption(food: FoodSearchItem) {
    const quantity = quantityByFood[food.fdc_id] ?? 1;
    try {
      const response = await fetch(`${apiBaseUrl}/consumptions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: userId,
          food_description: food.description,
          serving_size_text: food.serving_size_text,
          calorie_basis_text: food.calorie_basis_text,
          quantity,
          calories_per_serving: food.calories_per_serving ?? 0,
          consumed_at: selectedDate.toISOString(),
          fdc_id: food.fdc_id,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save item.");
      }

      setMessage(`Saved ${food.description} to your consumption log.`);
      await loadConsumptions();
    } catch {
      setMessage("Could not save item. Verify Azure Table Storage configuration.");
    }
  }

  async function deleteConsumption(itemId: string) {
    try {
      setIsDeleting(true);

      if (useMockData) {
        setAllConsumptions((prev) => prev.filter((item) => item.id !== itemId));
        setMessage("Item deleted successfully.");
        return;
      }

      const response = await fetch(
        `${apiBaseUrl}/consumptions/${encodeURIComponent(itemId)}?user_id=${encodeURIComponent(userId)}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        throw new Error("Failed to delete item.");
      }

      setMessage("Item deleted successfully.");
      await loadConsumptions();
    } catch {
      setMessage("Could not delete item. Check backend configuration.");
    } finally {
      setIsDeleting(false);
      setPendingDeleteItem(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDeleteItem) {
      return;
    }
    await deleteConsumption(pendingDeleteItem.id);
  }

  const previousDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() - 1);
    setSelectedDate(newDate);
  };

  const nextDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + 1);
    setSelectedDate(newDate);
  };

  const goToToday = () => {
    setSelectedDate(new Date());
  };

  const totalCalories = consumptions.reduce((sum, item) => sum + item.total_calories, 0);
  const today = getDateString(new Date());
  const selectedDateString = getDateString(selectedDate);
  const isToday = selectedDateString === today;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      {/* Navigation Bar */}
      <nav className="sticky top-0 z-40 border-b border-zinc-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold">Calorie Log</h1>
            <div className="flex items-center gap-2">
              <button
                onClick={previousDay}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100"
              >
                ← Prev
              </button>
              <div className="min-w-40 text-center">
                <span className="text-sm font-medium">
                  {selectedDate.toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                {isToday && <span className="ml-2 text-xs text-zinc-500">(Today)</span>}
              </div>
              <button
                onClick={nextDay}
                disabled={!isToday && selectedDateString > today}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next →
              </button>
              {!isToday && (
                <button
                  onClick={goToToday}
                  className="rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm font-medium hover:bg-zinc-200"
                >
                  Today
                </button>
              )}
            </div>
          </div>
          <button
            onClick={() => {
              setUseMockData(!useMockData);
              void loadConsumptions();
            }}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${
              useMockData
                ? "bg-blue-100 text-blue-900 hover:bg-blue-200"
                : "border border-zinc-300 hover:bg-zinc-100"
            }`}
          >
            {useMockData ? "Using Mock Data" : "Load Mock Data"}
          </button>
        </div>
      </nav>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12">
        <header className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Calorie Tracker
          </p>
          <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">
            Track meals with USDA FoodData Central
          </h1>
          <p className="max-w-3xl text-zinc-600">
            Search foods from USDA, log what you consumed, and persist your entries in Azure Table Storage.
          </p>
        </header>

        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-sm uppercase tracking-wide text-zinc-500">Connection</p>
          <p className="mt-2 text-lg font-medium">{status}</p>
          <p className="mt-1 text-sm text-zinc-500">API base URL: {apiBaseUrl}</p>
        </section>

        <div className="grid gap-8 lg:grid-cols-2">
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-2xl font-semibold">Find Food</h2>
            <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={handleSearch}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search USDA foods (e.g., banana, chicken breast)"
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none ring-zinc-300 focus:ring"
              />
              <button
                type="submit"
                className="rounded-xl bg-zinc-900 px-5 py-3 font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
                disabled={searching}
              >
                {searching ? "Searching..." : "Search"}
              </button>
            </form>

            <div className="mt-5 space-y-3">
              {results.map((food) => (
                <article key={food.fdc_id} className="rounded-xl border border-zinc-200 p-4">
                  <p className="font-semibold">{food.description}</p>
                  <p className="text-sm text-zinc-600">
                    {food.brand_name ? `${food.brand_name} · ` : ""}
                    {food.calories_per_serving.toFixed(1)} calories {food.calorie_basis_text ?? "per serving"}
                  </p>
                  <p className="text-sm text-zinc-500">
                    Serving size: {food.serving_size_text ?? "Not specified by USDA"}
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <label className="flex items-center gap-2 text-sm">
                      Qty
                      <input
                        type="number"
                        min={0.25}
                        step={0.25}
                        value={quantityByFood[food.fdc_id] ?? 1}
                        onChange={(e) =>
                          setQuantityByFood((prev) => ({
                            ...prev,
                            [food.fdc_id]: Number(e.target.value),
                          }))
                        }
                        className="w-24 rounded-lg border border-zinc-300 px-2 py-1"
                      />
                    </label>
                    <button
                      type="button"
                      className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100"
                      onClick={() => void addConsumption(food)}
                    >
                      Add to Log
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-2xl font-semibold">Consumption Log</h2>
            <p className="mt-1 text-zinc-600">Total calories logged: {totalCalories.toFixed(1)} calories</p>

            <div className="mt-4 space-y-3">
              {consumptions.length === 0 ? (
                <p className="text-sm text-zinc-500">No logged items for this day.</p>
              ) : (
                consumptions.map((item) => (
                  <article key={item.id} className="rounded-xl border border-zinc-200 p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-semibold">{item.food_description}</p>
                        <p className="text-sm text-zinc-500">
                          Serving size: {item.serving_size_text ?? "Not specified"}
                        </p>
                        <p className="text-sm text-zinc-600">
                          {item.quantity} serving(s) × {item.calories_per_serving.toFixed(1)} calories {item.calorie_basis_text ?? "per serving"}
                        </p>
                        <p className="text-sm font-medium text-zinc-800">{item.total_calories.toFixed(1)} calories</p>
                        <p className="text-xs text-zinc-500">
                          {new Date(item.consumed_at).toLocaleTimeString()}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPendingDeleteItem(item)}
                        className="ml-2 rounded-lg bg-red-100 px-2 py-1 text-sm text-red-700 hover:bg-red-200"
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>

        {message ? (
          <section className="rounded-xl border border-zinc-300 bg-zinc-100 px-4 py-3 text-sm text-zinc-700">
            {message}
          </section>
        ) : null}
      </main>

      {pendingDeleteItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 px-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl">
            <h3 className="text-xl font-semibold text-zinc-900">Delete log item?</h3>
            <p className="mt-2 text-sm text-zinc-600">
              This will remove
              <span className="font-semibold text-zinc-800"> {pendingDeleteItem.food_description}</span>
              from your log for this day.
            </p>
            <p className="mt-1 text-xs text-zinc-500">This action cannot be undone.</p>

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingDeleteItem(null)}
                disabled={isDeleting}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={isDeleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeleting ? "Deleting..." : "Delete Item"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
