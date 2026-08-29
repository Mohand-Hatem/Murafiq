import { EGYPT_GOVERNORATES } from '../constants/locations.constant.js';

/**
 * Calculates spherical distance between two geographic coordinates [lng, lat] in kilometers.
 * Uses the Haversine formula.
 *
 * @param {Array<number>} coord1 - [longitude, latitude]
 * @param {Array<number>} coord2 - [longitude, latitude]
 * @returns {number} Distance in kilometers, rounded to 1 decimal place.
 */
export const haversineDistanceKm = (coord1, coord2) => {
  if (
    !Array.isArray(coord1) ||
    !Array.isArray(coord2) ||
    coord1.length < 2 ||
    coord2.length < 2 ||
    (coord1[0] === 0 && coord1[1] === 0) ||
    (coord2[0] === 0 && coord2[1] === 0)
  ) {
    return null;
  }

  const [lng1, lat1] = coord1;
  const [lng2, lat2] = coord2;

  const R = 6371; // Earth's mean radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
};

/**
 * Strips Arabic diacritics, prefixes ('el-', 'al-'), and normalizes casing.
 */
const cleanLocationString = (str) => {
  if (!str || typeof str !== 'string') return '';
  return str
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // remove Arabic tashkeel
    .replace(/^(el|al)[-\s]/i, '') // remove leading El / Al
    .replace(/[^\w\u0621-\u064A\s]/g, ''); // keep alphanumeric + arabic
};

/**
 * Normalizes input governorate name to canonical EGYPT_GOVERNORATES record.
 * Handles English, Arabic, common transliterations, and ISO codes.
 *
 * @param {string} inputName
 * @returns {object|null} Matched governorate object or null
 */
export const normalizeGovernorate = (inputName) => {
  if (!inputName || typeof inputName !== 'string') return null;

  const clean = cleanLocationString(inputName);

  for (const gov of EGYPT_GOVERNORATES) {
    const cleanEn = cleanLocationString(gov.nameEn);
    const cleanAr = cleanLocationString(gov.nameAr);

    if (
      clean === cleanEn ||
      clean === cleanAr ||
      gov.code.toLowerCase() === inputName.trim().toLowerCase()
    ) {
      return gov;
    }
  }

  // Common aliases and transliteration fallbacks
  const ALIASES = {
    cairo: 'Cairo',
    qahirah: 'Cairo',
    alkahira: 'Cairo',
    giza: 'Giza',
    jiza: 'Giza',
    alex: 'Alexandria',
    alexandria: 'Alexandria',
    iskandariya: 'Alexandria',
    sharm: 'South Sinai',
    gouna: 'Red Sea',
    hurghada: 'Red Sea',
    tagamoa: 'Cairo',
    october: 'Giza',
    zayed: 'Giza',
  };

  const aliasMatch = ALIASES[clean];
  if (aliasMatch) {
    return EGYPT_GOVERNORATES.find((g) => g.nameEn === aliasMatch) || null;
  }

  return null;
};

/**
 * Normalizes city/district name within a governorate.
 *
 * @param {string} governorateName
 * @param {string} cityName
 * @returns {object|null} Matched city record { nameEn, nameAr } or fallback object
 */
export const normalizeCity = (governorateName, cityName) => {
  if (!cityName || typeof cityName !== 'string') return null;

  const gov = normalizeGovernorate(governorateName);
  if (!gov) return { nameEn: cityName.trim(), nameAr: cityName.trim() };

  const cleanCity = cleanLocationString(cityName);

  for (const city of gov.cities) {
    const cleanEn = cleanLocationString(city.nameEn);
    const cleanAr = cleanLocationString(city.nameAr);
    if (cleanCity === cleanEn || cleanCity === cleanAr || cleanCity.includes(cleanEn)) {
      return city;
    }
  }

  return { nameEn: cityName.trim(), nameAr: cityName.trim() };
};

/**
 * Returns default centroid coordinates [lng, lat] for a governorate.
 *
 * @param {string} governorateName
 * @returns {Array<number>} [lng, lat]
 */
export const getGovernorateCentroid = (governorateName) => {
  const gov = normalizeGovernorate(governorateName);
  return gov ? gov.coordinates : [31.2357, 30.0444]; // default Cairo
};

export default {
  haversineDistanceKm,
  normalizeGovernorate,
  normalizeCity,
  getGovernorateCentroid,
};
