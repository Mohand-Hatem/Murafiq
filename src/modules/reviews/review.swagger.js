/**
 * @swagger
 * tags:
 *   name: Reviews
 *   description: Two-way reviews, ratings, and aggregate reputation management
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Review:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "60f719b8f1a2c81234567890"
 *         bookingId:
 *           type: string
 *           example: "60f719b8f1a2c81234567891"
 *         raterId:
 *           type: string
 *           example: "60f719b8f1a2c81234567892"
 *         revieweeId:
 *           type: string
 *           example: "60f719b8f1a2c81234567893"
 *         direction:
 *           type: string
 *           enum: [client_to_stylist, stylist_to_client]
 *           example: "client_to_stylist"
 *         rating:
 *           type: integer
 *           minimum: 1
 *           maximum: 5
 *           example: 5
 *         comment:
 *           type: string
 *           example: "The stylist was punctual, very polite, and gave fantastic fashion advice!"
 *         isHidden:
 *           type: boolean
 *           example: false
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     PublicReview:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "60f719b8f1a2c81234567890"
 *         rating:
 *           type: integer
 *           example: 5
 *         comment:
 *           type: string
 *           example: "Excellent styling session! Highly recommended."
 *         createdAt:
 *           type: string
 *           format: date-time
 *         client:
 *           type: object
 *           properties:
 *             name:
 *               type: string
 *               example: "Sarah Ahmed"
 *             profileImage:
 *               type: string
 *               nullable: true
 *               example: "https://res.cloudinary.com/murafiq/image/upload/avatar.jpg"
 *     CreateReviewRequest:
 *       type: object
 *       required:
 *         - rating
 *       properties:
 *         rating:
 *           type: integer
 *           minimum: 1
 *           maximum: 5
 *           example: 5
 *         comment:
 *           type: string
 *           maxLength: 1000
 *           example: "Great experience! The outfit selection was spot on."
 *     HideReviewRequest:
 *       type: object
 *       properties:
 *         isHidden:
 *           type: boolean
 *           default: true
 *           example: true
 */

/**
 * @swagger
 * /bookings/{bookingId}/review:
 *   post:
 *     summary: Submit a two-way review for a completed booking (direction auto-inferred from caller role)
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the completed booking
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateReviewRequest'
 *     responses:
 *       201:
 *         description: Review submitted successfully
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
 *                   example: "Review submitted successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Review'
 *       400:
 *         description: Booking is not completed yet or invalid rating
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Caller is not a participant in this booking
 *       404:
 *         description: Booking not found
 *       409:
 *         description: You have already submitted a review for this booking
 */

/**
 * @swagger
 * /stylists/{id}/reviews:
 *   get:
 *     summary: Get public paginated reviews for a stylist (client_to_stylist direction only)
 *     tags: [Stylists, Reviews]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Stylist profile ID or Stylist user ID
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
 *           default: "-createdAt"
 *     responses:
 *       200:
 *         description: Stylist reviews retrieved successfully
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
 *                   example: "Stylist reviews retrieved successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PublicReview'
 *                 meta:
 *                   type: object
 */

/**
 * @swagger
 * /reviews/mine:
 *   get:
 *     summary: Get paginated reviews submitted by the authenticated user
 *     tags: [Reviews]
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
 *     responses:
 *       200:
 *         description: User submitted reviews retrieved successfully
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
 *                   example: "My reviews retrieved successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Review'
 *                 meta:
 *                   type: object
 *       401:
 *         description: Unauthenticated
 */

/**
 * @swagger
 * /admin/reviews/{id}/hide:
 *   patch:
 *     summary: Hide or unhide a review for moderation and re-aggregate ratings (Admin only)
 *     tags: [Admin, Reviews]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The review ID to moderate
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/HideReviewRequest'
 *     responses:
 *       200:
 *         description: Review visibility updated and rating recalculated
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
 *                   example: "Review visibility updated to hidden"
 *                 data:
 *                   $ref: '#/components/schemas/Review'
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Forbidden (Admin role required)
 *       404:
 *         description: Review not found
 */
