import { GoogleGenAI } from '@google/genai';
import env from './env.config.js';
import { logger } from './logger.config.js';

let aiClient = null;

export const getGeminiClient = () => {
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }
  return aiClient;
};

/**
 * Classify a clothing item image using Gemini Flash Vision
 * @param {string} imageUrl
 * @returns {Promise<Object>} Structured classification attributes + aiDescription
 */
export const classifyClothingImage = async (imageUrl) => {
  // If in test environment or mock fallback
  if (env.NODE_ENV === 'test' || env.GEMINI_API_KEY === 'dev_gemini_api_key_placeholder') {
    return {
      category: 'top',
      primaryColor: 'White',
      secondaryColors: ['Blue'],
      pattern: 'solid',
      formality: 'casual',
      season: ['spring', 'summer'],
      material: 'cotton',
      styleTags: ['minimalist', 'casual'],
      aiDescription: 'Classic white cotton short-sleeve crewneck t-shirt with minimal blue accents.',
    };
  }

  try {
    const ai = getGeminiClient();
    const prompt = `You are an expert fashion stylist and clothing classifier.
Analyze this garment image and return ONLY a valid JSON object matching this schema:
{
  "category": "top" | "bottom" | "shoes" | "outerwear" | "accessory" | "dress",
  "primaryColor": "string",
  "secondaryColors": ["string"],
  "pattern": "solid" | "striped" | "plaid" | "floral" | "graphic" | "checkered" | "other",
  "formality": "casual" | "smart_casual" | "business" | "formal" | "loungewear" | "sportswear",
  "season": ["spring", "summer", "fall", "winter", "all_season"],
  "material": "cotton" | "denim" | "leather" | "wool" | "silk" | "linen" | "synthetic" | "other",
  "styleTags": ["string"],
  "aiDescription": "A concise, descriptive summary of the item for styling and visual search (e.g. 'Classic white crewneck cotton t-shirt with subtle navy pocket trim')."
}
Ensure the JSON is strictly formatted with no surrounding markdown backticks or commentary.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: Buffer.from(await (await fetch(imageUrl)).arrayBuffer()).toString('base64'),
              },
            },
          ],
        },
      ],
    });

    const responseText = response.text ? response.text.trim() : '';
    const cleanedJson = responseText.replace(/^[\s\S]*?({[\s\S]*})[\s\S]*$/, '$1');
    const parsed = JSON.parse(cleanedJson);
    return parsed;
  } catch (error) {
    logger.error('Gemini vision classification error:', error);
    throw error;
  }
};

export default {
  getGeminiClient,
  classifyClothingImage,
};
