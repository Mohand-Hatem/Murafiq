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
 *     description: >
 *       Reserves the stylist's slot as a booking in `pending_payment` and returns the Paymob
 *       checkout link in `data.paymentUrl` (null if the provider was unreachable — retry with
 *       POST /payments/{bookingId}/initialize). The booking becomes `confirmed` when payment
 *       succeeds; if it is unpaid at `data.paymentExpiresAt` (30 minutes, never later than the
 *       session start) the slot is released and the request and rival offers reopen.
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
 *         description: Offer accepted - slot reserved, awaiting payment
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   description: The new booking plus the checkout link
 *                   properties:
 *                     _id:
 *                       type: string
 *                       description: Booking ID (use it for /payments/{bookingId}/initialize)
 *                     status:
 *                       type: string
 *                       enum: [pending_payment, confirmed]
 *                       description: pending_payment for online bookings; confirmed only for demo (cash) bookings
 *                     paymentExpiresAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                       description: Payment deadline (30 minutes, never later than the session start); unpaid bookings are released after it
 *                     paymentUrl:
 *                       type: string
 *                       nullable: true
 *                       description: Paymob checkout link; null for demo bookings or if the provider was unreachable
 *                     requestId:
 *                       type: string
 *                     offerId:
 *                       type: string
 *                     clientId:
 *                       type: string
 *                     stylistId:
 *                       type: string
 *                     scheduledDate:
 *                       type: string
 *                       format: date-time
 *                     price:
 *                       type: number
 *                     duration:
 *                       type: integer
 *                     bookingMode:
 *                       type: string
 *                       enum: [standard, demo]
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


/**
 * @swagger
 * /offers/requests/{id}/competing:
 *   get:
 *     summary: See the other stylists' offers on a broadcast request (Stylist only, no prices)
 *     description: >
 *       Returns every PENDING offer on an OPEN broadcast request: the message, the stylist's name,
 *       photo and rating, and an `isMine` flag. Price and duration are never returned, and digits
 *       in messages are masked (`•••`) so a price typed into the text cannot leak. The request
 *       feed exposes the total as `offerCount`.
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
 *         description: Competing offers retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       message:
 *                         type: string
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       isMine:
 *                         type: boolean
 *                       stylist:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           name:
 *                             type: string
 *                           profileImage:
 *                             type: string
 *                           rating:
 *                             type: number
 *                           totalReviews:
 *                             type: integer
 *       400:
 *         description: Request is direct (nothing to compare) or no longer open
 *       403:
 *         description: Caller is not a verified stylist
 *       404:
 *         description: Request not found
 */

/**
 * @swagger
 * /offers/mine:
 *   get:
 *     summary: List my own offers (Stylist only)
 *     description: >
 *       The stylist's own offers, newest first, with their own price and a summary of the request
 *       (title, date, status, `offerCount`). Requests a stylist has already bid on disappear from
 *       the feed, so this is where they follow up.
 *     tags: [Offers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, ACCEPTED, REJECTED, WITHDRAWN, CLOSED, EXPIRED]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Offers retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       requestId:
 *                         type: string
 *                       price:
 *                         type: number
 *                       duration:
 *                         type: integer
 *                       message:
 *                         type: string
 *                       status:
 *                         type: string
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       request:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           title:
 *                             type: string
 *                           date:
 *                             type: string
 *                             format: date-time
 *                           time:
 *                             type: string
 *                           status:
 *                             type: string
 *                           visibility:
 *                             type: string
 *                           offerCount:
 *                             type: integer
 *                 meta:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *       403:
 *         description: Caller is not a stylist
 */
