export const CANONICAL_PLANS = [
  // --- CLIENT PLANS ---
  {
    code: 'client.free',
    name: 'Client Free',
    role: 'client',
    tier: 'free',
    priceEgp: 0,
    priceUsdDisplay: 0,
    entitlements: {
      'requests.daily': 1,
      'requests.active': 1,
      'ai.messages.lifetime': 10,
      'ai.productSearch.monthly': 0,
      'ai.tryOn.monthly': 0,
      'ai.tryOn.trial.lifetime': 1,
      'wardrobe.photos.max': 7,
    },
    isActive: true,
  },
  {
    code: 'client.basic',
    name: 'Client Basic',
    role: 'client',
    tier: 'basic',
    priceEgp: 50,
    priceUsdDisplay: 1,
    entitlements: {
      'requests.daily': 2,
      'requests.active': 2,
      'ai.messages.daily': 5,
      'ai.imageMessages.daily': 3,
      'ai.productSearch.monthly': 15,
      'ai.tryOn.monthly': 4,
      'ai.tryOn.trial.lifetime': 0,
      'wardrobe.photos.max': 25,
    },
    isActive: true,
  },
  {
    code: 'client.mid',
    name: 'Client Mid',
    role: 'client',
    tier: 'basic', // mapped to basic group for UI
    priceEgp: 150,
    priceUsdDisplay: 3,
    entitlements: {
      'requests.daily': 3,
      'requests.active': 3,
      'ai.messages.daily': 35,
      'ai.imageMessages.daily': 10,
      'ai.productSearch.monthly': 30,
      'ai.tryOn.monthly': 6,
      'ai.tryOn.trial.lifetime': 0,
      'wardrobe.photos.max': 45,
    },
    isActive: true,
  },
  {
    code: 'client.pro',
    name: 'Client Pro',
    role: 'client',
    tier: 'pro',
    priceEgp: 250,
    priceUsdDisplay: 5,
    entitlements: {
      'requests.daily': 4,
      'requests.active': 4,
      'ai.messages.daily': 80,
      'ai.imageMessages.daily': 25,
      'ai.productSearch.monthly': 45,
      'ai.tryOn.monthly': 8,
      'ai.tryOn.trial.lifetime': 0,
      'wardrobe.photos.max': 100,
    },
    isActive: true,
  },
  {
    code: 'client.enterprise',
    name: 'Client Enterprise',
    role: 'client',
    tier: 'enterprise',
    priceEgp: 500,
    priceUsdDisplay: 10,
    entitlements: {
      'requests.daily': 5, // PO final decision: 5 requests/day
      'requests.active': 5,
      'ai.messages.daily': 150,
      'ai.imageMessages.daily': 60,
      'ai.productSearch.monthly': 60,
      'ai.tryOn.monthly': 10,
      'ai.tryOn.trial.lifetime': 0,
      'wardrobe.photos.max': 200,
    },
    isActive: true,
  },

  // --- STYLIST PLANS ---
  {
    code: 'stylist.free',
    name: 'Stylist Free',
    role: 'stylist',
    tier: 'free',
    priceEgp: 0,
    priceUsdDisplay: 0,
    entitlements: {
      'offers.daily': 3,
      'offers.active': 3,
      'feed.priority': false,
    },
    isActive: true,
  },
  {
    code: 'stylist.basic',
    name: 'Stylist Basic',
    role: 'stylist',
    tier: 'basic',
    priceEgp: 50,
    priceUsdDisplay: 1,
    entitlements: {
      'offers.daily': 6,
      'offers.active': 6,
      'feed.priority': false,
    },
    isActive: true,
  },
  {
    code: 'stylist.pro',
    name: 'Stylist Pro',
    role: 'stylist',
    tier: 'pro',
    priceEgp: 125,
    priceUsdDisplay: 2.5,
    entitlements: {
      'offers.daily': 10,
      'offers.active': 10,
      'feed.priority': true,
    },
    isActive: true,
  },
  {
    code: 'stylist.enterprise',
    name: 'Stylist Enterprise',
    role: 'stylist',
    tier: 'enterprise',
    priceEgp: 250,
    priceUsdDisplay: 5,
    entitlements: {
      'offers.daily': 20,
      'offers.active': 20,
      'feed.priority': true,
    },
    isActive: true,
  },
];

// USD figures in the product spec are display/marketing labels; EGP is the billing
// currency (see the Decisions Log). Single point of change for the conversion.
// TODO(§R item 6): move to an admin-editable config value rather than a constant.
export const USD_TO_EGP_RATE = 49;

// Annual prices, in USD, per the Decisions Log. Deliberately 12 x monthly for the
// stylist ladder -- the PO set Pro at $30 (12 x $2.50) and Enterprise at $60 (12 x $5),
// which also resolved the original `$6` stylist-Basic figure as a typo for $12.
// Free tiers get no yearly entry: a $0 annual price is meaningless and would let a caller
// select `billingCycle: 'yearly'` on a plan that has no such thing.
const YEARLY_USD_PRICES = {
  'client.basic': 12,
  'client.mid': 35,
  'client.pro': 58,
  'client.enterprise': 115,
  'stylist.basic': 12,
  'stylist.pro': 30,
  'stylist.enterprise': 60,
};

// Yearly is a PRICE on the monthly plan, not a plan of its own. The previous shape derived
// a parallel `<code>.yearly` catalogue entry, which meant the billing cycle lived in two
// places -- the plan code AND the request's billingCycle field -- with nothing keeping them
// in agreement. Buying `client.pro` with billingCycle 'yearly' charged the monthly price for
// 365 days; buying `client.pro.yearly` charged the annual price for 30. Folding the annual
// figure onto its parent makes the pair inseparable and both bugs unrepresentable.
// Charged as a single up-front payment: Paymob recurring billing is not integrated, and
// one-shot annual avoids that dependency entirely.
for (const [code, usd] of Object.entries(YEARLY_USD_PRICES)) {
  const base = CANONICAL_PLANS.find((p) => p.code === code);
  if (!base) {
    throw new Error(`Yearly price references unknown plan code '${code}'`);
  }
  base.priceYearlyEgp = usd * USD_TO_EGP_RATE;
  base.priceUsdYearlyDisplay = usd;
}

export const FALLBACK_FREE_ENTITLEMENTS = {
  client: {
    'requests.daily': 1,
    'requests.active': 1,
    'ai.messages.lifetime': 10,
    'ai.productSearch.monthly': 0,
    'ai.tryOn.monthly': 0,
    'ai.tryOn.trial.lifetime': 1,
    'wardrobe.photos.max': 7,
  },
  stylist: {
    'offers.daily': 3,
    'offers.active': 3,
    'feed.priority': false,
  },
};

export default {
  CANONICAL_PLANS,
  FALLBACK_FREE_ENTITLEMENTS,
};
