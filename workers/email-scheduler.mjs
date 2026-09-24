import config from "../data/resend-email-machine.json" with { type: "json" };
import { runDripScheduler } from "../src/resend-email-machine.mjs";

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runDripScheduler(env, config));
  },
};
