import {createReviewServer} from '../../scripts/serve-review.mjs';

// Each browser collection owns an ephemeral loopback server for this checkout.
// Callers install their existing GET-only/no-tracking interception before navigation.
// No detached process, fixed-port fallback, public writes or local capture DB.
// A navigation timeout must not leave a page alive for the next measurement.
// Retain the caller's native action/navigation deadlines; isolate ownership,
// rather than retrying, suppressing failed actions or changing their budgets.
export async function withReviewPage(context, collect) {
  const page = await context.newPage();
  try {
    return await collect(page);
  } finally {
    await page.close();
  }
}

export async function withReviewFixture(collect) {
  const server = await createReviewServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    return await collect(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}
