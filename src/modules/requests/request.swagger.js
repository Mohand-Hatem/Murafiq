/**
 * @swagger
 * components:
 *   schemas:
 *     PublicRequest:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         client:
 *           $ref: '#/components/schemas/UserPublic'
 *         stylist:
 *           $ref: '#/components/schemas/UserPublic'
 *         title:
 *           type: string
 *         date:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         time:
 *           type: string
 *           nullable: true
 *         meetingLocation:
 *           type: object
 *           nullable: true
 *           properties:
 *             address:
 *               type: string
 *             country:
 *               type: string
 *             governorate:
 *               type: string
 *             city:
 *               type: string
 *             area:
 *               type: string
 *             location:
 *               type: object
 *               properties:
 *                 type:
 *                   type: string
 *                   example: Point
 *                 coordinates:
 *                   type: array
 *                   items:
 *                     type: number
 *                   example: [31.2357, 30.0444]
 *         description:
 *           type: string
 *         budgetRange:
 *           type: object
 *           nullable: true
 *           properties:
 *             min:
 *               type: number
 *             max:
 *               type: number
 *         images:
 *           type: array
 *           items:
 *             type: string
 *         visibility:
 *           type: string
 *           enum: [direct, broadcast]
 *           example: direct
 *         status:
 *           type: string
 *           enum: [pending, offered, accepted, rejected, expired, cancelled]
 *         expiresAt:
 *           type: string
 *           format: date-time
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     ApiResponseRequestSuccess:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *         data:
 *           $ref: '#/components/schemas/PublicRequest'
 *     ApiResponseRequestsListSuccess:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/PublicRequest'
 *         meta:
 *           type: object
 *           properties:
 *             total:
 *               type: integer
 *             page:
 *               type: integer
 *             limit:
 *               type: integer
 *             totalPages:
 *               type: integer
 */

/**
 * @swagger
 * /requests:
 *   post:
 *     summary: Create a direct or open broadcast request (Verified Client only)
 *     tags: [Requests]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - type: object
 *                 required: [visibility, stylistId, title]
 *                 properties:
 *                   visibility:
 *                     type: string
 *                     enum: [direct]
 *                   stylistId:
 *                     type: string
 *                   title:
 *                     type: string
 *                   date:
 *                     type: string
 *                     format: date-time
 *                   time:
 *                     type: string
 *                   meetingLocation:
 *                     type: object
 *                   description:
 *                     type: string
 *                   budgetRange:
 *                     type: object
 *                   images:
 *                     type: array
 *                     items:
 *                       type: string
 *               - type: object
 *                 required: [visibility, title]
 *                 properties:
 *                   visibility:
 *                     type: string
 *                     enum: [broadcast]
 *                   title:
 *                     type: string
 *                   date:
 *                     type: string
 *                     format: date-time
 *                   time:
 *                     type: string
 *                   meetingLocation:
 *                     type: object
 *                   description:
 *                     type: string
 *                   budgetRange:
 *                     type: object
 *                   images:
 *                     type: array
 *                     items:
 *                       type: string
 *     responses:
 *       201:
 *         description: Request created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseRequestSuccess'
 *       400:
 *         description: Validation error / Target stylist not verified
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: Client identity not verified OR daily request cap reached
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */

/**
 * @swagger
 * /requests/feed:
 *   get:
 *     summary: Get open broadcast requests feed (Stylist only)
 *     tags: [Requests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: governorate
 *         schema:
 *           type: string
 *       - in: query
 *         name: city
 *         schema:
 *           type: string
 *       - in: query
 *         name: lat
 *         schema:
 *           type: number
 *       - in: query
 *         name: lng
 *         schema:
 *           type: number
 *       - in: query
 *         name: radiusKm
 *         schema:
 *           type: number
 *           default: 10
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
 *         name: sort
 *         schema:
 *           type: string
 *           example: "createdAt:desc"
 *     responses:
 *       200:
 *         description: Broadcast feed retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseRequestsListSuccess'
 *       403:
 *         description: Only stylists can access the broadcast feed
 */

/**
 * @swagger
 * /requests/mine:
 *   get:
 *     summary: Get client's own requests
 *     tags: [Requests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, offered, accepted, rejected, expired, cancelled]
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
 *     responses:
 *       200:
 *         description: Client requests retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseRequestsListSuccess'
 */

/**
 * @swagger
 * /requests/incoming:
 *   get:
 *     summary: Get incoming requests for stylist
 *     tags: [Requests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, offered, accepted, rejected, expired, cancelled]
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
 *     responses:
 *       200:
 *         description: Incoming requests retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseRequestsListSuccess'
 */

/**
 * @swagger
 * /requests/{id}/cancel:
 *   patch:
 *     summary: Cancel a pending request (Client owner only)
 *     tags: [Requests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Request cancelled successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseRequestSuccess'
 */

/**
 * @swagger
 * /requests/{id}/decline:
 *   patch:
 *     summary: Decline a pending request (Stylist target only)
 *     tags: [Requests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Request declined successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseRequestSuccess'
 */
