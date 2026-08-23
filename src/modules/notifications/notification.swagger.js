/**
 * @swagger
 * tags:
 *   name: Notifications
 *   description: In-app notification feed and device push token registration
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Notification:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "60f719b8f1a2c81234567890"
 *         type:
 *           type: string
 *           enum: [request, offer, booking, payment, message, reminder, review, verification, safety, payout, system]
 *           example: "booking"
 *         title:
 *           type: string
 *           example: "Booking Confirmed"
 *         body:
 *           type: string
 *           example: "Your offer has been accepted and your session is scheduled."
 *         relatedEntityId:
 *           type: string
 *           nullable: true
 *           example: "60f719b8f1a2c81234567891"
 *         isRead:
 *           type: boolean
 *           example: false
 *         createdAt:
 *           type: string
 *           format: date-time
 *     UnreadCountResponse:
 *       type: object
 *       properties:
 *         unreadCount:
 *           type: integer
 *           example: 3
 *     DeviceTokenRequest:
 *       type: object
 *       required:
 *         - token
 *       properties:
 *         token:
 *           type: string
 *           example: "fcm_device_token_sample_string_12345"
 */

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: Get paginated in-app notifications for the authenticated user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
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
 *         name: isRead
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Notifications list fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     items:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Notification'
 *                     meta:
 *                       type: object
 *       401:
 *         description: Unauthenticated
 */

/**
 * @swagger
 * /notifications/unread-count:
 *   get:
 *     summary: Get unread notifications counter for badge display
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Unread count fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/UnreadCountResponse'
 *       401:
 *         description: Unauthenticated
 */

/**
 * @swagger
 * /notifications/read-all:
 *   patch:
 *     summary: Mark all notifications as read for current user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     success:
 *                       type: boolean
 *                       example: true
 *                     message:
 *                       type: string
 *                       example: "All notifications marked as read"
 *       401:
 *         description: Unauthenticated
 */

/**
 * @swagger
 * /notifications/{id}/read:
 *   patch:
 *     summary: Mark a single notification as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Notification marked as read
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Notification'
 *       401:
 *         description: Unauthenticated
 *       404:
 *         description: Notification not found
 */

/**
 * @swagger
 * /notifications/device-token:
 *   post:
 *     summary: Register an FCM device token for push notifications
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DeviceTokenRequest'
 *     responses:
 *       200:
 *         description: Device token registered successfully
 *       400:
 *         description: Invalid token payload
 *       401:
 *         description: Unauthenticated
 *   delete:
 *     summary: Unregister an FCM device token upon logout
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DeviceTokenRequest'
 *     responses:
 *       200:
 *         description: Device token removed successfully
 *       400:
 *         description: Invalid token payload
 *       401:
 *         description: Unauthenticated
 */
