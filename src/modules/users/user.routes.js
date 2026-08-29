import express from 'express';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import validate from '../../common/middlewares/validate.middleware.js';
import {
  updateProfileSchema,
  uploadVerificationDocsSchema,
  updateProfileImageSchema,
} from './user.validator.js';
import userController from './user.controller.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/me', userController.getMe);
router.patch('/me', validate(updateProfileSchema), userController.updateMe);
router.patch(
  '/me/verification-documents',
  validate(uploadVerificationDocsSchema),
  userController.uploadVerificationDocs
);
router.patch(
  '/me/profile-image',
  validate(updateProfileImageSchema),
  userController.updateProfileImage
);
router.delete('/me', userController.deleteMe);

// Public profile endpoint (client or stylist)
router.get('/:id', userController.getPublicProfile);

export default router;
