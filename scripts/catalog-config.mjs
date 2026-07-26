export const fallbackGroupByAppleCategory = {
  Productivity: "效率工具",
  Business: "效率工具",
  "Social Networking": "社交平台",
  Entertainment: "影音娱乐",
  "Photo & Video": "影音娱乐",
  Music: "影音娱乐",
  Sports: "体育",
  News: "资讯阅读",
  Games: "游戏",
};

export function inferCatalogGroup(category) {
  return fallbackGroupByAppleCategory[category] ?? "其他应用";
}

export function normalizeCatalogEntries(rawApps) {
  if (!Array.isArray(rawApps) || rawApps.length === 0) {
    throw new Error("Catalog configuration must contain a non-empty apps array");
  }

  const entries = rawApps.map((rawEntry, index) => {
    const entry = typeof rawEntry === "string" ? { id: rawEntry } : rawEntry;
    if (!entry || typeof entry !== "object") {
      throw new Error(`Catalog entry ${index + 1} must be an App ID or an object`);
    }
    const id = String(entry.id ?? "").trim();
    if (!id) throw new Error(`Catalog entry ${index + 1} is missing an App ID`);
    if (!entry.metadata && !/^\d+$/u.test(id)) {
      throw new Error(`Catalog entry ${id} must use a numeric App Store ID`);
    }
    if (entry.regionalAppIds !== undefined && (!entry.regionalAppIds || typeof entry.regionalAppIds !== "object" || Array.isArray(entry.regionalAppIds))) {
      throw new Error(`Catalog entry ${id} regionalAppIds must be an object`);
    }
    const regionalAppIds = entry.regionalAppIds === undefined
      ? undefined
      : Object.fromEntries(
        Object.entries(entry.regionalAppIds).map(([region, appId]) => {
          const normalizedRegion = String(region).trim().toLowerCase();
          const normalizedAppId = String(appId).trim();
          if (!/^[a-z]{2}$/u.test(normalizedRegion)) {
            throw new Error(`Catalog entry ${id} has an invalid region code: ${region}`);
          }
          if (!/^\d+$/u.test(normalizedAppId)) {
            throw new Error(`Catalog entry ${id} has an invalid regional App ID for ${normalizedRegion}`);
          }
          return [normalizedRegion, normalizedAppId];
        }),
      );
    if (entry.excludeItemNames !== undefined && !Array.isArray(entry.excludeItemNames)) {
      throw new Error(`Catalog entry ${id} excludeItemNames must be an array`);
    }
    const excludeItemNames = entry.excludeItemNames === undefined
      ? undefined
      : entry.excludeItemNames.map((name) => String(name).trim()).filter(Boolean);
    return {
      ...entry,
      id,
      query: typeof entry.query === "string" && entry.query.trim() ? entry.query.trim() : undefined,
      group: typeof entry.group === "string" && entry.group.trim() ? entry.group.trim() : undefined,
      regionalAppIds,
      excludeItemNames,
    };
  });

  const duplicateIds = entries
    .map((entry) => entry.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateIds.length) throw new Error(`Catalog App IDs must be unique: ${[...new Set(duplicateIds)].join(", ")}`);
  return entries;
}
