/**
 * @swagger
 * tags:
 *   name: Payouts — Admin
 *   description: |
 *     Disbursement is a deliberate manual action, never automatic. A booking becomes
 *     payout-*eligible* 48 hours after completion; an admin then batches, transfers, and
 *     confirms. Outstanding stylist penalties are netted at batch time.
 */

/**
 * @swagger
 * /payouts/admin:
 *   get:
 *     summary: List payout batches
 *     tags: [Payouts — Admin]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, processing, paid, failed] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200: { description: Paginated payout batches }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */

/**
 * @swagger
 * /payouts/admin/{id}/mark-processing:
 *   patch:
 *     summary: Mark a batch as being transferred
 *     description: |
 *       State-guarded: only a `pending` batch may move to `processing`. This is the point
 *       after which a refund on any included booking requires manual reconciliation,
 *       because the stylist's share is already leaving the platform.
 *     tags: [Payouts — Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Batch marked processing }
 *       409: { description: Batch is not in `pending` state }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */

/**
 * @swagger
 * /payouts/admin/{id}/mark-paid:
 *   patch:
 *     summary: Confirm a transfer completed
 *     description: |
 *       Marks the batch `paid`, flips its bookings to `payoutStatus: paid`, and posts the
 *       `PAYOUT_DISBURSEMENT` ledger entries. Idempotency-keyed, so a repeated call cannot
 *       double-record the disbursement.
 *     tags: [Payouts — Admin]
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
 *               reference: { type: string, description: 'Bank or wallet transfer reference' }
 *     responses:
 *       200: { description: Batch marked paid }
 *       409: { description: Already paid, or not in a payable state }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */

/**
 * @swagger
 * /payouts/admin/{id}/mark-failed:
 *   patch:
 *     summary: Record a failed transfer
 *     description: |
 *       Releases the batch's bookings back to `payoutStatus: unpaid` so they can be
 *       re-batched. A batch already marked `paid` cannot be failed.
 *     tags: [Payouts — Admin]
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
 *               failureReason: { type: string }
 *     responses:
 *       200: { description: Batch marked failed; bookings released for re-batching }
 *       409: { description: Batch is already paid }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
