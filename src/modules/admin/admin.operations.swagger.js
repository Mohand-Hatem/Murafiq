/**
 * @swagger
 * tags:
 *   name: Admin — Operations
 *   description: Arbitration, account actions, payout batch control and audit search.
 *     All routes require the `admin` role unless stated otherwise.
 */

/**
 * @swagger
 * /admin/audit-logs:
 *   get:
 *     summary: Search the audit log
 *     description: |
 *       Audit entries are written by a single event-bus listener, never by scattered calls
 *       from business logic. Every money-affecting and account-affecting event is recorded:
 *       cancellations (with refund tier and penalty), no-show reports and resolutions,
 *       payments, refunds, payouts, disputes, subscription changes, suspensions, and admin
 *       chat access.
 *     tags: [Admin — Operations]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: action
 *         schema: { type: string, example: 'booking.cancelled' }
 *       - in: query
 *         name: targetType
 *         schema: { type: string, example: 'Booking' }
 *     responses:
 *       200: { description: Paginated audit entries }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */

/**
 * @swagger
 * /admin/bookings/disputed:
 *   get:
 *     summary: List bookings awaiting arbitration
 *     tags: [Admin — Operations]
 *     responses:
 *       200: { description: Disputed bookings }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */

/**
 * @swagger
 * /admin/bookings/{id}/resolve-dispute:
 *   patch:
 *     summary: Arbitrate a dispute
 *     description: |
 *       Resolves to exactly one of two outcomes — never a third silent state.
 *       `completed` makes the booking payout-eligible; `cancelled` triggers a refund.
 *       A non-zero `refundPercentage` is executed through the payment service and recorded
 *       in the ledger.
 *     tags: [Admin — Operations]
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
 *             required: [outcome]
 *             properties:
 *               outcome: { type: string, enum: [completed, cancelled] }
 *               refundPercentage: { type: number, minimum: 0, maximum: 100 }
 *               resolutionNotes: { type: string }
 *     responses:
 *       200: { description: Dispute resolved }
 *       409: { description: Booking is not in a disputed state }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */

/**
 * @swagger
 * /admin/bookings/{id}/resolve-no-show:
 *   patch:
 *     summary: Arbitrate a CONTESTED no-show
 *     description: |
 *       Only contested reports reach this endpoint. An uncontested report settles on its
 *       own through the response window and the auto-resolution sweep.
 *
 *       `upheld: true` applies the policy matrix (refund, stylist penalty, compensation
 *       coupon where applicable). `upheld: false` dismisses the report and restores the
 *       booking.
 *     tags: [Admin — Operations]
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
 *             required: [upheld]
 *             properties:
 *               upheld: { type: boolean }
 *               notes: { type: string, maxLength: 2000 }
 *     responses:
 *       200: { description: No-show arbitrated }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */

/**
 * @swagger
 * /admin/users/{id}/suspend:
 *   patch:
 *     summary: Suspend an account
 *     description: |
 *       Sets `accountStatus: suspended`, clears every refresh session, and increments
 *       `tokenVersion` — so outstanding access tokens are rejected immediately rather than
 *       surviving until they expire. A suspended user receives **403** on authenticated
 *       requests and cannot log in, refresh, or sign in with Google.
 *     tags: [Admin — Operations]
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
 *               reason: { type: string }
 *     responses:
 *       200: { description: Account suspended and sessions terminated }
 *       409: { description: Already suspended, or the account is deleted }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */

/**
 * @swagger
 * /admin/users/{id}/reactivate:
 *   patch:
 *     summary: Reactivate a suspended account
 *     tags: [Admin — Operations]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Account reactivated }
 *       409: { description: Account is not suspended }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
