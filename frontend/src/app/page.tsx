"use client";

import { useEffect, useMemo, useState } from "react";

export default function Home() {
  const apiBaseUrl = useMemo(
    () => process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api",
    [],
  );
  const [status, setStatus] = useState("Checking API...");

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

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Azure Static Web App Starter
        </p>
        <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">
          Next.js frontend + FastAPI backend
        </h1>
        <p className="max-w-2xl text-lg text-zinc-600">
          This frontend runs on Azure Static Web Apps and calls a Python FastAPI API hosted in the integrated Azure Functions API.
        </p>
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <p className="text-sm uppercase tracking-wide text-zinc-500">Connection check</p>
          <p className="mt-2 text-xl font-medium">{status}</p>
          <p className="mt-3 text-sm text-zinc-500">Using API base URL: {apiBaseUrl}</p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm text-zinc-600">
          <span className="rounded-full border border-zinc-300 bg-white px-4 py-2">Frontend: Next.js + React</span>
          <span className="rounded-full border border-zinc-300 bg-white px-4 py-2">Backend: FastAPI + Azure Functions</span>
          <span className="rounded-full border border-zinc-300 bg-white px-4 py-2">Host: Azure Static Web Apps</span>
        </div>
      </main>
    </div>
  );
}
