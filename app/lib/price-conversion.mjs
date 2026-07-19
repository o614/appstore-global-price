export function parseLocalizedAmount(text, currency) {
  let numeric = String(text ?? "").replace(/[^\d.,]/gu, "");
  if (!numeric) return null;

  if (currency === "IDR" && /(?:ribu|juta)/iu.test(text)) {
    numeric = numeric.replace(/\./gu, "").replace(",", ".");
    const value = Number(numeric);
    if (!Number.isFinite(value)) return null;
    return value * (/juta/iu.test(text) ? 1_000_000 : 1_000);
  }

  const comma = numeric.lastIndexOf(",");
  const dot = numeric.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    numeric = numeric.replace(decimal === "," ? /\./gu : /,/gu, "").replace(decimal, ".");
  } else if (comma >= 0) {
    numeric = numeric.length - comma - 1 === 2 ? numeric.replace(",", ".") : numeric.replace(/,/gu, "");
  } else if (dot >= 0 && numeric.length - dot - 1 !== 2) {
    numeric = numeric.replace(/\./gu, "");
  }
  const amount = Number(numeric);
  return Number.isFinite(amount) ? amount : null;
}

export function convertToBaseCurrency(text, currency, unitsPerBase) {
  const amount = parseLocalizedAmount(text, currency);
  if (amount === null || !Number.isFinite(unitsPerBase) || unitsPerBase <= 0) return null;
  return amount / unitsPerBase;
}
