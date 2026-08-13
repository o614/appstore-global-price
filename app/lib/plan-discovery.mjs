function numericPrice(text) {
  let value = String(text ?? "").replace(/[^\d.,]/gu, "");
  if (!value) return null;
  const comma = value.lastIndexOf(",");
  const dot = value.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    const thousands = decimal === "," ? /\./gu : /,/gu;
    value = value.replace(thousands, "").replace(decimal, ".");
  } else if (comma >= 0) {
    const decimals = value.length - comma - 1;
    value = decimals === 2 ? value.replace(",", ".") : value.replace(/,/gu, "");
  } else if (dot >= 0) {
    const decimals = value.length - dot - 1;
    if (decimals !== 2) value = value.replace(/\./gu, "");
  }
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function maximumOccurrences(app) {
  const maximum = new Map();
  const firstSeen = [];
  for (const region of app.regions ?? []) {
    const counts = new Map();
    for (const item of region.items ?? []) {
      if (!maximum.has(item.name)) firstSeen.push(item.name);
      counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
    }
    for (const [name, count] of counts) maximum.set(name, Math.max(maximum.get(name) ?? 0, count));
  }
  return { maximum, firstSeen };
}

function priceRatio(app, name, numeratorOccurrence, denominatorOccurrence) {
  const ratios = [];
  for (const region of app.regions ?? []) {
    const matches = (region.items ?? []).filter((item) => item.name === name);
    const numerator = numericPrice(matches[numeratorOccurrence]?.price);
    const denominator = numericPrice(matches[denominatorOccurrence]?.price);
    if (numerator && denominator) ratios.push(numerator / denominator);
  }
  if (!ratios.length) return null;
  ratios.sort((left, right) => left - right);
  return ratios[Math.floor(ratios.length / 2)];
}

function inferredPeriod(name, occurrence, count, app, allowPriceInference) {
  const normalized = name.toLowerCase();
  if (/annual|year|12\s*month|全年|年卡|年费|年付|包年/u.test(normalized)) return "年付";
  if (/weekly|week|7\s*day|周卡|周付|一周/u.test(normalized)) return "周付";
  if (/monthly|month|月卡|月费|月付|1个月|一个月|自動續費月/u.test(normalized)) return "月付";
  if (/credit|star|券|boost|promote|notabot|package|礼物|加油包|次卡/u.test(normalized)) return "一次性";

  if (allowPriceInference && count > 1) {
    if (occurrence === 0) {
      const laterIsAnnual = Array.from({ length: count - 1 }, (_, index) => priceRatio(app, name, index + 1, 0))
        .some((ratio) => ratio !== null && ratio >= 6 && ratio <= 15);
      if (laterIsAnnual) return "月付";
    } else {
      const ratio = priceRatio(app, name, occurrence, 0);
      if (ratio !== null && ratio >= 6 && ratio <= 15) return "年付";
    }
  }
  return "公开项目";
}

const PRIMARY_PERIODS = new Set(["月付", "年付", "周付"]);
const PRIMARY_NAME_PATTERN = /(?:monthly|month|annual|yearly|year|weekly|week|subscription|membership|premium|plus|pro\+?|family|individual|lifetime|unlimited|premiere|career|business|recruiter|navigator|classic|essential|lite|max|ultra|会员|订阅|月付|年付|周付|包月|包年|家庭方案|个人方案)/iu;
const SECONDARY_NAME_PATTERN = /(?:credit|coin|gem|token|\bbits?\b|boost|star(?:s| bundle)?|pack|bundle|offer|gift|sticker|avatar|hat|pet|skin|ticket|item|moves?|lives?|barrel|cart|chest|pok[ée]coin|keys?|gold|unlock|worlds?|story|audio|preset|content|marketplace|snacks?|coffee|flower|meal|charged|land on the moon|金币|宝石|积分|代币|礼包|贴纸|头像|道具|解锁)/iu;

function displayGroupForPlan(plan) {
  if (PRIMARY_PERIODS.has(plan.period)) return "primary";
  if (plan.period === "一次性") return "other";
  const searchable = `${plan.label ?? ""} ${(plan.aliases ?? []).join(" ")}`;
  if (SECONDARY_NAME_PATTERN.test(searchable)) return "other";
  return PRIMARY_NAME_PATTERN.test(searchable) ? "primary" : "other";
}

function stableHash(value) {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function planId(name, occurrence) {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 42) || "item";
  return `auto-${slug}-${occurrence + 1}-${stableHash(`${name}\u0000${occurrence}`)}`;
}

/**
 * Curated definitions improve labels and billing periods. They never hide a
 * public item: every uncovered name/occurrence from the snapshot is appended.
 */
export function discoverPlans(app, curatedPlans = []) {
  const { maximum, firstSeen } = maximumOccurrences(app);
  const plans = curatedPlans
    .filter((plan) => plan.aliases.some((name) => (maximum.get(name) ?? 0) > (plan.occurrence ?? 0)))
    .map((plan) => {
      const copy = { ...plan, aliases: [...plan.aliases] };
      return { ...copy, displayGroup: displayGroupForPlan(copy) };
    });

  for (const name of firstSeen) {
    const count = maximum.get(name) ?? 0;
    for (let occurrence = 0; occurrence < count; occurrence += 1) {
      const covered = plans.some((plan) => plan.aliases.includes(name) && (plan.occurrence ?? 0) === occurrence);
      if (covered) continue;
      const allowPriceInference = curatedPlans.some((plan) => plan.aliases.includes(name));
      const period = inferredPeriod(name, occurrence, count, app, allowPriceInference);
      const periodIsDistinct = count > 1 && ["月付", "年付", "周付"].includes(period);
      const discoveredPlan = {
        id: planId(name, occurrence),
        label: count > 1 && !periodIsDistinct && occurrence > 0 ? `${name} #${occurrence + 1}` : name,
        period,
        aliases: [name],
        occurrence,
        discovered: true,
      };
      plans.push({ ...discoveredPlan, displayGroup: displayGroupForPlan(discoveredPlan) });
    }
  }
  return plans;
}

export function uncoveredItems(app, plans) {
  const { maximum } = maximumOccurrences(app);
  const missing = [];
  for (const [name, count] of maximum) {
    for (let occurrence = 0; occurrence < count; occurrence += 1) {
      if (!plans.some((plan) => plan.aliases.includes(name) && (plan.occurrence ?? 0) === occurrence)) {
        missing.push({ name, occurrence });
      }
    }
  }
  return missing;
}
