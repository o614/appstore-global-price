import assert from "node:assert/strict";
import test from "node:test";
import { extractAppleMusicPlans, getAppleMusicPageUrl } from "../scripts/apple-music-prices.mjs";

function planCard(id, headline) {
  return `<li class="gallery-item tile" id="${id}"><p class="tile-headline">${headline}</p></li>`;
}

test("extracts Apple Music plan prices from official plan cards", () => {
  const html = [
    planCard("individual", "$11.99/month"),
    planCard("family", "$19.99/month"),
    planCard("student", "Extra savings at $6.99/month"),
  ].join("");
  assert.deepEqual(extractAppleMusicPlans(html, "us"), [
    { name: "Apple Music Individual", price: "$11.99" },
    { name: "Apple Music Family", price: "$19.99" },
    { name: "Apple Music Student", price: "$6.99" },
  ]);
});

test("uses the official FAQ as the student-price fallback", () => {
  const html = [
    planCard("individual", "RMB&nbsp;12/月"),
    planCard("family", "RMB&nbsp;20/月"),
    "<p>学生方案每月仅需 RMB&nbsp;7。</p>",
  ].join("");
  assert.deepEqual(extractAppleMusicPlans(html, "cn"), [
    { name: "Apple Music Individual", price: "RMB 12" },
    { name: "Apple Music Family", price: "RMB 20" },
    { name: "Apple Music Student", price: "RMB 7" },
  ]);
});

test("uses Apple's locale-specific official pages", () => {
  assert.equal(getAppleMusicPageUrl("cn"), "https://www.apple.com.cn/apple-music/");
  assert.equal(getAppleMusicPageUrl("us"), "https://www.apple.com/apple-music/");
  assert.equal(getAppleMusicPageUrl("jp"), "https://www.apple.com/jp/apple-music/");
  assert.equal(getAppleMusicPageUrl("gb"), "https://www.apple.com/uk/apple-music/");
  assert.equal(getAppleMusicPageUrl("br"), "https://www.apple.com/br/apple-music/");
});

test("extracts localized prices used by the expanded region set", () => {
  const brazil = [
    planCard("individual", "R$ 21,90/mês"),
    planCard("family", "R$ 34,90/mês"),
    planCard("student", "R$ 11,90/mês"),
  ].join("");
  assert.deepEqual(extractAppleMusicPlans(brazil, "br"), [
    { name: "Apple Music Individual", price: "R$21,90" },
    { name: "Apple Music Family", price: "R$34,90" },
    { name: "Apple Music Student", price: "R$11,90" },
  ]);

  const indonesia = [
    planCard("individual", "Rp 55.000/bulan"),
    planCard("family", "Rp 85.000/bulan"),
    planCard("student", "Rp 35.000/bulan"),
  ].join("");
  assert.deepEqual(extractAppleMusicPlans(indonesia, "id")[0], {
    name: "Apple Music Individual",
    price: "Rp55.000",
  });
});
