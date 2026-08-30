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
 *               - imageUrl
 *             properties:
 *               imageUrl:
 *                 type: string
 *                 format: uri
 *                 example: https://res.cloudinary.com/murafiq/image/upload/v1/wardrobe/my-shirt.jpg
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
 *           example: casual
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
 *               primaryColor:
 *                 type: string
 *               secondaryColors:
 *                 type: array
 *                 items:
 *                   type: string
 *               pattern:
 *                 type: string
 *               formality:
 *                 type: string
 *               season:
 *                 type: array
 *                 items:
 *                   type: string
 *               material:
 *                 type: string
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
