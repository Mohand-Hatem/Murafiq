/**
 * @swagger
 * components:
 *   schemas:
 *     PublicOffer:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         requestId:
 *           type: string
 *         stylist:
 *           $ref: '#/components/schemas/UserPublic'
 *         client:
 *           $ref: '#/components/schemas/UserPublic'
 *         price:
 *           type: number
 *           description: Binding price in EGP (minimum 100 EGP)
 *         duration:
 *           type: integer
 *           description: Session duration in minutes
 *         message:
 *           type: string
 *         status:
 *           type: string
 *           enum: [pending, accepted, rejected, expired]
 *         expiresAt:
 *           type: string
 *           format: date-time
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     ApiResponseOfferSuccess:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *         data:
 *           $ref: '#/components/schemas/PublicOffer'
 */

/**
 * @swagger
 * /offers/requests/{id}:
 *   post:
 *     summary: Send a binding offer for a request (Verified Stylist only, max 5/day)
 *     tags: [Offers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [price, duration]
 *             properties:
 *               price:
 *                 type: number
 *                 minimum: 100
 *                 description: Minimum binding price is 100 EGP
 *               duration:
 *                 type: integer
 *                 description: Duration in minutes
 *               message:
 *                 type: string
 *     responses:
 *       201:
 *         description: Offer sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseOfferSuccess'
 *       400:
 *         description: Request expired or invalid status / Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: Stylist identity not verified OR daily offer cap reached (5/day)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: Active offer already open with this client
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *   get:
 *     summary: List all offers on a request for comparison (Client owner only)
 *     description: >
 *       Full price/stylist comparison for the request's own client. Sealed-bid applies to other
 *       stylists, not to the client — this endpoint intentionally returns every competing offer's
 *       price so the client can choose the best one.
 *     tags: [Offers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Request ID
 *     responses:
 *       200:
 *         description: Offers retrieved successfully, sorted by price ascending
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PublicOffer'
 *       403:
 *         description: Not the owner of this request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Request not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */

/**
 * @swagger
 * /offers/{id}/accept:
 *   patch:
 *     summary: Accept an offer (Client owner only)
 *     tags: [Offers]
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
 *         description: Offer accepted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseOfferSuccess'
 *       400:
 *         description: Offer expired or invalid status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */

/**
 * @swagger
 * /offers/{id}/reject:
 *   patch:
 *     summary: Reject an offer (Client owner only)
 *     tags: [Offers]
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
 *         description: Offer rejected successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseOfferSuccess'
 */

/**
 * @swagger
 * /offers/{id}/withdraw:
 *   patch:
 *     summary: Withdraw a pending offer (Stylist owner only)
 *     tags: [Offers]
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
 *         description: Offer withdrawn successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseOfferSuccess'
 *       400:
 *         description: Cannot withdraw non-pending offer
 *       403:
 *         description: Only the authoring stylist can withdraw their offer
 */

