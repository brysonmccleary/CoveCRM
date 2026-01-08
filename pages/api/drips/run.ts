// pages/api/drips/run.ts

// Public test alias for the actual cron handler.
// No logic changed; we just re-export the exact same handler.
export { default } from "../internal/run-drips";
export { config } from "../internal/run-drips";
