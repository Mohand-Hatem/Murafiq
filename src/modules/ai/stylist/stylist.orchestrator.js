import entitlementService from '../../subscriptions/entitlement.service.js';
import scopeGuard from './scope.guard.js';
import intentStep from './intent.step.js';
import matchStep from './match.step.js';
import preflightGuard from './preflight.guard.js';
import composeStep from './compose.step.js';
import outfitValidator from './outfit.validator.js';
import renderStep from './render.step.js';
import traceLogger from '../utils/trace.logger.js';
import wardrobeService from '../../wardrobe/wardrobe.service.js';
import stylePreferenceService from '../preferences/style-preference.service.js';
import outfitService from '../outfits/outfit.service.js';
import conversationService from '../conversation/ai-conversation.service.js';
import knowledgeService from '../knowledge/knowledge.service.js';
import productSearchService from '../products/product-search.service.js';
import userService from '../../users/user.service.js';
import {
  resolveDressCode,
  deriveSeason,
  deriveComplementarySlots,
} from '../../../common/constants/dress-code.constant.js';
import { BUSINESS_TIMEZONE } from '../../../common/constants/defaults.constant.js';
import { logger } from '../../../config/logger.config.js';
import cloudinary from '../../../config/cloudinary.config.js';

/**
 * End-to-end AI Stylist Pipeline Orchestrator.
 *
 * Implements cascading cost-minimizing gates:
 * 0.  consume daily quota -> 429 before any model call (two-metric for image requests)
 * 0b. scope guard Layer 1 -> reject empty / length > 500 / 5 refusals/hr abuse
 * 1.  classifyAndExtract  -> one cheap call (fuses scope check, multimodal vision, and intent)
 * 1b. SCOPE GATE: inDomain false -> refund daily quotas, increment abuse counter, exit immediately (0 further calls)
 * 2.  resolveDressCode / anchor match -> Flow A (occasion dress code) vs Flow B (anchor garment + matchStep)
 * 3.  parallel retrieval  -> wardrobe candidates + user style preferences
 * 4.  PRE-FLIGHT GUARD    -> if required slots missing, skip composition call entirely
 * 5.  composeAndRankOutfits -> single composition call (pinned anchor if Flow B)
 * 6.  validateOutfitIds   -> pure candidate ID check (anchor exempt if unmatched), 1 corrective retry, fails closed
 * 7.  sufficiency branch  -> hydrate documents, persist Outfit records
 * 8.  renderStylistResponse -> pure structured output rendering (soft hint / save CTA)
 *
 * @param {Object} params
 * @param {string|Object} params.userId
 * @param {string} params.message
 * @param {string|null} [params.imageRef=null]
 * @param {string|null} [params.conversationId=null]
 * @param {Object} [params.options={}]
 * @returns {Promise<Object>} Rendered user-facing response payload
 */
