import fp from "fastify-plugin";
import type { ClearingEngine } from "../clearing/clearingEngine.js";

export default fp<{ engine: ClearingEngine }>(
  async (fastify, opts) => {
    fastify.decorate("clearing", opts.engine);
  },
  { name: "boat-clearing-engine" }
);
