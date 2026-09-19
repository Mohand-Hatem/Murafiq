/**
 * @swagger
 * tags:
 *   name: Virtual Try-On
 *   description: AI-powered visual try-on for client shape models and wardrobe garments
 */

/**
 * @swagger
 * /ai/try-on:
 *   post:
 *     summary: Request Virtual Try-On generation
 *     description: Submits a try-on generation request using an active Shape Model and 1 to 4 garments (from wardrobe or uploaded images). Performs 24-hour deterministic deduplication and pre-bills monthly/lifetime quota.
 *     tags: [Virtual Try-On]
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
 *               - shapeModelId
 *             properties:
 *               shapeModelId:
 *                 type: string
 *                 example: 66e5f32b842345001a123456
 *                 description: ObjectId of client's active Shape Model
 *               outfitId:
 *                 type: string
 *                 example: 66e5f32b842345001a123458
 *                 description: ObjectId of a saved or AI-generated outfit to try on in full (resolves its wardrobe items automatically)
 *               itemId:
 *                 type: string
 *                 example: 66e5f32b842345001a123457
 *                 description: ObjectId of a single wardrobe item to try on
 *               garments:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 4
 *                 description: Optional explicit list of 1 to 4 garments (when not providing outfitId or itemId)
 *                 items:
 *                   type: object
 *                   required:
 *                     - source
 *                   properties:
 *                     source:
 *                       type: string
 *                       enum: [wardrobe, upload]
 *                     itemId:
 *                       type: string
 *                       example: 66e5f32b842345001a123457
 *                       description: Required when source is wardrobe
 *                     imageRef:
 *                       type: string
 *                       example: murafiq/ai-chat/507f1f77bcf86cd799439011/item-123
 *                       description: Required when source is upload
 *                     slot:
 *                       type: string
 *                       enum: [top, bottom, outerwear, shoes, dress, accessory]
 *                     label:
 *                       type: string
 *                       example: Navy Blazer
 *               resolution:
 *                 type: string
 *                 enum: [512x512, 1024x1024]
 *                 default: 1024x1024
 *               promptVersion:
 *                 type: string
 *                 default: v1
 *     responses:
 *       202:
 *         description: Try-on request accepted for background processing
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
 *                   example: Try-on request accepted for processing
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     shapeModelId:
 *                       type: string
 *                       example: 66e5f32b842345001a123456
 *                     outfitId:
 *                       type: string
 *                       nullable: true
 *                       example: 66e5f32b842345001a123458
 *                     status:
 *                       type: string
 *                       example: pending
 *                     resolution:
 *                       type: string
 *                       example: 1024x1024
 *       200:
 *         description: Completed try-on returned from 24-hour deduplication cache
 *       400:
 *         description: Invalid input, conflicting garment slots, or mismatched imageRef
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - clients only
 *       404:
 *         description: Not Found - feature disabled or shape model not found
 *       429:
 *         description: Quota exceeded for ai.tryOn.monthly and ai.tryOn.trial.lifetime
 *
 *   get:
 *     summary: List user's Try-On generations
 *     description: Retrieves paginated history of virtual try-on generations for the authenticated client.
 *     tags: [Virtual Try-On]
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
 *           default: 20
 *     responses:
 *       200:
 *         description: Try-on history retrieved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - clients only
 *       404:
 *         description: Not Found - feature disabled
 */

/**
 * @swagger
 * /ai/try-on/{id}:
 *   get:
 *     summary: Get Try-On generation details and result
 *     description: Retrieves status and result for a specific generation. If completed, returns a time-limited 1-hour signed URL for the generated image.
 *     tags: [Virtual Try-On]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Try-On generation ID
 *     responses:
 *       200:
 *         description: Generation retrieved
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
 *                     id:
 *                       type: string
 *                     shapeModelId:
 *                       type: string
 *                       example: 66e5f32b842345001a123456
 *                     outfitId:
 *                       type: string
 *                       nullable: true
 *                       example: 66e5f32b842345001a123458
 *                     status:
 *                       type: string
 *                       enum: [pending, processing, completed, failed]
 *                     result:
 *                       type: object
 *                       nullable: true
 *                       properties:
 *                         signedUrl:
 *                           type: string
 *                           description: 1-hour signed URL to download result image
 *                         completedAt:
 *                           type: string
 *                           format: date-time
 *                     error:
 *                       type: object
 *                       nullable: true
 *                       properties:
 *                         message:
 *                           type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - you do not own this generation
 *       404:
 *         description: Not Found - generation does not exist or feature disabled
 *
 *   delete:
 *     summary: Delete Try-On generation
 *     description: Deletes the generation record and purges the Cloudinary output asset.
 *     tags: [Virtual Try-On]
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
 *         description: Try-on generation deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - you do not own this generation
 *       404:
 *         description: Not Found - generation does not exist or feature disabled
 */