export const runStylistPipeline = async ({
  userId,
  message,
  imageRef = null,
  conversationId = null,
  options = {},
}) => {
  const traceId = traceLogger.createTraceId();
  const hasImage = Boolean(imageRef);

  // Helper to refund all consumed quotas on validation/scope refusal
  const refundConsumedQuotas = async () => {
    await entitlementService.refundQuota(userId, 'ai.messages.daily', 1);
    if (hasImage) {
      await entitlementService.refundQuota(userId, 'ai.imageMessages.daily', 1);
    }
  };

  // 0. Quota consumption:
  // Always consume 1 unit of 'ai.messages.daily'
  await entitlementService.consume(userId, 'ai.messages.daily', 1, 'client');

  // If image is attached, consume vision quota; refund message quota on failure
  if (hasImage) {
    try {
      await entitlementService.consume(userId, 'ai.imageMessages.daily', 1, 'client');
    } catch (err) {
      await entitlementService.refundQuota(userId, 'ai.messages.daily', 1);
      throw err;
    }
  }

  // 0b. Scope Guard Layer 1: message validation & refusal abuse rate limiting
  const l1Check = scopeGuard.validateLayer1(message);
  if (!l1Check.valid) {
    await refundConsumedQuotas();
    throw new ApiError(400, scopeGuard.getRefusalMessage(l1Check.refusalCategory, 'en'));
  }

  const rateLimitCheck = await scopeGuard.checkRefusalRateLimit(userId);
  if (!rateLimitCheck.allowed) {
    await refundConsumedQuotas();
    const refusalMsg = scopeGuard.getRefusalMessage(rateLimitCheck.refusalCategory, 'en');

    traceLogger.logTraceStep({
      traceId,
      step: 'layer1_rate_limited',
      userId,
      inDomain: false,
      refusalCategory: rateLimitCheck.refusalCategory,
    });

    return {
      refused: true,
      refusalCategory: rateLimitCheck.refusalCategory,
      message: refusalMsg,
      traceId,
    };
  }

  // Optional image data loading for multimodal inlineData
  let imageData = options.imageData || null;
  if (!imageData && imageRef) {
    try {
      const secureUrl = cloudinary.url(imageRef, { secure: true });
      const res = await fetch(secureUrl);
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
        imageData = {
          mimeType,
          data: Buffer.from(arrayBuffer).toString('base64'),
        };
      }
    } catch (fetchErr) {
      logger.warn('Failed to fetch image from Cloudinary for inlineData:', fetchErr.message);
    }
  }

  // 1. Intent Classification & User Profile Retrieval in parallel (multimodal when image is attached)
  const [intent, userProfile] = await Promise.all([
    intentStep.classifyAndExtract(message, {
      ...options,
      imageData,
      imageRef,
    }),
    userService.getProfile(userId).catch(() => null),
  ]);

  traceLogger.logTraceStep({
    traceId,
    step: 'intent_classification',
    userId,
    inDomain: intent.inDomain,
    refusalCategory: intent.refusalCategory,
    eventType: intent.eventType,
    inputTokens: intent.usage?.inputTokens,
    outputTokens: intent.usage?.outputTokens,
    latencyMs: intent.latencyMs,
  });

  // 1b. Scope Gate Verdict: If out-of-domain (or non-garment image), refund quotas and terminate
  if (!intent.inDomain) {
    await scopeGuard.recordScopeRefusal(userId);
    await refundConsumedQuotas();

    const refusalMsg = scopeGuard.getRefusalMessage(intent.refusalCategory, intent.language);

    traceLogger.logTraceStep({
      traceId,
      step: 'scope_refusal',
      userId,
      inDomain: false,
      refusalCategory: intent.refusalCategory,
    });

    return {
      refused: true,
      refusalCategory: intent.refusalCategory,
      message: refusalMsg,
      language: intent.language,
      traceId,
    };
  }

  // 2. Garment Match & Anchor Threading (Flow B) vs. Dress Code Resolution (Flow A)
  let matchResult = null;
  let anchor = null;

  if (hasImage && intent.garmentAnalysis) {
    matchResult = await matchStep.matchWardrobeItem(userId, intent.garmentAnalysis, options);
    const anchorId = matchResult.matched ? String(matchResult.itemId) : 'anchor_item';

    anchor = {
      id: anchorId,
      itemId: matchResult.matched ? String(matchResult.itemId) : null,
      matched: matchResult.matched,
      category: intent.garmentAnalysis.category,
      subcategory: intent.garmentAnalysis.subcategory,
      colors: intent.garmentAnalysis.colors,
      colorFamily: intent.garmentAnalysis.colorFamily,
      formality: intent.garmentAnalysis.formality,
      material: intent.garmentAnalysis.material,
      pattern: intent.garmentAnalysis.pattern,
      styleTags: intent.garmentAnalysis.styleTags,
      imageUrl: imageRef ? cloudinary.url(imageRef, { secure: true }) : null,
    };
  }

  // Resolve unified gender presentation:
  // Explicit message intent takes priority; fallback to registered account gender, then 'unisex'
  const userGender = userProfile?.gender;
  const userGenderPresentation =
    userGender === 'male'
      ? 'masculine'
      : userGender === 'female'
      ? 'feminine'
      : null;

  const resolvedGenderPresentation =
    intent.genderPresentation || userGenderPresentation || 'unisex';

  const resolvedDressCode = resolveDressCode(intent.eventType);
  const season = intent.season || (intent.context && intent.context.season) || deriveSeason(new Date(), BUSINESS_TIMEZONE);

  const eventContext = {
    eventType: intent.eventType,
    season,
    timeOfDay: intent.timeOfDay,
    setting: intent.setting,
    genderPresentation: resolvedGenderPresentation,
  };

  // 3. Parallel Retrieval: Candidate garments & client style preferences
  let candidateSlots;
  let requiredSlots;

  if (anchor) {
    // Flow B: Slots complementary to the anchor garment category
    candidateSlots = deriveComplementarySlots(anchor.category);
    const coreSlots = ['top', 'bottom', 'shoes'];
    requiredSlots = anchor.category === 'dress'
      ? ['shoes']
      : coreSlots.filter((s) => s !== anchor.category);
  } else {
    // Flow A: Occasion dress code slots
    candidateSlots = resolvedDressCode.resolved
      ? [...resolvedDressCode.requiredSlots, ...resolvedDressCode.optionalSlots]
      : ['top', 'bottom', 'shoes', 'outerwear', 'accessory'];
    requiredSlots = resolvedDressCode.resolved
      ? resolvedDressCode.requiredSlots
      : ['top', 'bottom', 'shoes'];
  }

  const [candidatesBySlot, preferences] = await Promise.all([
    wardrobeService.getWardrobeCandidates(userId, {
      slots: candidateSlots,
      formality: resolvedDressCode.resolved ? resolvedDressCode.formality : intent.formality,
      season,
      genderPresentation: resolvedGenderPresentation,
    }),
    stylePreferenceService.getPreferences(userId),
  ]);

  // 4. Pre-Flight Wardrobe Capacity Guard
  const capacity = preflightGuard.evaluateWardrobeCapacity(candidatesBySlot, requiredSlots);

  // Manage Conversation and AiMessage recording
  let activeConversationId = conversationId;
  let userMessageRecord = null;

  if (!activeConversationId) {
    try {
      const convTitle = hasImage
        ? 'Image Styling'
        : (intent.occasion || intent.eventType || 'Stylist Consultation');
      const newConv = await conversationService.createConversation(userId, convTitle);
      activeConversationId = newConv._id ? newConv._id.toString() : String(newConv.id);
    } catch (convErr) {
      logger.warn('Failed to auto-create conversation for stylist session:', convErr.message);
    }
  }

  if (activeConversationId) {
    try {
      const expiresAt = hasImage ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null;
      userMessageRecord = await conversationService.addMessage(activeConversationId, userId, {
        role: 'user',
        content: message,
        traceId,
        imageRef,
        imageUrl: imageRef ? cloudinary.url(imageRef, { secure: true }) : null,
        imageAnalysis: intent.garmentAnalysis || null,
        imageExpiresAt: expiresAt,
        matchedWardrobeItemId: matchResult?.matched ? matchResult.itemId : null,
      });
    } catch (msgErr) {
      logger.warn('Failed to record user AiMessage:', msgErr.message);
    }
  }

  const messageId = userMessageRecord?._id ? userMessageRecord._id.toString() : null;

  if (!capacity.canCompose) {
    let externalSuggestions = [];
    const quotaCheck = await entitlementService.checkQuota(userId, 'ai.productSearch.daily', 1, 'client');

    if (quotaCheck.allowed) {
      try {
        await entitlementService.consume(userId, 'ai.productSearch.daily', 1, 'client');
        const primaryFormality = resolvedDressCode.formality?.[0] || 'formal';

        let gapQuery;
        let gapItems;
        if (intent.isShoppingRequest) {
          gapQuery = intent.retrievalQueryEn || intent.occasion || resolvedDressCode.eventType || 'outfit';
          gapItems = [{ slot: 'top' }, { slot: 'bottom' }, { slot: 'shoes' }];
        } else {
          const gapDescriptions = capacity.missingSlots.map((s) =>
            renderStep.getLocalizedGapDescription(s, primaryFormality, intent.language)
          );
          gapQuery = gapDescriptions.join(', ') || intent.occasion || 'formal attire';
          gapItems = capacity.missingSlots.map((s, idx) => ({ slot: s, description: gapDescriptions[idx] }));
        }

        externalSuggestions = await productSearchService.searchExternalProducts({
          gapDescription: gapQuery,
          gapItems,
          occasion: intent.occasion || resolvedDressCode.eventType || 'formal',
          formality: primaryFormality,
          season: eventContext.season || 'all',
          genderPresentation: resolvedGenderPresentation,
          locale: intent.language,
          budget: intent.budget || undefined,
          isShoppingRequest: Boolean(intent.isShoppingRequest),
        });

        traceLogger.logTraceStep({
          traceId,
          step: 'external_product_search',
          userId,
          groundedQueriesCount: 1,
          suggestionsCount: externalSuggestions.length,
        });

        if (externalSuggestions.length > 0) {
          try {
            await outfitService.recordOutfit({
              userId,
              conversationId: activeConversationId,
              items: [],
              externalSuggestions: externalSuggestions.map((s) => ({
                type: s.itemType || s.slot,
                description: s.description || s.title,
                sourceUrl: s.sourceUrl || null,
                sourceTitle: s.sourceTitle || s.retailer || null,
                imageUrl: s.imageUrl || null,
              })),
              rationale: intent.language === 'ar'
                ? 'قطع مقترحة للاقتناء لتكملة إطلالتك لهذه المناسبة.'
                : 'External garment recommendations to close wardrobe gaps for this occasion.',
              score: null,
              eventContext,
              source: 'external',
            });
          } catch (extErr) {
            logger.warn('Failed to record external outfit in preflight:', extErr.message);
          }
        }
      } catch (searchErr) {
        logger.warn('[Orchestrator] Preflight product search execution failed:', searchErr.message);
      }
    } else {
      traceLogger.logTraceStep({
        traceId,
        step: 'product_search_quota_blocked',
        userId,
        groundedQueriesCount: 0,
        reason: quotaCheck.reason,
      });
    }

    traceLogger.logTraceStep({
      traceId,
      step: 'preflight_insufficient',
      userId,
      sufficiency: 'none',
      eventType: intent.eventType,
      groundedQueriesCount: externalSuggestions.length > 0 ? 1 : 0,
    });

    const rendered = renderStep.renderStylistResponse({
      outfits: [],
      sufficiency: 'none',
      missingSlots: capacity.missingSlots,
      gapDescriptions: capacity.missingSlots.map((s) =>
        renderStep.getLocalizedGapDescription(s, resolvedDressCode.formality?.[0] || 'formal', intent.language)
      ),
      externalSuggestions,
      hydratedItemsMap: new Map(),
      language: intent.language,
      resolvedDressCode,
      anchor,
      matchResult,
      messageId,
      isShoppingRequest: intent.isShoppingRequest,
    });

    if (activeConversationId) {
      try {
        await conversationService.addMessage(activeConversationId, userId, {
          role: 'assistant',
          content: rendered.stylistBookingCta || 'Wardrobe insufficient for this occasion.',
          structuredResult: rendered,
          traceId,
        });
      } catch (msgErr) {
        logger.warn('Failed to record assistant AiMessage in preflight:', msgErr.message);
      }
    }

    return {
      ...rendered,
      conversationId: activeConversationId,
      traceId,
    };
  }

  // 4b. Fashion Knowledge RAG: Retrieve Curated Editorial Knowledge (Grounding Context)
  let fashionKnowledgeChunks = [];
  try {
    const kbQuery = intent.retrievalQueryEn || intent.occasion || message;
    fashionKnowledgeChunks = await knowledgeService.searchFashionKnowledge(kbQuery, {
      eventType: resolvedDressCode.eventType || intent.occasion || 'general',
      season: eventContext.season || 'all',
      topK: 3,
    });
    traceLogger.logTraceStep({
      traceId,
      step: 'fashion_knowledge_rag',
      userId,
      chunksCount: fashionKnowledgeChunks.length,
      cacheHit: fashionKnowledgeChunks[0]?.cacheHit || false,
    });
  } catch (kbErr) {
    logger.warn('[Orchestrator] Fashion knowledge RAG retrieval failed (continuing fail-open):', kbErr.message);
  }

  // 5. Compose & Rank Outfits (anchor is threaded and pinned if Flow B, grounded by editorial knowledge)
  let compResult = await composeStep.composeAndRankOutfits({
    candidatesBySlot,
    resolvedDressCode,
    preferences,
    eventContext,
    anchor,
    fashionKnowledgeChunks,
    language: intent.language,
    options,
  });

  traceLogger.logTraceStep({
    traceId,
    step: 'composition',
    userId,
    sufficiency: compResult.sufficiency,
    inputTokens: compResult.usage?.inputTokens,
    outputTokens: compResult.usage?.outputTokens,
    latencyMs: compResult.latencyMs,
  });

  // 6. Anti-Hallucination Gate & 1-shot corrective retry (anchor exempt if unmatched)
  let validation = outfitValidator.validateOutfitItemIds(compResult.outfits, candidatesBySlot, anchor);

  if (!validation.valid) {
    traceLogger.logTraceStep({
      traceId,
      step: 'hallucination_detected_retrying',
      userId,
    });

    const correctivePrompt = outfitValidator.buildCorrectivePrompt(
      validation.invalidIds,
      candidatesBySlot
    );

    compResult = await composeStep.composeAndRankOutfits({
      candidatesBySlot,
      resolvedDressCode,
      preferences,
      eventContext,
      anchor,
      fashionKnowledgeChunks,
      language: intent.language,
      options: {
        ...options,
        correctiveInstruction: correctivePrompt,
      },
    });

    validation = outfitValidator.validateOutfitItemIds(compResult.outfits, candidatesBySlot, anchor);

    if (!validation.valid) {
      traceLogger.logTraceStep({
        traceId,
        step: 'hallucination_fail_closed',
        userId,
      });
      throw new ApiError(500, 'AI outfit generation failed candidate integrity verification');
    }
  }

  // 7. Hydrate Authentic Garment Documents & Persist Outfits
  const allItemIds = new Set();
  for (const outfit of compResult.outfits) {
    for (const itemId of outfit.itemIds) {
      if (itemId !== 'anchor_item') {
        allItemIds.add(String(itemId));
      }
    }
  }

  const hydratedItems = await wardrobeService.getWardrobeItemsByIds(
    userId,
    Array.from(allItemIds)
  );
  const hydratedMap = new Map(hydratedItems.map((item) => [item._id.toString(), item]));

  const persistedOutfits = [];
  if (!intent.isShoppingRequest && (compResult.sufficiency === 'good' || compResult.sufficiency === 'partial')) {
    for (const outfit of compResult.outfits) {
      try {
        const validItemIds = outfit.itemIds.filter((id) => {
          if (id === 'anchor_item') return false;
          if (anchor && !anchor.matched && id === anchor.id) return false;
          return true;
        });
        if (validItemIds.length > 0) {
          const recorded = await outfitService.recordOutfit({
            userId,
            conversationId: activeConversationId,
            items: validItemIds,
            rationale: outfit.rationale,
            score: outfit.score,
            eventContext,
            source: 'wardrobe',
          });
          persistedOutfits.push(recorded);
        }
      } catch (dbErr) {
        logger.error('Failed to persist outfit record:', dbErr);
      }
    }
  }

  // 7b. External Product Search Gate (Gap Closing & Explicit Shopping Requests)
  let externalSuggestions = [];
  const shouldSearchExternal =
    compResult.sufficiency === 'partial' ||
    compResult.sufficiency === 'none' ||
    Boolean(intent.isShoppingRequest);

  if (shouldSearchExternal) {
    const quotaCheck = await entitlementService.checkQuota(userId, 'ai.productSearch.daily', 1, 'client');
    if (quotaCheck.allowed) {
      try {
        await entitlementService.consume(userId, 'ai.productSearch.daily', 1, 'client');
        const primaryFormality = resolvedDressCode.formality?.[0] || 'formal';
        const fallbackGaps = (compResult.missingSlots || []).map((s) =>
          renderStep.getLocalizedGapDescription(s, primaryFormality, intent.language)
        );

        // For explicit shopping requests with a sufficient wardrobe, the user wants
        // complete outfits from the internet — not gap-closing pieces. Construct the
        // query and gap items for full outfit search.
        let gapQuery;
        let gapItems;
        if (intent.isShoppingRequest && compResult.sufficiency === 'good') {
          gapQuery = intent.retrievalQueryEn || intent.occasion || resolvedDressCode.eventType || 'outfit';
          gapItems = [{ slot: 'top' }, { slot: 'bottom' }, { slot: 'shoes' }];
        } else {
          gapQuery =
            compResult.gapDescriptions?.length > 0
              ? compResult.gapDescriptions.join(', ')
              : fallbackGaps.join(', ') || intent.retrievalQueryEn || intent.occasion || `${primaryFormality} attire`;
          gapItems = (compResult.missingSlots || []).map((s, idx) => ({
            slot: s,
            description: compResult.gapDescriptions?.[idx] || fallbackGaps[idx] || `${primaryFormality} ${s}`,
          }));
        }

        externalSuggestions = await productSearchService.searchExternalProducts({
          gapDescription: gapQuery,
          gapItems,
          occasion: intent.occasion || resolvedDressCode.eventType || 'formal',
          formality: primaryFormality,
          season: eventContext.season || 'all',
          genderPresentation: resolvedGenderPresentation,
          locale: intent.language,
          budget: intent.budget || undefined,
          isShoppingRequest: Boolean(intent.isShoppingRequest),
        });

        traceLogger.logTraceStep({
          traceId,
          step: 'external_product_search',
          userId,
          groundedQueriesCount: 1,
          suggestionsCount: externalSuggestions.length,
        });

        if (externalSuggestions.length > 0) {
          try {
            await outfitService.recordOutfit({
              userId,
              conversationId: activeConversationId,
              items: [],
              externalSuggestions: externalSuggestions.map((s) => ({
                type: s.itemType || s.slot,
                description: s.description || s.title,
                sourceUrl: s.sourceUrl || null,
                sourceTitle: s.sourceTitle || s.retailer || null,
                imageUrl: s.imageUrl || null,
              })),
              rationale: intent.language === 'ar'
                ? 'قطع مقترحة للاقتناء لتكملة إطلالتك لهذه المناسبة.'
                : 'External garment recommendations to close wardrobe gaps for this occasion.',
              score: null,
              eventContext,
              source: 'external',
            });
          } catch (extErr) {
            logger.warn('Failed to record external outfit:', extErr.message);
          }
        }
      } catch (searchErr) {
        logger.warn('[Orchestrator] Grounded product search failed (continuing fail-open):', searchErr.message);
      }
    } else {
      traceLogger.logTraceStep({
        traceId,
        step: 'product_search_quota_blocked',
        userId,
        groundedQueriesCount: 0,
        reason: quotaCheck.reason,
      });
    }
  }

  // 8. Render Structured Stylist Response
  const rendered = renderStep.renderStylistResponse({
    outfits: compResult.outfits,
    sufficiency: compResult.sufficiency,
    missingSlots: compResult.missingSlots,
    gapDescriptions: compResult.gapDescriptions || [],
    externalSuggestions,
    hydratedItemsMap: hydratedMap,
    language: intent.language,
    resolvedDressCode,
    persistedOutfits,
    anchor,
    matchResult,
    messageId,
    isShoppingRequest: intent.isShoppingRequest,
  });

  if (activeConversationId) {
    try {
      const assistantRationale = intent.isShoppingRequest
        ? (intent.language === 'ar'
            ? 'إليك قطع وتنسيقات مقترحة للاقتناء من المتاجر الإلكترونية.'
            : 'Here are clothing pieces suggested from online retailers for you.')
        : (compResult.outfits[0]?.rationale || 'Stylist recommendations generated');

      await conversationService.addMessage(activeConversationId, userId, {
        role: 'assistant',
        content: assistantRationale,
        structuredResult: rendered,
        traceId,
      });
    } catch (msgErr) {
      logger.warn('Failed to record assistant AiMessage:', msgErr.message);
    }
  }

  return {
    ...rendered,
    conversationId: activeConversationId,
    traceId,
  };
};

export default {
  runStylistPipeline,
};
