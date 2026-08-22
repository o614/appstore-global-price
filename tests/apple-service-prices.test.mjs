import assert from "node:assert/strict";
import test from "node:test";
import { extractAppleServicePlans, getAppleServicePageUrl } from "../scripts/apple-service-prices.mjs";

test("extracts the five regional iCloud+ storage tiers", () => {
  const html = `<main>United States (USD)
    50 GB: $0.99 200 GB: $2.99 2 TB: $9.99 6 TB: $29.99 12 TB: $59.99
    Canada (CAD) 50 GB: $1.29</main>`;
  assert.deepEqual(extractAppleServicePlans(html, "us", "icloud-plus"), [
    { name: "iCloud+ 50 GB", price: "$0.99" },
    { name: "iCloud+ 200 GB", price: "$2.99" },
    { name: "iCloud+ 2 TB", price: "$9.99" },
    { name: "iCloud+ 6 TB", price: "$29.99" },
    { name: "iCloud+ 12 TB", price: "$59.99" },
  ]);
  const ukHtml = `<main>United Kingdom (GBP)
    50 GB: &pound;0.99 200 GB: &pound;2.99 2 TB: &pound;8.99 6 TB: &pound;26.99 12 TB: &pound;54.99</main>`;
  assert.deepEqual(extractAppleServicePlans(ukHtml, "gb", "icloud-plus").map((plan) => plan.price), [
    "£0.99", "£2.99", "£8.99", "£26.99", "£54.99",
  ]);
});

test("extracts Apple One plan cards without confusing their component prices", () => {
  const html = [
    '<p class="typography-plan-subhead plan-individual">$19.95<span>/mo.</span></p>',
    '<p>iCloud+ $0.99/mo. Apple Music $11.99/mo.</p>',
    '<p class="typography-plan-subhead plan-family">$27.95<span>/mo.</span></p>',
    '<p class="typography-plan-subhead plan-premier">$37.95<span>/mo.</span></p>',
  ].join("");
  assert.deepEqual(extractAppleServicePlans(html, "us", "apple-one"), [
    { name: "Apple One Individual", price: "$19.95" },
    { name: "Apple One Family", price: "$27.95" },
    { name: "Apple One Premier", price: "$37.95" },
  ]);
});

test("extracts monthly and annual plans from localized Apple service copy", () => {
  const arcade = "Apple Arcade 每月 NT$220，或可選年費方案，每年 NT$1,690。";
  assert.deepEqual(extractAppleServicePlans(arcade, "tw", "apple-arcade"), [
    { name: "Apple Arcade Monthly", price: "NT$220" },
    { name: "Apple Arcade Annual", price: "NT$1,690" },
  ]);
  const fitness = "Apple Fitness+ new subscribers pay $9.99 per month or $79.99 annually after trial.";
  assert.deepEqual(extractAppleServicePlans(fitness, "us", "apple-fitness-plus"), [
    { name: "Apple Fitness+ Monthly", price: "$9.99" },
    { name: "Apple Fitness+ Annual", price: "$79.99" },
  ]);
});

test("uses official locale-specific service URLs", () => {
  assert.equal(getAppleServicePageUrl("cn", "icloud-plus"), "https://support.apple.com/en-us/108047");
  assert.equal(getAppleServicePageUrl("jp", "apple-one"), "https://www.apple.com/jp/apple-one/");
  assert.equal(getAppleServicePageUrl("us", "apple-tv-plus"), "https://www.apple.com/apple-tv/");
  assert.equal(getAppleServicePageUrl("gb", "apple-one"), "https://www.apple.com/uk/apple-one/");
  assert.equal(getAppleServicePageUrl("ae", "apple-one"), "https://www.apple.com/ae/apple-one/");
  assert.equal(getAppleServicePageUrl("sa", "apple-one"), "https://www.apple.com/sa/apple-one/");
});

test("recognizes localized monthly and annual cadence around expanded-region prices", () => {
  const germanArcade = "Apple Arcade kostet 6,99 € pro Monat oder 69,99 € pro Jahr.";
  assert.deepEqual(extractAppleServicePlans(germanArcade, "de", "apple-arcade"), [
    { name: "Apple Arcade Monthly", price: "€6,99" },
    { name: "Apple Arcade Annual", price: "€69,99" },
  ]);
  const indonesiaFitness = "Apple Fitness+ Rp 69.000 per bulan atau Rp 549.000 per tahun.";
  assert.deepEqual(extractAppleServicePlans(indonesiaFitness, "id", "apple-fitness-plus"), [
    { name: "Apple Fitness+ Monthly", price: "Rp69.000" },
    { name: "Apple Fitness+ Annual", price: "Rp549.000" },
  ]);
  const brazilFitness = "Apple Fitness+ plano mensal de R$ 29,90 ou anual de R$ 149,90.";
  assert.deepEqual(extractAppleServicePlans(brazilFitness, "br", "apple-fitness-plus"), [
    { name: "Apple Fitness+ Monthly", price: "R$29,90" },
    { name: "Apple Fitness+ Annual", price: "R$149,90" },
  ]);
});

test("parses prices for the newly selected regions", () => {
  const mexico = "Apple Fitness+ MX$199 por mes";
  assert.deepEqual(extractAppleServicePlans(mexico, "mx", "apple-fitness-plus"), [
    { name: "Apple Fitness+ Monthly", price: "$199" },
  ]);
  const newZealand = "Apple Fitness+ NZ$16.99 per month";
  assert.deepEqual(extractAppleServicePlans(newZealand, "nz", "apple-fitness-plus"), [
    { name: "Apple Fitness+ Monthly", price: "$16.99" },
  ]);
  const uae = "Apple Fitness+ AED 36.99 per month";
  assert.deepEqual(extractAppleServicePlans(uae, "ae", "apple-fitness-plus"), [
    { name: "Apple Fitness+ Monthly", price: "AED 36.99" },
  ]);
  const saudi = "Apple Fitness+ SAR 36.99 per month";
  assert.deepEqual(extractAppleServicePlans(saudi, "sa", "apple-fitness-plus"), [
    { name: "Apple Fitness+ Monthly", price: "SAR 36.99" },
  ]);
});

test("parses Saudi iCloud+ prices written with the riyal symbol after the amount", () => {
  const html = `
    <h4>Saudi Arabia (SAR)</h4>
    <ul>
      <li><b>50 GB</b>: 3.99﷼</li>
      <li><b>200 GB</b>: 12.99﷼</li>
      <li><b>2 TB</b>: 44.99﷼</li>
      <li><b>6 TB</b>: 129.99﷼</li>
      <li><b>12 TB</b>: 269.99﷼</li>
    </ul>
  `;

  assert.deepEqual(extractAppleServicePlans(html, "sa", "icloud-plus"), [
    { name: "iCloud+ 50 GB", price: "SAR 3.99" },
    { name: "iCloud+ 200 GB", price: "SAR 12.99" },
    { name: "iCloud+ 2 TB", price: "SAR 44.99" },
    { name: "iCloud+ 6 TB", price: "SAR 129.99" },
    { name: "iCloud+ 12 TB", price: "SAR 269.99" },
  ]);
});

test("parses Spanish monthly and annual Fitness+ prices", () => {
  const html = `<p>1 mes gratis y luego $149 al mes u $899 al año.</p>`;

  assert.deepEqual(extractAppleServicePlans(html, "mx", "apple-fitness-plus"), [
    { name: "Apple Fitness+ Monthly", price: "$149" },
    { name: "Apple Fitness+ Annual", price: "$899" },
  ]);
});
