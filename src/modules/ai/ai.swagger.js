/**
 * @swagger
 * tags:
 *   - name: AI Stylist
 *     description: AI-powered occasion styling, wardrobe retrieval, and outfit composition
 *   - name: AI Conversations
 *     description: AI conversation and chat history management
 *   - name: AI Outfits
 *     description: Saved outfit recommendations and styling history
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
 *                     requestId:
 *                       type: string
 *                       example: 550e8400-e29b-41d4-a716-446655440000
 *                     status:
 *                       type: string
 *                       enum: [processing, completed, failed, cancelled]
 *                       example: completed
 *                     responseType:
 *                       type: string
 *                       enum: [success, clarification, partial_results, error]
 *                       example: success
 *                     searchStatus:
 *                       type: string
 *                       enum: [success, no_results, skipped, quota_blocked]
 *                       example: skipped
 *                     assistantMessage:
 *                       type: string
 *                       example: Classic formal navy suit paired with crisp white shirt.
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
 *                           outfitTitle:
 *                             type: string
 *                             nullable: true
 *                             example: "الإطلالة الأولى (كاجوال يومي)"
 *                     suggestBookStylist:
 *                       type: boolean
 *                     stylistBookingCta:
 *                       type: string
 *                       nullable: true
 *                     anchor:
 *                       type: object
 *                       nullable: true
 *                     matchHint:
 *                       type: string
 *                       nullable: true
 *                     canSaveToWardrobe:
 *                       type: boolean
 *                     saveToWardrobeCta:
 *                       type: string
 *                       nullable: true
 *                     saveMessageId:
 *                       type: string
 *                       nullable: true
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

/**
 * @swagger
 * /ai/stylist/requests/{requestId}:
 *   get:
 *     summary: Poll status of an AI stylist request
 *     tags: [AI Stylist]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *         description: Request ID / trace identifier
 *     responses:
 *       200:
 *         description: Stylist request status retrieved successfully
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
 *                   example: Stylist request status retrieved successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     requestId:
 *                       type: string
 *                       example: 550e8400-e29b-41d4-a716-446655440000
 *                     status:
 *                       type: string
 *                       enum: [processing, completed, failed, cancelled]
 *                       example: completed
 *                     responseType:
 *                       type: string
 *                       enum: [success, clarification, partial_results, error]
 *                       example: success
 *                     searchStatus:
 *                       type: string
 *                       enum: [success, no_results, skipped, quota_blocked]
 *                       example: skipped
 *                     assistantMessage:
 *                       type: string
 *                       nullable: true
 *                       example: Classic formal navy suit paired with crisp white shirt.
 *                     result:
 *                       type: object
 *                       nullable: true
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - clients only
 *       404:
 *         description: Stylist request not found
 */

/**
 * @swagger
 * /ai/stylist/requests/{requestId}/cancel:
 *   post:
 *     summary: Cancel an active stylist request with quota refund
 *     tags: [AI Stylist]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *         description: Request ID / trace identifier
 *     responses:
 *       200:
 *         description: Request cancelled successfully or already finalized
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
 *                   example: Stylist request cancelled successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     requestId:
 *                       type: string
 *                     status:
 *                       type: string
 *                       example: cancelled
 *                     responseType:
 *                       type: string
 *                       example: error
 *                     searchStatus:
 *                       type: string
 *                       example: skipped
 *                     assistantMessage:
 *                       type: string
 *                       example: Request cancelled by user
 *                     result:
 *                       type: object
 *                       nullable: true
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - clients only
 *       404:
 *         description: Stylist request not found
 */

/**
 * @swagger
 * /ai/stylist/feedback:
 *   post:
 *     summary: Submit feedback on a generated outfit
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
 *               - outfitId
 *               - feedback
 *             properties:
 *               outfitId:
 *                 type: string
 *                 example: 507f1f77bcf86cd799439011
 *                 description: 24-character hexadecimal ObjectId of the Outfit
 *               feedback:
 *                 type: string
 *                 enum: [liked, disliked]
 *                 description: User rating for this outfit recommendation
 *     responses:
 *       200:
 *         description: Feedback submitted successfully
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
 *                   example: Feedback submitted successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     userFeedback:
 *                       type: string
 *                       enum: [liked, disliked]
 *       400:
 *         description: Invalid input or invalid feedback value
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - clients only
 *       404:
 *         description: Outfit not found
 */

