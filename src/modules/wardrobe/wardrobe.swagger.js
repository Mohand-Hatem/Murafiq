/**
 * @swagger
 * tags:
 *   name: Wardrobe
 *   description: Client digital closet management and AI-powered photo classification
 */

/**
 * @swagger
 * /wardrobe:
 *   post:
 *     summary: Upload a clothing item to the client's digital wardrobe
 *     description: Creates a wardrobe item in 'pending' status and enqueues an asynchronous Gemini Flash vision classification and Upstash vector indexing job.
 *     tags: [Wardrobe]
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
 *               - uploadRef
 *             properties:
 *               uploadRef:
 *                 type: string
 *                 example: murafiq/wardrobe/507f1f77bcf86cd799439011/my-shirt-uuid
 *                 description: Internal namespaced Cloudinary public ID obtained via POST /api/v1/uploads/wardrobe
 *     responses:
 *       201:
 *         description: Wardrobe item created and classification job queued
 *       400:
 *         description: Invalid input format
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (client role required)
 */

/**
 * @swagger
 * /wardrobe/from-chat:
 *   post:
 *     summary: Save an uploaded garment from AI chat into the client's wardrobe
 *     description: Promotes a temporary ai-chat garment image to the permanent wardrobe namespace, reuses classification attributes without extra vision calls, indexes into vector DB, and marks the chat message as saved.
 *     tags: [Wardrobe]
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
 *               - messageId
 *             properties:
 *               messageId:
 *                 type: string
 *                 example: 650000000000000000000001
 *                 description: ID of the AiMessage containing the garment image to save
 *     responses:
 *       201:
 *         description: Wardrobe item created from chat message
 *       400:
 *         description: Invalid input or message has no analyzed garment
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (client role required)
 *       404:
 *         description: Message not found
 *       429:
 *         description: Wardrobe storage limit exceeded
 */

/**
 * @swagger
 * /wardrobe/mine:
 *   get:
 *     summary: List the authenticated client's wardrobe items
 *     description: Retrieves a paginated list of wardrobe items with optional filters by category, formality, season, and keyword search.
 *     tags: [Wardrobe]
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
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [top, bottom, shoes, outerwear, accessory, dress]
 *       - in: query
 *         name: formality
 *         schema:
 *           type: string
 *           enum: [casual, smart_casual, business, formal, loungewear, sportswear]
 *           example: casual
 *       - in: query
 *         name: genderPresentation
 *         schema:
 *           type: string
 *           enum: [masculine, feminine, unisex]
 *           example: unisex
 *       - in: query
 *         name: subcategory
 *         schema:
 *           type: string
 *           example: t-shirt
 *       - in: query
 *         name: isArchived
 *         schema:
 *           type: string
 *           enum: [true, false, all]
 *           default: false
 *           description: Filter archived items (default excludes archived items)
 *       - in: query
 *         name: season
 *         schema:
 *           type: string
 *           example: summer
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *           example: white sneakers
 *     responses:
 *       200:
 *         description: List of wardrobe items
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */

/**
 * @swagger
 * /wardrobe/{id}:
 *   get:
 *     summary: Get details of a single wardrobe item
 *     description: Retrieves detailed attributes of a clothing item owned by the authenticated client.
 *     tags: [Wardrobe]
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
 *         description: Wardrobe item details
 *       404:
 *         description: Item not found
 */

/**
 * @swagger
 * /wardrobe/{id}:
 *   patch:
 *     summary: Update/override clothing item attributes
 *     description: Allows the client to manually correct AI-classified attributes (category, color, pattern, material, style tags). Re-indexes vector embeddings.
 *     tags: [Wardrobe]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
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
 *             properties:
 *               category:
 *                 type: string
 *                 enum: [top, bottom, shoes, outerwear, accessory, dress]
 *               subcategory:
 *                 type: string
 *                 example: oxford-shirt
 *               primaryColor:
 *                 type: string
 *               secondaryColors:
 *                 type: array
 *                 items:
 *                   type: string
 *               pattern:
 *                 type: string
 *                 enum: [solid, striped, plaid, floral, graphic, checkered, polka_dot, animal_print, other]
 *               formality:
 *                 type: string
 *                 enum: [casual, smart_casual, business, formal, loungewear, sportswear]
 *               season:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [spring, summer, fall, winter, all_season]
 *               material:
 *                 type: string
 *                 enum: [cotton, denim, leather, wool, silk, linen, synthetic, knitwear, other]
 *               fit:
 *                 type: string
 *                 enum: [slim, regular, relaxed, oversized]
 *               colorFamily:
 *                 type: string
 *                 enum: [black, white, grey, navy, blue, brown, beige, green, red, pink, purple, yellow, orange, metallic, multicolor]
 *               genderPresentation:
 *                 type: string
 *                 enum: [masculine, feminine, unisex]
 *               isArchived:
 *                 type: boolean
 *               lastWornAt:
 *                 type: string
 *                 format: date-time
 *               wearCount:
 *                 type: integer
 *               styleTags:
 *                 type: array
 *                 items:
 *                   type: string
 *               aiDescription:
 *                 type: string
 *     responses:
 *       200:
 *         description: Item successfully updated
 *       404:
 *         description: Item not found
 */

/**
 * @swagger
 * /wardrobe/{id}:
 *   delete:
 *     summary: Delete a clothing item from the digital wardrobe
 *     description: Hard-deletes the wardrobe item from MongoDB and removes its vector embedding from the Upstash Vector namespace.
 *     tags: [Wardrobe]
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
 *         description: Item and vector embedding deleted successfully
 *       404:
 *         description: Item not found
 */
