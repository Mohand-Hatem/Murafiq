/**
 * @swagger
 * components:
 *   schemas:
 *     UserProfile:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         name:
 *           type: string
 *         email:
 *           type: string
 *         phone:
 *           type: string
 *           nullable: true
 *         role:
 *           type: string
 *           enum: [client, stylist, admin, operator]
 *         profileImage:
 *           type: string
 *         isEmailVerified:
 *           type: boolean
 *         accountStatus:
 *           type: string
 *           enum: [active, suspended, deleted]
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
 *         verification:
 *           type: object
 *           properties:
 *             status:
 *               type: string
 *               enum: [unverified, pending, verified, rejected]
 *             documents:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   type:
 *                     type: string
 *                     enum: [national_id_front, national_id_back, selfie_with_id, police_clearance_certificate]
 *                   url:
 *                     type: string
 *                   uploadedAt:
 *                     type: string
 *                     format: date-time
 *             rejectionReason:
 *               type: string
 *               nullable: true
 *             reviewedBy:
 *               type: string
 *               nullable: true
 *             reviewedAt:
 *               type: string
 *               format: date-time
 *               nullable: true
 *         isOnline:
 *           type: boolean
 *         clientRating:
 *           type: number
 *         clientTotalReviews:
 *           type: integer
 *         completedBookings:
 *           type: integer
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     ApiResponseUserProfileSuccess:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: Profile retrieved successfully.
 *         data:
 *           $ref: '#/components/schemas/UserProfile'
 */

/**
 * @swagger
 * /users/me:
 *   get:
 *     summary: Get current authenticated user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseUserProfileSuccess'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *   patch:
 *     summary: Update profile details or location
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               phone:
 *                 type: string
 *               bio:
 *                 type: string
 *               lat:
 *                 type: number
 *               lng:
 *                 type: number
 *               country:
 *                 type: string
 *               governorate:
 *                 type: string
 *               city:
 *                 type: string
 *               area:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseUserProfileSuccess'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *   delete:
 *     summary: Soft delete current user account
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Account soft-deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiMessageOnlySuccess'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */

/**
 * @swagger
 * /users/me/verification-documents:
 *   patch:
 *     summary: Upload identity verification documents
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [documents]
 *             properties:
 *               documents:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [type, url]
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [national_id_front, national_id_back, selfie_with_id, police_clearance_certificate]
 *                     url:
 *                       type: string
 *                       format: uri
 *     responses:
 *       200:
 *         description: Documents uploaded, status set to pending
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseUserProfileSuccess'
 *       400:
 *         description: Validation error or incomplete document set
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */

/**
 * @swagger
 * /users/me/profile-image:
 *   patch:
 *     summary: Update or remove profile image
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               profileImage:
 *                 type: string
 *                 nullable: true
 *                 description: Pass URL to update, or null/empty to reset to default avatar
 *     responses:
 *       200:
 *         description: Profile image updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseUserProfileSuccess'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
