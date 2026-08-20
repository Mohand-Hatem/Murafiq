/**
 * @swagger
 * components:
 *   schemas:
 *     PublicStylistProfile:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         userId:
 *           type: string
 *         name:
 *           type: string
 *         profileImage:
 *           type: string
 *           nullable: true
 *         specialty:
 *           type: string
 *           enum: [stylist, personal_shopper]
 *         bio:
 *           type: string
 *         serviceDescription:
 *           type: string
 *         experienceYears:
 *           type: integer
 *         languages:
 *           type: array
 *           items:
 *             type: string
 *         services:
 *           type: array
 *           items:
 *             type: string
 *         hourlyPrice:
 *           type: number
 *           description: Hourly rate in EGP (minimum 100 EGP)
 *         portfolio:
 *           type: array
 *           items:
 *             type: string
 *         workingAreas:
 *           type: array
 *           items:
 *             type: string
 *         weeklyAvailability:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               day:
 *                 type: string
 *                 enum: [sat, sun, mon, tue, wed, thu, fri]
 *               startTime:
 *                 type: string
 *                 example: "10:00"
 *               endTime:
 *                 type: string
 *                 example: "18:00"
 *         rating:
 *           type: number
 *         totalReviews:
 *           type: integer
 *         completedSessions:
 *           type: integer
 *         gender:
 *           type: string
 *           enum: [male, female]
 *           nullable: true
 *         country:
 *           type: string
 *           nullable: true
 *         governorate:
 *           type: string
 *           nullable: true
 *         city:
 *           type: string
 *           nullable: true
 *         area:
 *           type: string
 *           nullable: true
 *         location:
 *           type: object
 *           properties:
 *             type:
 *               type: string
 *               example: Point
 *             coordinates:
 *               type: array
 *               items:
 *                 type: number
 *               example: [31.2357, 30.0444]
 *         locationSet:
 *           type: boolean
 *         distanceKm:
 *           type: number
 *           description: Distance in kilometers when geo search is active
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     ApiResponsePublicStylistSuccess:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *         data:
 *           $ref: '#/components/schemas/PublicStylistProfile'
 *     ApiResponseStylistsListSuccess:
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
 *             $ref: '#/components/schemas/PublicStylistProfile'
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
 * /stylists:
 *   get:
 *     summary: Search and list stylists (Public multi-filter & geo-nearby)
 *     tags: [Stylists]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search keyword across English/Arabic names, bio, and service description
 *       - in: query
 *         name: specialty
 *         schema:
 *           type: string
 *           enum: [stylist, personal_shopper]
 *       - in: query
 *         name: gender
 *         schema:
 *           type: string
 *           enum: [male, female]
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: number
 *         description: Minimum hourly price in EGP (values < 100 return same set as minPrice=100)
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: number
 *       - in: query
 *         name: minRating
 *         schema:
 *           type: number
 *       - in: query
 *         name: minExperience
 *         schema:
 *           type: integer
 *       - in: query
 *         name: services
 *         schema:
 *           type: string
 *         description: Comma-separated list of services
 *       - in: query
 *         name: country
 *         schema:
 *           type: string
 *       - in: query
 *         name: governorate
 *         schema:
 *           type: string
 *       - in: query
 *         name: city
 *         schema:
 *           type: string
 *       - in: query
 *         name: area
 *         schema:
 *           type: string
 *       - in: query
 *         name: availableOn
 *         schema:
 *           type: string
 *           enum: [sat, sun, mon, tue, wed, thu, fri]
 *       - in: query
 *         name: availableFrom
 *         schema:
 *           type: string
 *           example: "10:00"
 *       - in: query
 *         name: availableTo
 *         schema:
 *           type: string
 *           example: "14:00"
 *       - in: query
 *         name: lat
 *         schema:
 *           type: number
 *         description: Latitude for geo-nearby search
 *       - in: query
 *         name: lng
 *         schema:
 *           type: number
 *         description: Longitude for geo-nearby search
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
 *         description: e.g. distance, hourlyPrice:asc, rating:desc
 *     responses:
 *       200:
 *         description: List of matching verified stylists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseStylistsListSuccess'
 */

/**
 * @swagger
 * /stylists/{id}:
 *   get:
 *     summary: Get public stylist profile by ID
 *     tags: [Stylists]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Public stylist profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponsePublicStylistSuccess'
 *       404:
 *         description: Stylist profile not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */

/**
 * @swagger
 * /stylists/{id}/reviews:
 *   get:
 *     summary: Get public reviews for a stylist
 *     tags: [Stylists]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Public reviews list
 */

/**
 * @swagger
 * /stylists/profile:
 *   post:
 *     summary: Create stylist business profile (Stylist role only)
 *     tags: [Stylists]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [specialty, hourlyPrice]
 *             properties:
 *               specialty:
 *                 type: string
 *                 enum: [stylist, personal_shopper]
 *               hourlyPrice:
 *                 type: number
 *                 minimum: 100
 *                 description: Minimum hourly rate is 100 EGP
 *               bio:
 *                 type: string
 *               serviceDescription:
 *                 type: string
 *               experienceYears:
 *                 type: integer
 *               languages:
 *                 type: array
 *                 items:
 *                   type: string
 *               services:
 *                 type: array
 *                 items:
 *                   type: string
 *               portfolio:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uri
 *               workingAreas:
 *                 type: array
 *                 items:
 *                   type: string
 *               gender:
 *                 type: string
 *                 enum: [male, female]
 *     responses:
 *       201:
 *         description: Stylist profile created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponsePublicStylistSuccess'
 *       400:
 *         description: Validation error or hourly rate < 100 EGP
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: Forbidden (client role)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: Stylist profile already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *   patch:
 *     summary: Update own stylist business profile (Stylist role only)
 *     tags: [Stylists]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               specialty:
 *                 type: string
 *                 enum: [stylist, personal_shopper]
 *               hourlyPrice:
 *                 type: number
 *                 minimum: 100
 *               bio:
 *                 type: string
 *               serviceDescription:
 *                 type: string
 *               experienceYears:
 *                 type: integer
 *               languages:
 *                 type: array
 *                 items:
 *                   type: string
 *               services:
 *                 type: array
 *                 items:
 *                   type: string
 *               portfolio:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uri
 *               workingAreas:
 *                 type: array
 *                 items:
 *                   type: string
 *               gender:
 *                 type: string
 *                 enum: [male, female]
 *     responses:
 *       200:
 *         description: Stylist profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponsePublicStylistSuccess'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: Forbidden (client role)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */

/**
 * @swagger
 * /stylists/me/profile:
 *   get:
 *     summary: Get own stylist business profile (Stylist role only)
 *     tags: [Stylists]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Stylist profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponsePublicStylistSuccess'
 *       403:
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */

/**
 * @swagger
 * /stylists/me/payouts:
 *   get:
 *     summary: Get own payout history (Stylist role only)
 *     tags: [Stylists]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Payout history list
 */
