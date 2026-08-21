/**
 * @swagger
 * components:
 *   schemas:
 *     PublicPayment:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "60f719b8f1a2c81234567890"
 *         bookingId:
 *           type: string
 *           example: "60f719b8f1a2c81234567891"
 *         clientId:
 *           type: string
 *           example: "60f719b8f1a2c81234567892"
 *         currency:
 *           type: string
 *           example: "EGP"
 *         amount:
 *           type: number
 *           example: 1000.00
 *         platformFeePercentage:
 *           type: number
 *           example: 15
 *         platformFeeAmount:
 *           type: number
 *           example: 150.00
 *         stylistPayoutAmount:
 *           type: number
 *           example: 850.00
 *         status:
 *           type: string
 *           enum: [pending, paid, failed, cancelled, refunded]
 *           example: "paid"
 *         refundAmount:
 *           type: number
 *           example: 0.00
 *         refundReason:
 *           type: string
 *           nullable: true
 *         provider:
 *           type: string
 *           enum: [mock, paymob]
 *           example: "paymob"
 *         paidAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *     PaymentInitData:
 *       type: object
 *       properties:
 *         paymentUrl:
 *           type: string
 *           example: "https://accept.paymob.com/unifiedcheckout/?publicKey=pk_test_123&clientSecret=sk_test_456"
 *         clientSecret:
 *           type: string
 *           example: "sk_test_secret_key"
 *         payment:
 *           $ref: '#/components/schemas/PublicPayment'
 *     ApiResponsePaymentSuccess:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Payment status retrieved successfully"
 *         data:
 *           $ref: '#/components/schemas/PublicPayment'
 *     ApiResponsePaymentInitSuccess:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Payment initialized successfully"
 *         data:
 *           $ref: '#/components/schemas/PaymentInitData'
 *     ApiResponsePaymentHistorySuccess:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Payment history retrieved successfully"
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/PublicPayment'
 *         meta:
 *           $ref: '#/components/schemas/PaginationMeta'
 */

/**
 * @swagger
 * tags:
 *   name: Payments
 *   description: Payment checkout, webhook callbacks, escrow tracking and refund management
 */

/**
 * @swagger
 * /payments/callback:
 *   post:
 *     summary: Payment gateway webhook (Paymob / Mock provider)
 *     tags: [Payments]
 *     description: Public webhook endpoint called by Paymob to verify transaction completion and unlock booking escrow.
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponsePaymentSuccess'
 *       400:
 *         description: Invalid HMAC signature
 *       404:
 *         description: Payment record not found
 */

/**
 * @swagger
 * /payments/{bookingId}/initialize:
 *   post:
 *     summary: Initialize payment session for a booking
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment session initialized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponsePaymentInitSuccess'
 *       400:
 *         description: Booking already paid
 *       403:
 *         description: Forbidden (Client role required, must own booking)
 *       404:
 *         description: Booking not found
 */

/**
 * @swagger
 * /payments/{bookingId}/status:
 *   get:
 *     summary: Get payment status for a booking
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment status details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponsePaymentSuccess'
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Payment not found
 */

/**
 * @swagger
 * /payments/history:
 *   get:
 *     summary: List client payment history
 *     tags: [Payments]
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
 *           default: 10
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, paid, failed, cancelled, refunded]
 *     responses:
 *       200:
 *         description: Paginated payment history
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponsePaymentHistorySuccess'
 */

/**
 * @swagger
 * /payments/{bookingId}/refund:
 *   post:
 *     summary: Admin-triggered refund for a booking
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refundPercentage:
 *                 type: number
 *                 example: 75
 *               reason:
 *                 type: string
 *                 example: "Client cancelled under 24h"
 *     responses:
 *       200:
 *         description: Payment refunded successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponsePaymentSuccess'
 *       400:
 *         description: Payment not in paid status
 *       403:
 *         description: Forbidden (Admin only)
 *       404:
 *         description: Payment not found
 */
