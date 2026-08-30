function reportAppIds(report = {}) {
  return new Set([
    ...(report.fallbacks ?? []).map((entry) => String(entry?.appId ?? "")),
    ...(report.deferredApps ?? []).map((entry) => String(entry?.appId ?? "")),
  ].filter(Boolean));
}

function previousVerificationMap(snapshot = {}) {
  return new Map((snapshot.apps ?? []).map((app) => [
    String(app.id),
    app.verifiedAt ?? snapshot.generatedAt,
  ]));
}

export function retainVerifiedSnapshot(snapshot, ids) {
  const allowed = new Set(ids.map(String));
  return {
    ...snapshot,
    apps: (snapshot.apps ?? [])
      .filter((app) => allowed.has(String(app.id)))
      .map((app) => ({
        ...app,
        verifiedAt: app.verifiedAt ?? snapshot.generatedAt,
      })),
    updateReport: { fallbackCount: 0, fallbacks: [], deferredApps: [] },
  };
}

export function stampVerifiedApps(snapshot, previousSnapshot = {}) {
  const unverifiedAppIds = reportAppIds(snapshot.updateReport);
  const previousVerifiedAt = previousVerificationMap(previousSnapshot);
  return {
    ...snapshot,
    apps: (snapshot.apps ?? []).map((app) => {
      const appId = String(app.id);
      const verifiedAt = unverifiedAppIds.has(appId)
        ? previousVerifiedAt.get(appId) ?? app.verifiedAt ?? previousSnapshot.generatedAt
        : snapshot.generatedAt;
      return verifiedAt ? { ...app, verifiedAt } : app;
    }),
  };
}
