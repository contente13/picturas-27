// Publish only after every source has a persisted Process record. A fast worker
// must never see an incomplete batch when deciding whether the run is finished.
async function dispatchProcessBatch(jobs, { create, remove, send }) {
  const created = [];
  try {
    for (const job of jobs) {
      const doc = await create(job.process);
      created.push(doc);
      job.created = doc;
    }
  } catch (error) {
    await Promise.allSettled(created.map(remove));
    throw error;
  }
  for (const job of jobs) await send(job);
}

module.exports = { dispatchProcessBatch };
