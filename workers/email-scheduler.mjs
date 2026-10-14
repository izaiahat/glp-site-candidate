import config from "../data/resend-email-machine.json" with { type: "json" };
import { runDripScheduler } from "../src/resend-email-machine.mjs";

export async function runEmailScheduler(env, now = new Date(), fetchImpl = fetch) {
  const result = await runDripScheduler(env, config, now, fetchImpl);
  const receipt = { job: 'glp47-onboarding', source_head: env.ONBOARDING_SOURCE_HEAD || null, at: now.toISOString(), ...result };
  console.log(JSON.stringify(receipt));
  return receipt;
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runEmailScheduler(env));
  },
};
