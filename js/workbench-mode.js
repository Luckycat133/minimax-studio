// The legacy workbench makes one explicit, fail-closed routing decision.
// Keep provider adapters and browser UI out of this policy.
const WORKBENCH_MODE = Object.freeze({
  UNAVAILABLE: 'unavailable',
  DIRECT_EXPERIMENT: 'direct-experiment',
  CONTROLLED_FIXTURE: 'controlled-fixture',
  LEGACY_BACKEND: 'legacy-backend',
});

function isExplicitLoopbackExperiment(page) {
  return page.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(page.hostname) &&
    new URLSearchParams(page.search).get('mode') === 'direct-experiment';
}

function workbenchModeForHealth(health) {
  if (health?.status !== 'ok') return WORKBENCH_MODE.UNAVAILABLE;
  if (health.service === 'minimax-studio-local' && health.mode === 'fixture' && health.version === 1) {
    return WORKBENCH_MODE.CONTROLLED_FIXTURE;
  }
  if (health.service === 'minimax-studio-backend') return WORKBENCH_MODE.LEGACY_BACKEND;
  return WORKBENCH_MODE.UNAVAILABLE;
}

async function resolveWorkbenchMode(page, fetchHealth = fetch) {
  if (isExplicitLoopbackExperiment(page)) return WORKBENCH_MODE.DIRECT_EXPERIMENT;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetchHealth('/api/health', {
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      headers: {Accept: 'application/json'},
    });
    const mediaType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (response.ok && mediaType === 'application/json') {
      return workbenchModeForHealth(await response.json());
    }
  } catch {
    // An unreachable, redirected, or malformed backend is never Direct Mode.
  } finally {
    clearTimeout(timeoutId);
  }
  return WORKBENCH_MODE.UNAVAILABLE;
}
