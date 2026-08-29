/**
 * @swagger
 * tags:
 *   name: Subscriptions
 *   description: Subscription plans, entitlements, quota meters, and billing lifecycle
 */

/**
 * @swagger
 * /api/v1/subscriptions/plans:
 *   get:
 *     summary: List active subscription plans
 *     tags: [Subscriptions]
 *     parameters:
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [client, stylist]
 *         description: Filter plans by user role
 *     responses:
 *       200:
 *         description: List of available subscription plans
 */

/**
 * @swagger
 * /api/v1/subscriptions/me:
 *   get:
 *     summary: Get current user's active subscription, entitlements, and usage meters
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active subscription status and live quota counters
 */

/**
 * @swagger
 * /api/v1/subscriptions/me/entitlements:
 *   get:
 *     summary: Get current user's flat entitlement map
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Flat key-value entitlements map
 */

/**
 * @swagger
 * /api/v1/subscriptions/subscribe:
 *   post:
 *     summary: Subscribe or upgrade to a plan
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - planCode
 *             properties:
 *               planCode:
 *                 type: string
 *                 example: client.pro
 *               billingCycle:
 *                 type: string
 *                 enum: [monthly, yearly]
 *                 default: monthly
 *     responses:
 *       200:
 *         description: Subscription updated successfully
 */

/**
 * @swagger
 * /api/v1/subscriptions/cancel:
 *   post:
 *     summary: Schedule active subscription cancellation at period end
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Subscription cancellation scheduled
 */
