/**
 * @swagger
 * tags:
 *   name: AI Stylist
 *   description: AI-powered occasion styling, wardrobe retrieval, and outfit composition
 */

/**
 * @swagger
 * /ai/stylist:
 *   post:
 *     summary: Request AI styling and outfit recommendations for an event or occasion
 *     description: Evaluates the user's styling request, classifies intent, enforces scope boundaries, retrieves matching wardrobe items, and composes ranked outfits. Refusals refund the user's daily message quota.
 *     tags: [AI Stylist]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 500
 *                 example: I have a formal wedding tomorrow evening, what should I wear?
 *                 description: User styling request in Arabic or English (max 500 chars)
 *               conversationId:
 *                 type: string
 *                 example: 507f1f77bcf86cd799439011
 *                 description: Optional conversation identifier for message history tracking
 *               imageRef:
 *                 type: string
 *                 example: murafiq/ai-chat/507f1f77bcf86cd799439011/my-image-uuid
 *                 description: Optional Cloudinary public ID for direct garment image styling (Flow B)
 *     responses:
 *       200:
 *         description: Outfits generated or request politely refused if out-of-domain
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Stylist outfits generated successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     outfits:
 *                       type: array
 *                       description: Outfits composed strictly from client-owned wardrobe pieces (strictly isolated from external recommendations)
 *                       items:
 *                         type: object
 *                         properties:
 *                           outfitId:
 *                             type: string
 *                             nullable: true
 *                           score:
 *                             type: number
 *                             example: 95
 *                           rationale:
 *                             type: string
 *                             example: Classic formal navy suit paired with crisp white shirt.
 *                           fromYourWardrobe:
 *                             type: array
 *                             description: Client-owned wardrobe garments composing this outfit
 *                             items:
 *                               type: object
 *                               properties:
 *                                 itemId:
 *                                   type: string
 *                                 name:
 *                                   type: string
 *                                 category:
 *                                   type: string
 *                                 imageUrl:
 *                                   type: string
 *                     sufficiency:
 *                       type: string
 *                       enum: [good, partial, none]
 *                     missingSlots:
 *                       type: array
 *                       items:
 *                         type: string
 *                     gapDescriptions:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: Concrete garment gap descriptions (e.g. navy formal trousers)
 *                     suggestedToAcquire:
 *                       type: array
 *                       description: External purchasable garment recommendations to close wardrobe gaps with citations
 *                       items:
 *                         type: object
 *                         properties:
 *                           slot:
 *                             type: string
 *                             example: shoes
 *                           itemType:
 *                             type: string
 *                             example: black oxford shoes
 *                           title:
 *                             type: string
 *                             example: Zara Egypt Polished Oxfords
 *                           description:
 *                             type: string
 *                             example: Black leather formal dress shoes.
 *                           estimatedPriceEgp:
 *                             type: number
 *                             nullable: true
 *                             example: 2100
 *                           retailer:
 *                             type: string
 *                             nullable: true
 *                             example: Zara Egypt
 *                           sourceUrl:
 *                             type: string
 *                             nullable: true
 *                             example: https://zara.com/eg/en/wool-trousers-p1.html
 *                             description: Verified direct product purchase page URL, or null if unverified
 *                           sourceTitle:
 *                             type: string
 *                             nullable: true
 *                             example: Zara Egypt Wool Trousers
 *                           imageUrl:
 *                             type: string
 *                             nullable: true
 *                             example: https://static.zara.net/photos/sample-trousers.jpg
 *                             description: Verified direct product image URL, or null if unverified
 *                           citations:
 *                             type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 title:
 *                                   type: string
 *                                 url:
 *                                   type: string
 *                           isGrounded:
 *                             type: boolean
 *                             example: true
 *                           outfitIndex:
 *                             type: integer
 *                             nullable: true
 *                             example: 1
 *                             description: Coordinated outfit grouping index (1 or 2) when returning complete looks
 *                           outfitTitle:
 *                             type: string
 *                             nullable: true
 *                             example: "الإطلالة الأولى (كاجوال يومي)"
 *                             description: Localized style direction or title for this coordinated outfit
 *                     suggestBookStylist:
 *                       type: boolean
 *                     stylistBookingCta:
 *                       type: string
 *                       nullable: true
 *                     anchor:
 *                       type: object
 *                       nullable: true
 *                       description: Anchor garment details when an image was uploaded
 *                     matchHint:
 *                       type: string
 *                       nullable: true
 *                       description: Soft suggestion question if the uploaded image matches an owned item
 *                     canSaveToWardrobe:
 *                       type: boolean
 *                       description: True when the uploaded image is not in the client wardrobe and can be saved
 *                     saveToWardrobeCta:
 *                       type: string
 *                       nullable: true
 *                       description: Localized call-to-action text prompting to save piece to wardrobe
 *                     saveMessageId:
 *                       type: string
 *                       nullable: true
 *                       description: ID of the chat message containing the image for saving
 *                     language:
 *                       type: string
 *                       enum: [ar, en]
 *                     traceId:
 *                       type: string
 *       400:
 *         description: Invalid input format or message length exceeds 500 characters
 *       401:
 *         description: Unauthorized - missing or invalid authentication token
 *       403:
 *         description: Forbidden - only client accounts may access the AI Stylist
 *       429:
 *         description: Quota exceeded for ai.messages.daily/lifetime, ai.imageMessages.daily, or ai.productSearch.monthly
 */
