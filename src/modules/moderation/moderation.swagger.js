/**
 * @swagger
 * tags:
 *   name: Moderation
 *   description: Safety, content filtering, and policy enforcement (Admin only)
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     ModerationEvent:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         conversationId:
 *           type: string
 *         senderId:
 *           type: object
 *         recipientId:
 *           type: object
 *         messageSnippet:
 *           type: string
 *         matchedLayer:
 *           type: string
 *           enum: [NORMALIZATION, REGEX_CONTACT, DOMAIN_DENYLIST, WORD_LIST, CLASSIFIER, USER_REPORT]
 *         matchedRule:
 *           type: string
 *         severity:
 *           type: string
 *           enum: [LOW, MEDIUM, HIGH, CRITICAL]
 *         actionTaken:
 *           type: string
 *           enum: [ALLOW, BLOCK_ONLY, OBSERVED, RESTRICT, BAN]
 *         reviewStatus:
 *           type: string
 *           enum: [PENDING, APPROVED, DISMISSED]
 *         createdAt:
 *           type: string
 *           format: date-time
 *     BlockedDomain:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         domain:
 *           type: string
 *         category:
 *           type: string
 *         isActive:
 *           type: boolean
 */

/**
 * @swagger
 * /admin/moderation/events:
 *   get:
 *     summary: Get flagged moderation events (Admin only)
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
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
 *       - in: query
 *         name: reviewStatus
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED, DISMISSED]
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *           enum: [LOW, MEDIUM, HIGH, CRITICAL]
 *     responses:
 *       200:
 *         description: Moderation events retrieved successfully
 */

/**
 * @swagger
 * /admin/moderation/events/{id}/confirm:
 *   post:
 *     summary: Confirm flagged moderation violation (Admin & Operator)
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Event review confirmed
 */

/**
 * @swagger
 * /admin/moderation/events/{id}/overturn:
 *   post:
 *     summary: Overturn false-positive moderation flag (Admin & Operator)
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Event review overturned
 */


/**
 * @swagger
 * /admin/moderation/blocked-domains:
 *   get:
 *     summary: Get all active blocked domains (Admin only)
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Blocked domains retrieved successfully
 *   post:
 *     summary: Add domain to blocklist (Admin only)
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [domain]
 *             properties:
 *               domain:
 *                 type: string
 *                 example: "badsite.com"
 *               category:
 *                 type: string
 *                 example: "external_communication"
 *     responses:
 *       201:
 *         description: Domain added to blocklist
 */

/**
 * @swagger
 * /admin/moderation/blocked-domains/{id}:
 *   delete:
 *     summary: Remove domain from blocklist (Admin only)
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Domain removed from blocklist
 */

/**
 * @swagger
 * /admin/moderation/blocked-words:
 *   get:
 *     summary: Get paginated blocked words (Admin only)
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
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
 *       - in: query
 *         name: language
 *         schema:
 *           type: string
 *           enum: [ar, en, both]
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [PROFANITY, INSULT, SEXUAL, HATE, THREAT, HARASSMENT]
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *           enum: [LOW, MEDIUM, HIGH, CRITICAL]
 *     responses:
 *       200:
 *         description: Blocked words retrieved successfully
 *   post:
 *     summary: Add word to blocklist (Admin only)
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [word]
 *             properties:
 *               word:
 *                 type: string
 *                 example: "badword"
 *               language:
 *                 type: string
 *                 enum: [ar, en, both]
 *                 default: "both"
 *               category:
 *                 type: string
 *                 enum: [PROFANITY, INSULT, SEXUAL, HATE, THREAT, HARASSMENT]
 *                 default: "PROFANITY"
 *               severity:
 *                 type: string
 *                 enum: [LOW, MEDIUM, HIGH, CRITICAL]
 *                 default: "MEDIUM"
 *     responses:
 *       201:
 *         description: Word added to blocklist
 *
 * /admin/moderation/blocked-words/bulk:
 *   post:
 *     summary: Bulk add words to blocklist (Admin only)
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [words]
 *             properties:
 *               words:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [word]
 *                   properties:
 *                     word:
 *                       type: string
 *                     language:
 *                       type: string
 *                       enum: [ar, en, both]
 *                     category:
 *                       type: string
 *                       enum: [PROFANITY, INSULT, SEXUAL, HATE, THREAT, HARASSMENT]
 *                     severity:
 *                       type: string
 *                       enum: [LOW, MEDIUM, HIGH, CRITICAL]
 *     responses:
 *       201:
 *         description: Bulk words added to blocklist
 *
 * /admin/moderation/blocked-words/{id}:
 *   delete:
 *     summary: Remove word from blocklist (Admin only)
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Word removed from blocklist
 */

/**
 * @swagger
 * /admin/moderation/violations/{id}/forgive:
 *   patch:
 *     summary: Forgive a policy violation strike (Admin only)
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Policy violation strike forgiven
 */
