/**
 * @swagger
 * tags:
 *   name: Chat
 *   description: Real-time messaging and Firebase Auth token minting
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Message:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "msg_12345abc"
 *         senderId:
 *           type: string
 *           example: "60f719b8f1a2c81234567890"
 *         type:
 *           type: string
 *           enum: [text, image]
 *           example: "text"
 *         content:
 *           type: string
 *           example: "Hello! Where should we meet for the styling session?"
 *         deliveredAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         seenAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *     Conversation:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "60f719b8f1a2c81234567891"
 *         bookingId:
 *           type: string
 *           example: "60f719b8f1a2c81234567891"
 *         participants:
 *           type: array
 *           items:
 *             type: string
 *           example: ["60f719b8f1a2c81234567890", "60f719b8f1a2c81234567892"]
 *         isOpen:
 *           type: boolean
 *           example: true
 *         isLocked:
 *           type: boolean
 *           example: false
 *         lastMessageAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *     ChatTokenResponse:
 *       type: object
 *       properties:
 *         token:
 *           type: string
 *           example: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
 */

/**
 * @swagger
 * /chat/token:
 *   post:
 *     summary: Generate custom Firebase auth token for the authenticated user
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Firebase custom token generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/ChatTokenResponse'
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthenticated
 */

/**
 * @swagger
 * /chat/{conversationId}/messages:
 *   get:
 *     summary: Get paginated message history for a conversation
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: The booking ID corresponding to the conversation room
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Number of messages to retrieve (1-100)
 *       - in: query
 *         name: startAfter
 *         schema:
 *           type: string
 *         description: Message ID cursor for forward pagination
 *     responses:
 *       200:
 *         description: Messages retrieved successfully
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
 *                     conversation:
 *                       $ref: '#/components/schemas/Conversation'
 *                     items:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Message'
 *                     nextCursor:
 *                       type: string
 *                       nullable: true
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Forbidden (Caller is not a participant in this conversation)
 *       404:
 *         description: Conversation not found
 *   post:
 *     summary: Send a message via REST fallback or post image message URL
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: The booking ID corresponding to the conversation room
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *                 example: "I am near the mall entrance now."
 *               type:
 *                 type: string
 *                 enum: [text, image]
 *                 default: text
 *     responses:
 *       201:
 *         description: Message sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Message'
 *       400:
 *         description: Chat is not open yet (unpaid) or is locked (completed/cancelled)
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Caller is not a participant in this conversation
 *       404:
 *         description: Conversation not found
 */
