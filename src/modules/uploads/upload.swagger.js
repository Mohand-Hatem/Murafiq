/**
 * @swagger
 * tags:
 *   name: Uploads
 *   description: File and image uploading to Cloudinary
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     UploadResponseData:
 *       type: object
 *       properties:
 *         url:
 *           type: string
 *           example: "https://res.cloudinary.com/murafiq/image/upload/v1724589000/murafiq/avatars/user123.webp"
 *         publicId:
 *           type: string
 *           example: "murafiq/avatars/user123"
 *         format:
 *           type: string
 *           example: "webp"
 *         width:
 *           type: integer
 *           example: 800
 *         height:
 *           type: integer
 *           example: 800
 *         bytes:
 *           type: integer
 *           example: 124500
 *     ApiResponseUploadSuccess:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "File uploaded successfully"
 *         data:
 *           $ref: '#/components/schemas/UploadResponseData'
 */

/**
 * @swagger
 * /uploads/{folder}:
 *   post:
 *     summary: Upload an image file to Cloudinary
 *     description: Uploads and optimizes an image file. Images are automatically compressed (1920x1920 max) and stored in Cloudinary under the specified folder.
 *     tags: [Uploads]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: folder
 *         required: true
 *         schema:
 *           type: string
 *           enum: [avatars, kyc-documents, portfolio, request-images, wardrobe]
 *         description: Destination upload folder category
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Image file (JPEG, PNG, WebP max 10MB)
 *     responses:
 *       200:
 *         description: File uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponseUploadSuccess'
 *       400:
 *         description: Invalid folder or missing file
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
