import { getApplePageUrl, numericAmount, regionalPrices } from "./apple-price-regions.mjs";

const PLANS = [
  { id: "individual", name: "Apple Music Individual" },
  { id: "family", name: "Apple Music Family" },
  { id: "student", name: "Apple Music Student" },
];

function decodeHtml(text) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return text
    .replace(/&#x([\da-f]+);/giu, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&#(\d+);/gu, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&([a-z]+);/giu, (entity, name) => named[name.toLowerCase()] ?? entity);
}

function plainText(html) {
  return decodeHtml(html.replace(/<br\s*\/?>/giu, " ").replace(/<[^>]+>/gu, " "))
    .replace(/[\s\u00a0]+/gu, " ")
    .trim();
}

function galleryCards(html) {
  const cards = [...html.matchAll(/<li\b[^>]*>/giu)]
    .filter((match) => /\bclass=(?:"[^"]*\bgallery-item\b[^"]*"|'[^']*\bgallery-item\b[^']*')/iu.test(match[0]));
  return cards.map((match, index) => ({
    tag: match[0],
    html: html.slice(match.index, cards[index + 1]?.index ?? html.length),
  }));
}

function planHeadlines(html, planId) {
  return galleryCards(html)
    .filter(({ tag }) => new RegExp(`\\bid=(?:"${planId}"|'${planId}')`, "iu").test(tag))
    // Some localized Apple pages omit the closing </p> before the plan list.
    // Treat the next list or container boundary as the end of the headline too.
    .map(({ html: cardHtml }) => cardHtml.match(/<p\b[^>]*\bclass=(?:"[^"]*\btile-headline\b[^"]*"|'[^']*\btile-headline\b[^']*')[^>]*>([\s\S]*?)(?:<\/p>|<ul\b|<\/div>)/iu))
    .filter(Boolean)
    .map((headline) => plainText(headline[1]));
}

function isPromotionalMusicHeadline(headline) {
  return /\b(?:free|trial|offer|new subscriber)s?\b|oferta|prueba|essai|gratuit|kostenlos|aktion|新規|無料|限时|限時|優惠|优惠|\b\d+\s*(?:months?|meses|mois|monate)\b/iu.test(headline);
}

export function getAppleMusicPageUrl(region) {
  return getApplePageUrl(region, "apple-music");
}

export function extractAppleMusicPlans(html, region) {
  const matches = PLANS.map((plan) => {
    const options = planHeadlines(html, plan.id)
      .map((headline) => ({ headline, candidates: regionalPrices(headline, region) }))
      .filter((option) => option.candidates.length > 0);
    // Apple may put an introductory offer before the normal recurring price,
    // or temporarily render a promotional card beside the regular card.
    // The public comparison tracks the recurring price, not the campaign.
    return options.find((option) => option.candidates.length > 1)?.candidates.at(-1)
      ?? options.find((option) => !isPromotionalMusicHeadline(option.headline))?.candidates.at(-1)
      // Some official pages append “first month free” to the normal recurring
      // price. When that is the only priced card, the amount is still the
      // published recurring price and must not be discarded as a promotion.
      ?? (options.length === 1 ? options[0].candidates.at(-1) : null)
      ?? null;
  });

  // The mainland China page omits the student card but publishes its price in
  // the official pricing FAQ. Use the highest official price below Individual
  // as the student fallback instead of hard-coding a localized amount.
  if (region === "cn" && !matches[2] && matches[0]) {
    const individualAmount = numericAmount(matches[0].amountText, region);
    const fallback = regionalPrices(plainText(html), region)
      .filter((candidate, index, values) => values.findIndex((value) => value.price === candidate.price) === index)
      .map((candidate) => ({ ...candidate, amount: numericAmount(candidate.amountText, region) }))
      .filter((candidate) => Number.isFinite(candidate.amount) && candidate.amount > 0 && candidate.amount < individualAmount)
      .sort((left, right) => right.amount - left.amount)[0];
    if (fallback) matches[2] = fallback;
  }

  return matches
    .map((match, index) => match ? { name: PLANS[index].name, price: match.price } : null)
    .filter(Boolean);
}
