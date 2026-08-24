export function isPublishableRegion(region) {
  if (!region || !Array.isArray(region.items) || region.itemCount !== region.items.length) return false;
  if (region.status === "iap-section-missing" || region.status === "official-price-page-missing" || region.status === "error:HTTP 404") {
    return region.items.length === 0;
  }
  return typeof region.status === "string" && region.status.startsWith("ok-") && region.items.length > 0;
}

export function findPreviousRegion(snapshot, appId, regionCode) {
  const region = snapshot?.apps
    ?.find((app) => app.id === appId)
    ?.regions?.find((candidate) => candidate.region === regionCode);
  return isPublishableRegion(region) ? region : null;
}

export function hasDegradedIdentity(region) {
  return region?.status !== "ok-structured" && Boolean(region?.identityStatus);
}

export function resolveRegionWithFallback({ appId, regionCode, candidate, fallbackSnapshot }) {
  const previous = findPreviousRegion(fallbackSnapshot, appId, regionCode);
  if (isPublishableRegion(candidate)) {
    if (hasDegradedIdentity(candidate) && previous?.status === "ok-structured") {
      return {
        region: previous,
        fallback: {
          appId,
          region: regionCode,
          reason: `identity:${candidate.identityStatus}`,
        },
      };
    }
    return { region: candidate, fallback: null };
  }
  if (!previous) return { region: null, fallback: null };
  return {
    region: previous,
    fallback: {
      appId,
      region: regionCode,
      reason: candidate?.status ?? "unknown-region-result",
    },
  };
}
