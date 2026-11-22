function reportProgress(job, progress) {
    job.progress = progress;
    for (const listener of job.listeners) listener(progress);
}
function subscribeProgress(job, listener) {
    if (typeof listener !== 'function') return () => {};
    job.listeners.add(listener);
    if (job.progress) listener(job.progress);
    return () => job.listeners.delete(listener);
}
module.exports = { reportProgress, subscribeProgress };
