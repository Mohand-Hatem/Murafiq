/**
 * @swagger
 * /reviews/booking/{bookingId}:
 *   get:
 *     summary: Reviews attached to a booking
 *     description: |
 *       Reviews are two-way and independent — `client_to_stylist` and `stylist_to_client`
 *       are separate records, each unique per booking at the database index level, so one
 *       side's duplicate attempt never blocks the other.
 *     tags: [Reviews]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Reviews for the booking }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */

/**
 * @swagger
 * /reviews/stylist/{id}:
 *   get:
 *     summary: Public reviews for a stylist
 *     description: Hidden reviews (moderated by an admin) are excluded.
 *     tags: [Reviews]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200: { description: Paginated public reviews }
 *       404: { $ref: '#/components/responses/NotFound' }
 */

/**
 * @swagger
 * /stylists/{id}/reliability:
 *   get:
 *     summary: A stylist's reliability profile
 *     description: |
 *       Reliability is tracked separately from star rating on purpose: a stylist who does
 *       excellent work but cancels frequently keeps a high rating while still being a poor
 *       booking risk. The score reflects completed sessions, cancellations, late
 *       cancellations and no-shows.
 *     tags: [Stylists]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Reliability profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     reliabilityScore: { type: number, example: 92 }
 *                     reliabilityTier: { type: string, example: 'standard' }
 *                     completedSessions: { type: integer }
 *                     cancelledSessions: { type: integer }
 *                     noShowCount: { type: integer }
 *       404: { $ref: '#/components/responses/NotFound' }
 */

/**
 * @swagger
 * /chat/{conversationId}/report:
 *   post:
 *     summary: Report a message for review
 *     description: |
 *       **This is a required part of the moderation design, not an optional extra.** With
 *       `MODERATION_PROVIDER=none`, the automated layers are deterministic string matching
 *       — strong on contact details and blocked domains, but effectively blind to threats
 *       and harassment, which depend on phrasing rather than vocabulary. Human reporting is
 *       the only cover for that gap.
 *
 *       A report records a `PENDING` moderation event for admin review and **never**
 *       enforces on its own — letting one user's accusation restrict another automatically
 *       would hand every user a weapon.
 *     tags: [Chat]
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reportedUserId, reason]
 *             properties:
 *               reportedUserId: { type: string }
 *               messageId: { type: string }
 *               reason: { type: string, minLength: 3, maxLength: 1000 }
 *               snippet: { type: string, maxLength: 500 }
 *     responses:
 *       201: { description: Report submitted for review }
 *       400: { description: Missing conversation/user, or self-report }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Service health probe
 *     description: Reports MongoDB, Firebase and Redis connectivity. Returns 503 when Mongo is down.
 *     tags: [System]
 *     security: []
 *     responses:
 *       200: { description: Service healthy }
 *       503: { description: Service unhealthy — MongoDB unreachable }
 */
