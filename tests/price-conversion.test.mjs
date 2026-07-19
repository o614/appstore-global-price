import assert from "node:assert/strict";
import test from "node:test";
import { convertToBaseCurrency, parseLocalizedAmount } from "../app/lib/price-conversion.mjs";

test("expands Indonesian App Store ribu and juta price suffixes", () => {
  assert.equal(parseLocalizedAmount("Rp 349ribu", "IDR"), 349_000);
  assert.equal(parseLocalizedAmount("Rp 3,499juta", "IDR"), 3_499_000);
  assert.equal(convertToBaseCurrency("Rp 349ribu", "IDR", 2_650), 349_000 / 2_650);
});

test("keeps localized full-unit and decimal prices intact", () => {
  assert.equal(parseLocalizedAmount("4.999.000đ", "VND"), 4_999_000);
  assert.equal(parseLocalizedAmount("€9,99", "EUR"), 9.99);
  assert.equal(parseLocalizedAmount("Rp 69.000", "IDR"), 69_000);
});
