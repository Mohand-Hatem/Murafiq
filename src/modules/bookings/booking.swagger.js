/**
 * @swagger
 * components:
 *   schemas:
 *     PublicBooking:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         requestId:
 *           type: string
 *         offerId:
 *           type: string
 *         client:
 *           $ref: '#/components/schemas/UserPublic'
 *         stylist:
 *           $ref: '#/components/schemas/UserPublic'
 *         scheduledDate:
 *           type: string
 *           format: date-time
 *         startTime:
 *           type: string
 *           example: "10:00"
 *         endTime:
 *           type: string
 *           example: "12:00"
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
 *         price:
 *           type: number
 *         duration:
 *           type: integer
 *         status:
 *           type: string
 *           enum: [confirmed, in-progress, completed, cancelled, disputed]
 *         checkInAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         checkInLocation:
 *           type: object
 *           nullable: true
 *           properties:
 *             lat:
 *               type: number
 *             lng:
 *               type: number
 *         clientConfirmedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         stylistConfirmedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         cancelledBy:
 *           type: string
 *           enum: [client, stylist, admin]
 *           nullable: true
 *         cancellationReason:
 *           type: string
 *           nullable: true
 *         cancelledAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     ApiResponseBookingSuccess:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *         data:
 *           $ref: '#/components/schemas/PublicBooking'
 *     ApiResponseBookingsListSuccess:
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
 *             $ref: '#/components/schemas/PublicBooking'
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
 * /bookings/mine:
 *   get:
 *     summary: Get client's own bookings
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [confirmed, in-progress, completed, cancelled, disputed]
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
 *         description: Bookings retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseBookingsListSuccess'
 */

/**
 * @swagger
 * /bookings/stylist:
 *   get:
 *     summary: Get stylist's own bookings
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [confirmed, in-progress, completed, cancelled, disputed]
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
 *         description: Stylist bookings retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseBookingsListSuccess'
 */

/**
 * @swagger
 * /bookings/{id}:
 *   get:
 *     summary: Get booking details by ID
 *     tags: [Bookings]
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
 *         description: Booking details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseBookingSuccess'
 *       404:
 *         description: Booking not found
 */

/**
 * @swagger
 * /bookings/{id}/check-in:
 *   patch:
 *     summary: Record arrival check-in for a session
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               lat:
 *                 type: number
 *               lng:
 *                 type: number
 *     responses:
 *       200:
 *         description: Check-in recorded successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseBookingSuccess'
 */

/**
 * @swagger
 * /bookings/{id}/confirm-completion:
 *   patch:
 *     summary: Confirm completion of session (Mutual confirmation required)
 *     tags: [Bookings]
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
 *         description: Completion confirmation recorded successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseBookingSuccess'
 */

/**
 * @swagger
 * /bookings/{id}/dispute:
 *   post:
 *     summary: File a dispute for a session
 *     tags: [Bookings]
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
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *                 minLength: 5
 *               type:
 *                 type: string
 *                 example: "no_show"
 *     responses:
 *       200:
 *         description: Dispute filed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseBookingSuccess'
 *       409:
 *         description: Booking is already disputed
 */

/**
 * @swagger
 * /bookings/{id}/cancel:
 *   patch:
 *     summary: Cancel a booking
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Booking cancelled successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseBookingSuccess'
 */
