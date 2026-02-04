# Contributing to Obsidian Binance/OKX Replay Plugin

Thank you for your interest in contributing! This project follows strict architectural principles to ensure maintainability and scalability.

## 🏗️ Architecture Principles

We adhere to **Clean Architecture** and **SOLID** principles.

1.  **Dependency Rule**: Source code dependencies only point inwards. Inner circles (Core/Models) know nothing about outer circles (Infrastructure/Views).
    *   `src/core` & `src/models`: Stable, domain-centric. No Obsidian API calls here (except strictly typed interfaces).
    *   `src/services`: Application business rules. Orchestrates flow between Domain and Infrastructure.
    *   `src/infrastructure`: Implementation details (Obsidian API, Binance API, OKX API).
    *   `src/views`: UI components (React/Svelte/Native DOM).

2.  **Dependency Injection**: Use `ServiceContainer` for managing service lifecycles. Do not instantiate services manually in `main.ts` or inside other services if possible.

## 🛠️ Development Workflow

1.  **Setup**:
    ```bash
    npm install
    ```
2.  **Dev Server**:
    ```bash
    npm run dev
    ```
3.  **Testing**:
    *   We use `vitest` for unit testing.
    *   Run tests before submitting PR:
        ```bash
        npm test
        ```
    *   **New Features MUST have tests.**

## 🧩 Adding a New Exchange

To add a new exchange (e.g., Bybit), follow the **Adapter Pattern**:

1.  Create `src/infrastructure/bybit/`.
2.  Implement `IDataAdapter` interface.
3.  Create a specific `TradeProcessor` (mirroring `OkxUMFuturesTradeProcessor`).
4.  Register in `ServiceContainer.ts`.

## 📝 Style Guide

*   **Linting**: Run `npm run lint` (once configured) before commit.
*   **Comments**: Add JSDoc to all public methods and interfaces.
*   **Commits**: Use semantic commit messages (feat, fix, docs, refactor).

## 🤝 Code Review Checklist

*   [ ] Does this change respect the layer boundaries?
*   [ ] Are complex algorithms (like trade aggregation) tested?
*   [ ] Is the code readable? (Variable names, extraction of complex logic)

Happy Coding!
