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
 *     summary: Switch to a FREE plan, or schedule a downgrade
 *     description: >
 *       Does not collect payment. Any plan with a price is rejected with 402 -- use
 *       POST /api/v1/subscriptions/checkout to buy one. A move to a cheaper plan is
 *       scheduled for the end of the paid period rather than applied immediately.
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
 *         description: Subscription updated, or downgrade scheduled
 *       402:
 *         description: Plan requires payment -- start a checkout instead
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: >
 *           Plan not found, or retired .yearly code. If an old .yearly plan code is passed,
 *           returns 404 naming the replacement parent planCode and billingCycle: yearly.
 */

/**
 * @swagger
 * /api/v1/subscriptions/checkout:
 *   post:
 *     summary: Initiate a Paymob checkout session for upgrading to a paid subscription plan
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
 *         description: >
 *           Checkout intention initialized. Open `paymentUrl` in a browser; poll
 *           GET /api/v1/subscriptions/orders/{orderId} after the redirect returns.
 *       400:
 *         description: Free plan, or the plan has no yearly billing option
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: >
 *           Plan not found, or retired .yearly code. If an old .yearly plan code is passed,
 *           returns 404 naming the replacement parent planCode and billingCycle: yearly.
 *
 * /api/v1/subscriptions/orders/{orderId}:
 *   get:
 *     summary: Read the status of a subscription checkout order
 *     description: >
 *       Closing step of the checkout cycle. Paymob redirects the browser to a frontend URL,
 *       so this is how the app confirms server-side whether the payment landed.
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *         description: The orderId returned by POST /subscriptions/checkout
 *     responses:
 *       200:
 *         description: Order status (pending | paid | failed)
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *
 * /api/v1/subscriptions/webhook:
 *   post:
 *     summary: Webhook callback for Paymob subscription order payments
 *     tags: [Subscriptions]
 *     responses:
 *       200:
 *         description: Webhook processed and subscription activated
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

