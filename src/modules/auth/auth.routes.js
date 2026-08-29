import express from 'express';
import * as authController from './auth.controller.js';
import validate from '../../common/middlewares/validate.middleware.js';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import { authRateLimiter, otpResendRateLimiter } from '../../common/middlewares/auth-rate-limiter.middleware.js';
import {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  googleAuthSchema,
} from './auth.validator.js';

const router = express.Router();

router.post('/register', authRateLimiter, validate(registerSchema), authController.register);
router.post('/login', authRateLimiter, validate(loginSchema), authController.login);
router.post('/google', authRateLimiter, validate(googleAuthSchema), authController.googleAuth);
router.post('/logout', authMiddleware, authController.logout);
router.post('/logout-all', authMiddleware, authController.logoutAll);
router.get('/sessions', authMiddleware, authController.listSessions);
router.post('/refresh-token', authController.refreshToken);
router.post('/verify-email', authRateLimiter, validate(verifyEmailSchema), authController.verifyEmail);
router.post('/resend-otp', otpResendRateLimiter, validate(resendOtpSchema), authController.resendOtp);
router.post('/forgot-password', authRateLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', authRateLimiter, validate(resetPasswordSchema), authController.resetPassword);
router.patch('/change-password', authMiddleware, validate(changePasswordSchema), authController.changePassword);

export default router;
