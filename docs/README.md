# Easy Go Docs

This directory documents the browser app, the in-browser KataGo engine, and the
developer workflow.

## Start Here

- [Architecture](architecture.md): how React, Zustand, the move tree, storage,
  and the engine worker fit together.
- [Engine](engine.md): model loading, TensorFlow.js backends, feature
  extraction, search, analysis modes, and AI play strategies.
- [Development](development.md): setup, scripts, project layout, model assets,
  testing, and troubleshooting.
- [Deployment](deployment.md): Cloudflare Worker hosting, base paths, COOP/COEP
  headers, and update behavior.
- [Runtime diagrams](diagram.md): compact diagrams for the main app flow,
  analysis flow, and persistent storage.

## Source Map

| Area | Main files |
| --- | --- |
| App shell | `src/App.tsx`, `src/main.tsx`, `src/components/BattleApp.tsx` |
| UI components | `src/components/` (match card, board grid, actions, dialogs, toasts) |
| UI hooks | `src/hooks/` (model manager + B18 download, tri-state hint/score toggles, score judgment, win-rate display) |
| Global state | `src/store/gameStore.ts` plus `src/store/settings.ts`, `src/store/gameTree.ts`, `src/store/analysis.ts`, `src/store/analysisActions.ts`, `src/store/aiPlayer.ts` |
| Engine client and worker | `src/engine/katago/client.ts`, `src/engine/katago/worker.ts` |
| MCTS and board engine | `src/engine/katago/analyzeMcts.ts`, `src/engine/katago/fastBoard.ts` |
| Model parsing and inference | `src/engine/katago/loadModelV8.ts`, `src/engine/katago/modelV8.ts` |
| Utilities | `src/utils/` (game logic, board geometry, formatting, territory scoring, storage, sound, analysis queue) |
| Build and deployment | `vite.config.ts`, `worker/index.ts`, `.github/workflows/` |
