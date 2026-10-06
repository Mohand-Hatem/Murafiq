/**
 * @swagger
 * tags:
 *   name: Payouts
 *   description: Stylist earnings disbursement and admin payout batches
 */

/**
 * @swagger
 * /payouts/account:
 *   get:
 *     summary: Get stylist payout account credentials
 *     tags: [Payouts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Payout account details
 *   patch:
 *     summary: Update stylist payout account credentials
 *     tags: [Payouts]
 *     security:
 *       - bearerAuth: []
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
 * /payouts/mine:
 *   get:
 *     summary: List stylist's own historical payouts
 *     tags: [Payouts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of stylist payouts
 */

/**
 * @swagger
 * /payouts/admin/pending-balances:
 *   get:
 *     summary: Admin summary of eligible unpaid balances per stylist
 *     tags: [Payouts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Summary of eligible balances
 */

/**
 * @swagger
 * /payouts/admin/batch:
 *   post:
 *     summary: Generate batch payouts for eligible stylists
 *     tags: [Payouts]
 *     security:
 *       - bearerAuth: []
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
