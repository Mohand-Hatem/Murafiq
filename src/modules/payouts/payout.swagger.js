/**
 * @swagger
 * tags:
 *   name: Payouts
 *   description: Stylist earnings disbursement and admin payout batches
 */

/**
 * @swagger
 * /api/v1/payouts/account:
 *   get:
 *     summary: Get stylist payout account credentials
 *     tags: [Payouts]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Payout account details
 *   patch:
 *     summary: Update stylist payout account credentials
 *     tags: [Payouts]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [method]
 *             properties:
 *               method:
 *                 type: string
 *                 enum: [bank_transfer, vodafone_cash, instapay]
 *               accountHolderName:
 *                 type: string
 *               bankName:
 *                 type: string
 *               accountNumber:
 *                 type: string
 *               walletPhone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated payout account
 */

/**
 * @swagger
 * /api/v1/payouts/mine:
 *   get:
 *     summary: List stylist's own historical payouts
 *     tags: [Payouts]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of stylist payouts
 */

/**
 * @swagger
 * /api/v1/payouts/admin/pending-balances:
 *   get:
 *     summary: Admin summary of eligible unpaid balances per stylist
 *     tags: [Payouts]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Summary of eligible balances
 */

/**
 * @swagger
 * /api/v1/payouts/admin/batch:
 *   post:
 *     summary: Generate batch payouts for eligible stylists
 *     tags: [Payouts]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stylistIds]
 *             properties:
 *               stylistIds:
 *                 type: array
 *                 items:
 *                   type: string
 *               holdWindowHours:
 *                 type: integer
 *                 default: 48
 *     responses:
 *       201:
 *         description: Created batch payouts
 */
