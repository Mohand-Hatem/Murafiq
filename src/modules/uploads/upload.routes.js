import express from 'express';
import uploadController from './upload.controller.js';
import uploadSingle from './multer.middleware.js';
import authMiddleware from '../../common/middlewares/auth.middleware.js';

const router = express.Router();

router.post('/:folder', authMiddleware, uploadSingle, uploadController.uploadFile);

export default router;
