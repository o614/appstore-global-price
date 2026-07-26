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

test("ignores introductory offers when Apple also publishes the recurring price", () => {
  const html = [
    planCard("individual", "Get 3 months for $1.99/month, then $11.99/month"),
    planCard("family", "New subscriber offer: $4.99/month"),
    planCard("family", "$19.99/month"),
    planCard("student", "$6.99/month"),
  ].join("");
  assert.deepEqual(extractAppleMusicPlans(html, "us"), [
    { name: "Apple Music Individual", price: "$11.99" },
    { name: "Apple Music Family", price: "$19.99" },
    { name: "Apple Music Student", price: "$6.99" },
  ]);
});

test("handles Apple's unclosed Japanese family-price headline", () => {
  const html = [
    planCard("individual", "新規登録すると、3か月間で180円。その後は月額1,180円。"),
    planCard("family", "3か月間480円"),
    '<li class="gallery-item tile" id="family"><p class="tile-headline">新規登録すると、3か月間で480円。その後は月額1,980円。<ul><li>ファミリー共有</li></ul></li>',
    planCard("student", "さらにお得な月額680円。最初の1か月間無料。"),
  ].join("");
  assert.deepEqual(extractAppleMusicPlans(html, "jp"), [
    { name: "Apple Music Individual", price: "¥1,180" },
    { name: "Apple Music Family", price: "¥1,980" },
    { name: "Apple Music Student", price: "¥680" },
  ]);
});

test("extracts Indian recurring prices without mistaking subscribers punctuation for Rs", () => {
  const html = [
    planCard("individual", "3 months for just ₹19 for new subscribers, then ₹139/month."),
    planCard("family", "3 months for just ₹39 for new subscribers, then ₹229/month."),
    planCard("student", "Extra savings at just ₹69/month, first month free for new subscribers."),
  ].join("");
  assert.deepEqual(extractAppleMusicPlans(html, "in"), [
    { name: "Apple Music Individual", price: "₹139" },
    { name: "Apple Music Family", price: "₹229" },
    { name: "Apple Music Student", price: "₹69" },
  ]);
});

test("does not invent a student plan when a non-China page omits it", () => {
  const html = [
    planCard("individual", "신규 구독자는 1,100원에 3개월 이용 후 월 8,900원의 요금 결제."),
    planCard("family", "신규 구독자는 3,300원에 3개월 이용 후 월 13,500원의 요금 결제."),
  ].join("");
  assert.deepEqual(extractAppleMusicPlans(html, "kr"), [
    { name: "Apple Music Individual", price: "₩8,900" },
    { name: "Apple Music Family", price: "₩13,500" },
  ]);
});

test("keeps recurring prices when the normal card also mentions a free first month", () => {
  const locales = [
    {
      region: "sg",
      prices: ["S$11.98", "S$20.98", "S$6.48"],
      expected: ["S$11.98", "S$20.98", "S$6.48"],
      suffix: "/month, first month free for new subscribers.",
    },
    {
      region: "gb",
      prices: ["£11.99", "£19.99", "£5.99"],
      expected: ["£11.99", "£19.99", "£5.99"],
      suffix: "/month, first month free for new subscribers.",
    },
    {
      region: "fr",
      prices: ["11,99 €", "19,99 €", "6,99 €"],
      expected: ["€11,99", "€19,99", "€6,99"],
      suffix: "/mois, premier mois gratuit pour les nouveaux abonnements.",
    },
    {
      region: "au",
      prices: ["A$14.99", "A$23.99", "A$7.99"],
      expected: ["$14.99", "$23.99", "$7.99"],
      suffix: " per month, first month free for new subscribers.",
    },
  ];

  for (const { region, prices, expected, suffix } of locales) {
    const html = [
      planCard("individual", `${prices[0]}${suffix}`),
      planCard("family", `${prices[1]}${suffix}`),
      planCard("student", `${prices[2]}${suffix}`),
    ].join("");
    assert.deepEqual(
      extractAppleMusicPlans(html, region).map((plan) => plan.price),
      expected,
      region,
    );
  }
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
