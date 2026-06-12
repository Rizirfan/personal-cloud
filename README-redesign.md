# Redesign notes

This repository has received an initial redesign scaffold.

- A minimal Vite + React client was added under `client/` with Tailwind configuration.
- Root `package.json` scripts updated: `client` and `dev` (dev uses `concurrently`, install manually).

Next steps:
- Run `npm install` in the repo root and `npm install` inside `client/`.
- Start the server: `npm start`.
- Start the client: `npm --prefix client run dev`.
