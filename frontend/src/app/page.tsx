"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type FoodSearchItem = {
  fdc_id: number;
  description: string;
  brand_name?: string;
  calories_per_serving: number;
};

type ConsumptionItem = {
  id: string;
  user_id: string;
  food_description: string;
  quantity: number;
  calories_per_serving: number;
  total_calories: number;
  consumed_at: string;
  fdc_id?: number;
};

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
  const [consumptions, setConsumptions] = useState<ConsumptionItem[]>([]);
  const [quantityByFood, setQuantityByFood] = useState<Record<number, number>>({});
  const [message, setMessage] = useState("");

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
      const response = await fetch(
        `${apiBaseUrl}/consumptions?user_id=${encodeURIComponent(userId)}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        throw new Error("Failed to load consumptions.");
      }

      const data = (await response.json()) as { items: ConsumptionItem[] };
      setConsumptions(data.items ?? []);
    } catch {
      setMessage("Could not load consumption log. Check backend configuration.");
    }
  }, [apiBaseUrl, userId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadConsumptions();
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [loadConsumptions]);

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
          quantity,
          calories_per_serving: food.calories_per_serving ?? 0,
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

  const totalCalories = consumptions.reduce((sum, item) => sum + item.total_calories, 0);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-12">
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
                    {food.calories_per_serving.toFixed(1)} kcal per serving
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
            <p className="mt-1 text-zinc-600">Total calories logged: {totalCalories.toFixed(1)} kcal</p>

            <div className="mt-4 space-y-3">
              {consumptions.length === 0 ? (
                <p className="text-sm text-zinc-500">No logged items yet.</p>
              ) : (
                consumptions.map((item) => (
                  <article key={item.id} className="rounded-xl border border-zinc-200 p-4">
                    <p className="font-semibold">{item.food_description}</p>
                    <p className="text-sm text-zinc-600">
                      {item.quantity} serving(s) × {item.calories_per_serving.toFixed(1)} kcal
                    </p>
                    <p className="text-sm font-medium text-zinc-800">{item.total_calories.toFixed(1)} kcal</p>
                    <p className="text-xs text-zinc-500">
                      {new Date(item.consumed_at).toLocaleString()}
                    </p>
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
    </div>
  );
}
