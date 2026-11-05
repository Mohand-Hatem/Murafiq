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
 *         scheduledStartAt:
 *           type: string
 *           format: date-time
 *           description: Scheduled start as a real instant (Cairo calendar day + startTime). Use this, not scheduledDate + startTime.
 *         scheduledEndAt:
 *           type: string
 *           format: date-time
 *         serverTime:
 *           type: string
 *           format: date-time
 *           description: Server's current time. Compare countdowns and overtime against this, not the device clock.
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
 *           enum: [pending_payment, confirmed, in-progress, completed, cancelled, disputed]
 *         bookingMode:
 *           type: string
 *           enum: [standard, demo]
 *           example: standard
 *         checkInAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: Legacy. First check-in by either party.
 *         checkInLocation:
 *           type: object
 *           nullable: true
 *           description: Legacy. Location of the most recent check-in by either party; use the per-party fields.
 *           properties:
 *             lat:
 *               type: number
 *             lng:
 *               type: number
 *         clientCheckInAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: Client's first check-in. Set while status is `confirmed` = client is waiting for the stylist.
 *         stylistCheckInAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: Stylist's first check-in. Set while status is `confirmed` = stylist is waiting for the client.
 *         clientCheckInLocation:
 *           type: object
 *           nullable: true
 *           properties:
 *             lat:
 *               type: number
 *             lng:
 *               type: number
 *         stylistCheckInLocation:
 *           type: object
 *           nullable: true
 *           properties:
 *             lat:
 *               type: number
 *             lng:
 *               type: number
 *         sessionStartedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: The second check-in, i.e. when the session started (null until both parties have checked in)
 *         sessionExpectedEndAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: sessionStartedAt + duration. Informational countdown target only; reaching it changes nothing server-side
 *         cashCollectedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         cashOtp:
 *           type: string
 *           example: "4829"
 *           description: 4-digit Cash OTP for demo bookings (visible only to stylist while in-progress)
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
 *         dispute:
 *           type: object
 *           nullable: true
 *           description: Set once the booking has been disputed. Evidence is on GET /bookings/{id}/dispute.
 *           properties:
 *             type:
 *               type: string
 *               example: payment_unverified
 *             reason:
 *               type: string
 *             raisedAt:
 *               type: string
 *               format: date-time
 *             raisedBy:
 *               type: string
 *               enum: [client, stylist, admin, system]
 *               description: "`system` = an automatic admin review (stale sweep), not a party's dispute"
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
 *           enum: [pending_payment, confirmed, in-progress, completed, cancelled, disputed]
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
 *           enum: [pending_payment, confirmed, in-progress, completed, cancelled, disputed]
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
 *     description: |
 *       Records the caller's own attendance (client or stylist). Open from 30 minutes before the
 *       scheduled start until the scheduled end. The first check-in leaves the booking `confirmed`
 *       (that party is waiting and the other is notified); the session becomes `in-progress` only
 *       when both parties have checked in, and both are notified. Repeating a check-in keeps the
 *       first timestamp and location. Once anyone has checked in the booking can no longer be
 *       cancelled; a missing party is handled by the no-show report.
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
 * /bookings/{id}/verify-cash-otp:
 *   post:
 *     summary: Verify 4-digit Cash OTP for a demo Cash-on-Delivery (COD) session
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: 24-character hexadecimal booking ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [otp]
 *             properties:
 *               otp:
 *                 type: string
 *                 example: "1234"
 *                 description: Exactly 4 digits revealed by the stylist upon cash handover
 *     responses:
 *       200:
 *         description: Cash payment verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseBookingSuccess'
 *       400:
 *         description: Invalid OTP, session not in-progress, or already verified
 *       403:
 *         description: Only the client can verify the Cash OTP
 *       404:
 *         description: Booking not found
 *       409:
 *         description: Booking is under admin review (disputed); payment must be submitted as dispute evidence instead
 *       423:
 *         description: Cash code locked after 10 attempts; open a dispute, or the payment goes to admin review after the session
 *       429:
 *         description: Cooling down for 15 minutes after every 5 attempts; the message gives the retry time
 */

/**
 * @swagger
 * /bookings/{id}/confirm-completion:
 *   patch:
 *     summary: Confirm completion of session (Mutual confirmation required)
 *     description: |
 *       Allowed any time while in-progress (early completion is fine; the countdown is informational).
 *       Demo bookings require a verified cash payment first. The booking completes on the second
 *       confirmation; after the first, the other party is notified to confirm or report a problem.
 *       A demo session still open at scheduled end + 24h is sent to admin review, never auto-completed.
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
 *                 description: Free-form category. `payment_unverified` and `completion_unconfirmed` are reserved for system reviews.
 *               evidence:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     text:
 *                       type: string
 *                     images:
 *                       type: array
 *                       items:
 *                         type: string
 *                         format: uri
 *     responses:
 *       200:
 *         description: Dispute filed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseBookingSuccess'
 *       400:
 *         description: Booking not disputable, or a reserved system dispute type was used
 *       409:
 *         description: Booking is already disputed
 */

/**
 * @swagger
 * /bookings/{id}/cancellation-quote:
 *   get:
 *     summary: Get cancellation fee, refund, and penalty quote
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
 *         description: Cancellation quote calculated successfully
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
 *                     bookingId:
 *                       type: string
 *                     cancelledByRole:
 *                       type: string
 *                       enum: [client, stylist]
 *                     hoursUntilSession:
 *                       type: number
 *                     isEarly:
 *                       type: boolean
 *                     refundPercentage:
 *                       type: number
 *                     refundAmount:
 *                       type: number
 *                     platformFeeAmount:
 *                       type: number
 *                     stylistCompensationAmount:
 *                       type: number
 *                     penaltyAmount:
 *                       type: number
 *                     couponEligible:
 *                       type: boolean
 *                     tier:
 *                       type: string
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
 *       400:
 *         description: Not cancellable — in progress, disputed, terminal, or either party has already checked in (use the no-show report instead)
 *       409:
 *         description: The booking changed (e.g. a check-in landed) between the read and the cancel
 */

