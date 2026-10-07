"use client";

/**
 * Stable canvas entry point. The workspace implementation is kept behind a
 * small boundary so new canvas regions can be extracted without changing the
 * route or mounting contract.
 */
export { default } from "./canvas/CanvasWorkspace";
export * from "./canvas/CanvasWorkspace";
