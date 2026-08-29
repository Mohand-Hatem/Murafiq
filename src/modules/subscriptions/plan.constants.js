export const CANONICAL_PLANS = [
  // --- CLIENT PLANS ---
  {
    code: 'client.free',
    name: 'Client Free',
    role: 'client',
    tier: 'free',
    billingCycle: 'monthly',
    priceEgp: 0,
    priceUsdDisplay: 0,
    entitlements: {
      'requests.daily': 1,
      'requests.active': 1,
      'ai.messages.daily': 3,
      'wardrobe.photos.max': 7,
    },
    isActive: true,
  },
  {
    code: 'client.basic',
    name: 'Client Basic',
    role: 'client',
    tier: 'basic',
    billingCycle: 'monthly',
    priceEgp: 50,
    priceUsdDisplay: 1,
    entitlements: {
      'requests.daily': 2,
      'requests.active': 2,
      'ai.messages.daily': 10,
      'wardrobe.photos.max': 25,
    },
    isActive: true,
  },
  {
    code: 'client.mid',
    name: 'Client Mid',
    role: 'client',
    tier: 'basic', // mapped to basic group for UI
    billingCycle: 'monthly',
    priceEgp: 150,
    priceUsdDisplay: 3,
    entitlements: {
      'requests.daily': 3,
      'requests.active': 3,
      'ai.messages.daily': 35,
      'wardrobe.photos.max': 45,
    },
    isActive: true,
  },
  {
    code: 'client.pro',
    name: 'Client Pro',
    role: 'client',
    tier: 'pro',
    billingCycle: 'monthly',
    priceEgp: 250,
    priceUsdDisplay: 5,
    entitlements: {
      'requests.daily': 4,
      'requests.active': 4,
      'ai.messages.daily': 80,
      'wardrobe.photos.max': 100,
    },
    isActive: true,
  },
  {
    code: 'client.enterprise',
    name: 'Client Enterprise',
    role: 'client',
    tier: 'enterprise',
    billingCycle: 'monthly',
    priceEgp: 500,
    priceUsdDisplay: 10,
    entitlements: {
      'requests.daily': 5, // PO final decision: 5 requests/day
      'requests.active': 5,
      'ai.messages.daily': 150,
      'wardrobe.photos.max': 250,
    },
    isActive: true,
  },

  // --- STYLIST PLANS ---
  {
    code: 'stylist.free',
    name: 'Stylist Free',
    role: 'stylist',
    tier: 'free',
    billingCycle: 'monthly',
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
    billingCycle: 'monthly',
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
    billingCycle: 'monthly',
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
    billingCycle: 'monthly',
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
export const USD_TO_EGP_RATE = 50;

// Annual prices, in USD, per the Decisions Log. Deliberately 12 x monthly for the
// stylist ladder — the PO set Pro at $30 (12 x $2.50) and Enterprise at $60 (12 x $5),
// which also resolved the original `$6` stylist-Basic figure as a typo for $12.
// Free tiers get no yearly variant: a second $0 plan would only create ambiguity about
// which subscription to auto-provision at registration.
const YEARLY_USD_PRICES = {
  'client.basic': 12,
  'client.mid': 35,
  'client.pro': 58,
  'client.enterprise': 115,
  'stylist.basic': 12,
  'stylist.pro': 30,
  'stylist.enterprise': 60,
};

// Yearly plans are derived from their monthly counterpart so entitlements can never
// drift between the two billing cycles — a yearly subscriber must get exactly the same
// capabilities as a monthly one, and duplicating the objects by hand guarantees they
// eventually diverge. Charged as a single up-front payment: Paymob recurring billing is
// not integrated, and one-shot annual avoids that dependency entirely.
const YEARLY_PLANS = Object.entries(YEARLY_USD_PRICES).map(([monthlyCode, usd]) => {
  const base = CANONICAL_PLANS.find((p) => p.code === monthlyCode);
  if (!base) {
    throw new Error(`Yearly plan references unknown monthly plan code '${monthlyCode}'`);
  }
  return {
    ...base,
    code: `${monthlyCode}.yearly`,
    name: `${base.name} (Yearly)`,
    billingCycle: 'yearly',
    priceEgp: usd * USD_TO_EGP_RATE,
    priceUsdDisplay: usd,
    entitlements: { ...base.entitlements },
  };
});

CANONICAL_PLANS.push(...YEARLY_PLANS);

export const FALLBACK_FREE_ENTITLEMENTS = {
  client: {
    'requests.daily': 1,
    'requests.active': 1,
    'ai.messages.daily': 3,
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
