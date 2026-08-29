/**
 * @swagger
 * tags:
 *   name: Auth — Sessions
 *   description: Multi-device session management. Each signed-in device holds its own
 *     refresh session; logging out on one device does not affect the others.
 */

/**
 * @swagger
 * /auth/sessions:
 *   get:
 *     summary: List the caller's active devices
 *     description: |
 *       Returns one entry per signed-in device. Refresh-token hashes are never included.
 *     tags: [Auth — Sessions]
 *     responses:
 *       200:
 *         description: Active sessions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, example: '6a91e431ce6c0f18d8d8cec7' }
 *                       deviceLabel: { type: string, example: 'Mobile — iPhone 15' }
 *                       createdAt: { type: string, format: date-time }
 *                       lastUsedAt: { type: string, format: date-time }
 *                       expiresAt: { type: string, format: date-time }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /auth/logout-all:
 *   post:
 *     summary: Sign out of every device
 *     description: |
 *       Clears all refresh sessions **and** increments `tokenVersion`, so outstanding
 *       access tokens are rejected immediately rather than remaining valid until they
 *       expire.
 *
 *       Contrast with `POST /auth/logout`, which ends only the calling device's session
 *       and deliberately leaves `tokenVersion` untouched so other devices stay signed in.
 *     tags: [Auth — Sessions]
 *     responses:
 *       200:
 *         description: All sessions revoked
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
