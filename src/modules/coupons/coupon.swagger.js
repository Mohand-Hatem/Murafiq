/**
 * @swagger
 * tags:
 *   name: Coupons
 *   description: Promotional and compensation coupon management
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Coupon:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         code:
 *           type: string
 *           example: "MRF7K9P2X4"
 *         recipientId:
 *           type: string
 *         discountPercentage:
 *           type: number
 *           example: 10
 *         maxDiscountEgp:
 *           type: number
 *           example: 150
 *         status:
 *           type: string
 *           enum: [ISSUED, REDEEMED, EXPIRED, VOIDED]
 *         issuedReason:
 *           type: string
 *           enum: [NO_SHOW_COMPENSATION, LATE_CANCEL_COMPENSATION, MARKETING]
 *         expiresAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /coupons/mine:
 *   get:
 *     summary: Get coupons issued to the authenticated user
 *     tags: [Coupons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ISSUED, REDEEMED, EXPIRED, VOIDED]
 *     responses:
 *       200:
 *         description: List of user coupons
 */

/**
 * @swagger
 * /coupons/validate:
 *   post:
 *     summary: Validate coupon code against a booking without consuming it
 *     tags: [Coupons]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, bookingId]
 *             properties:
 *               code:
 *                 type: string
 *                 example: "MRF7K9P2X4"
 *               bookingId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Coupon is valid and calculated discount returned
 */

/**
 * @swagger
 * /coupons:
 *   post:
 *     summary: Issue promotional coupon to a single client or bulk clients (Admin only)
 *     tags: [Coupons]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               recipientId:
 *                 type: string
 *                 description: Target client ID for single coupon issuance
 *               recipientIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Target client IDs array for bulk issuance (max 100)
 *               discountPercentage:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 100
 *                 default: 10
 *               maxDiscountEgp:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 1000
 *                 default: 150
 *               expiryDays:
 *                 type: integer
 *                 default: 14
 *               issuedReason:
 *                 type: string
 *                 enum: [NO_SHOW_COMPENSATION, LATE_CANCEL_COMPENSATION, MARKETING]
 *                 default: MARKETING
 *     responses:
 *       201:
 *         description: Coupon(s) issued successfully
 */
