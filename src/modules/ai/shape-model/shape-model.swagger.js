/**
 * @swagger
 * tags:
 *   name: Shape Model
 *   description: Client full-body biometric reference photo management for Virtual Try-On
 */

/**
 * @swagger
 * /ai/shape-model:
 *   post:
 *     summary: Create or replace active Shape Model
 *     description: Registers a new active full-body reference image for the authenticated client. Replaces any existing active model and destroys the previous Cloudinary asset.
 *     tags: [Shape Model]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - imageRef
 *               - consent
 *             properties:
 *               imageRef:
 *                 type: string
 *                 example: murafiq/shape-models/507f1f77bcf86cd799439011/photo-uuid-123
 *                 description: Authenticated Cloudinary publicId path scoped to user
 *               consent:
 *                 type: boolean
 *                 example: true
 *                 description: Explicit consent to store and process full-body image
 *               format:
 *                 type: string
 *                 example: jpg
 *               bytes:
 *                 type: number
 *                 example: 1048576
 *               width:
 *                 type: number
 *                 example: 1080
 *               height:
 *                 type: number
 *                 example: 1920
 *     responses:
 *       201:
 *         description: Shape model created successfully
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
 *                   example: Shape model created successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     status:
 *                       type: string
 *                       example: active
 *                     signedUrl:
 *                       type: string
 *                       description: Time-limited 1-hour signed URL to access image
 *                     consentAt:
 *                       type: string
 *                       format: date-time
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Invalid imageRef namespace or missing explicit consent
 *       401:
 *         description: Unauthorized - authentication required
 *       403:
 *         description: Forbidden - only clients may manage shape models
 *       404:
 *         description: Not Found - returned when Virtual Try-On is disabled (AI_TRY_ON_ENABLED=false)
 *
 *   get:
 *     summary: Retrieve active Shape Model
 *     description: Returns the authenticated client's currently active Shape Model with a fresh 1-hour signed URL.
 *     tags: [Shape Model]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Active shape model retrieved (or null if none)
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
 *                   nullable: true
 *                   properties:
 *                     id:
 *                       type: string
 *                     status:
 *                       type: string
 *                       example: active
 *                     signedUrl:
 *                       type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - clients only
 *       404:
 *         description: Not Found - returned when Virtual Try-On is disabled
 *
 *   delete:
 *     summary: Delete active Shape Model
 *     description: Soft-deletes the client's active Shape Model and destroys the private Cloudinary asset.
 *     tags: [Shape Model]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Shape model deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - clients only
 *       404:
 *         description: Not Found - no active shape model found or feature disabled
 */
