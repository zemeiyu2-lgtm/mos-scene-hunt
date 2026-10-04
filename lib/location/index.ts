/**
 * lib/location - public surface.
 *
 * Rule of the codebase: no React component computes GPS math inline.
 * Everything geospatial goes through this barrel.
 */

export * from "./types";
export * from "./geodesy";
export * from "./provider";
export * from "./simulator";
