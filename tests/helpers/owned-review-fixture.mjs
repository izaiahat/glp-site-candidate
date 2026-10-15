import {createReviewServer} from '../../scripts/serve-review.mjs';

// Each browser collection owns an ephemeral loopback server for this checkout.
// Callers install their existing GET-only/no-tracking interception before navigation.
// No detached process, fixed-port fallback, public writes or local capture DB.
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
