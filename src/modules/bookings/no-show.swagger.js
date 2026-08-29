/**
 * @swagger
 * tags:
 *   name: Bookings — No-show & Disputes
 *   description: |
 *     No-show reporting is deliberately gated. A one-tap "they didn't show" that moves
 *     money would be a fraud primitive, so a report requires the grace window to have
 *     elapsed AND the reporter to have checked in themselves, and the accused gets a
 *     response window before anything settles.
 */

/**
 * @swagger
 * /bookings/{id}/no-show:
 *   post:
 *     summary: Report the other party as a no-show
 *     description: |
 *       **Preconditions**
 *       - Booking is `confirmed` or `in-progress`
 *       - At least 30 minutes past the scheduled start
 *       - The reporter has already checked in (`checkInAt` is set) — the only evidence
 *         the platform holds that the accuser actually attended
 *       - No no-show has already been reported for this booking
 *
 *       **Effect:** records the report and notifies the accused, who has 2 hours to
 *       respond. No money moves at this step.
 *     tags: [Bookings — No-show & Disputes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               evidence:
 *                 type: array
 *                 maxItems: 5
 *                 items: { type: string, format: uri }
 *     responses:
 *       201:
 *         description: Report filed; `respondBy` is the deadline for the accused
 *       400:
 *         description: Grace window not elapsed, reporter has not checked in, or booking is not reportable
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       409:
 *         description: A no-show has already been reported for this booking
 */

/**
 * @swagger
 * /bookings/{id}/no-show/respond:
 *   post:
 *     summary: Respond to a no-show report (accused party only)
 *     description: |
 *       `contest: false` accepts the report and settles immediately per the policy matrix.
 *       `contest: true` moves the booking to `disputed` for admin arbitration.
 *
 *       Silence past the 2-hour window auto-resolves in the reporter's favour via the
 *       no-show sweep, so ignoring the notification is not a way to stall settlement.
 *     tags: [Bookings — No-show & Disputes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contest]
 *             properties:
 *               contest: { type: boolean }
 *               message: { type: string, maxLength: 1000 }
 *     responses:
 *       200:
 *         description: Response recorded — settled, or escalated to arbitration
 *       400:
 *         description: No report exists for this booking
 *       403:
 *         description: Only the reported party may respond
 *       409:
 *         description: Already responded
 */

/**
 * @swagger
 * /bookings/{id}/dispute:
 *   get:
 *     summary: Read the dispute details for a booking
 *     tags: [Bookings — No-show & Disputes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Dispute details }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */

/**
 * @swagger
 * /bookings/{id}/dispute/evidence:
 *   post:
 *     summary: Attach evidence to an open dispute
 *     tags: [Bookings — No-show & Disputes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               evidence:
 *                 type: array
 *                 items: { type: string, format: uri }
 *     responses:
 *       200: { description: Evidence attached }
 *       400: { description: Booking is not in a disputed state }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */

/**
 * @swagger
 * /bookings/{bookingId}/reviews:
 *   get:
 *     summary: Reviews written for a booking (both directions)
 *     tags: [Bookings — No-show & Disputes]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Reviews for the booking }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