/**
 * @swagger
 * /ai/wardrobe/from-chat:
 *   post:
 *     summary: Save analyzed garment from chat into client wardrobe
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
 *               - messageId
 *             properties:
 *               messageId:
 *                 type: string
 *                 example: 507f1f77bcf86cd799439011
 *                 description: 24-character hexadecimal ObjectId of the AiMessage containing analyzed garment
 *     responses:
 *       201:
 *         description: Wardrobe item saved from chat successfully
 *       400:
 *         description: Message does not contain an analyzed garment image
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - clients only
 *       404:
 *         description: Message not found or access denied
 *       429:
 *         description: Wardrobe photo capacity exceeded
 */

/**
 * @swagger
 * /ai/conversations:
 *   post:
 *     summary: Create a new AI conversation
 *     tags: [AI Conversations]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 maxLength: 120
 *                 example: Wedding Guest Styling
 *                 description: Optional conversation title
 *     responses:
 *       201:
 *         description: AI conversation created successfully
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
 *                   example: AI conversation created successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     title:
 *                       type: string
 *                     lastMessageAt:
 *                       type: string
 *                       format: date-time
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - clients only
 *   get:
 *     summary: List user AI conversations
 *     tags: [AI Conversations]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: AI conversations retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     conversations:
 *                       type: array
 *                       items:
 *                         type: object
 *                     pagination:
 *                       type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - clients only
 */

/**
 * @swagger
 * /ai/conversations/{conversationId}:
 *   get:
 *     summary: Get a single AI conversation
 *     tags: [AI Conversations]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: 24-character hexadecimal ObjectId of the conversation
 *     responses:
 *       200:
 *         description: AI conversation retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - clients only
 *       404:
 *         description: AI conversation not found
 *   delete:
 *     summary: Delete an AI conversation and its messages
 *     tags: [AI Conversations]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: 24-character hexadecimal ObjectId of the conversation
 *     responses:
 *       200:
 *         description: AI conversation deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - clients only
 *       404:
 *         description: AI conversation not found
 */

/**
 * @swagger
 * /ai/conversations/{conversationId}/messages:
 *   get:
 *     summary: Get message history for an AI conversation
 *     tags: [AI Conversations]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: 24-character hexadecimal ObjectId of the conversation
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Conversation messages retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     messages:
 *                       type: array
 *                       items:
 *                         type: object
 *                     pagination:
 *                       type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - clients only
 *       404:
 *         description: AI conversation not found
 */

/**
 * @swagger
 * /ai/outfits:
 *   get:
 *     summary: List user outfit history
 *     tags: [AI Outfits]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Outfits retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     outfits:
 *                       type: array
 *                       items:
 *                         type: object
 *                     pagination:
 *                       type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - clients only
 */

/**
 * @swagger
 * /ai/outfits/{outfitId}:
 *   get:
 *     summary: Get a single outfit by ID
 *     tags: [AI Outfits]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: outfitId
 *         required: true
 *         schema:
 *           type: string
 *         description: 24-character hexadecimal ObjectId of the outfit
 *     responses:
 *       200:
 *         description: Outfit retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - clients only
 *       404:
 *         description: Outfit not found
 *   delete:
 *     summary: Delete an outfit by ID
 *     tags: [AI Outfits]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: outfitId
 *         required: true
 *         schema:
 *           type: string
 *         description: 24-character hexadecimal ObjectId of the outfit
 *     responses:
 *       200:
 *         description: Outfit deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - clients only
 *       404:
 *         description: Outfit not found
 */

// ── Inactive Preferences Swagger Documentation (FUTURE FEATURE — INACTIVE IN PHASE 15) ──
// /**
//  * @swagger
//  * /ai/preferences:
//  *   get:
//  *     summary: (Future/Inactive) Get style preferences
//  *   patch:
//  *     summary: (Future/Inactive) Update style preferences
//  */
