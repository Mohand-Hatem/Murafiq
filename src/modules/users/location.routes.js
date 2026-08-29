import express from 'express';
import locationController from './location.controller.js';

const router = express.Router();

// Public routes for location directory
router.get('/governorates', locationController.getGovernorates);
router.get('/governorates/:governorate/cities', locationController.getCitiesByGovernorate);

export default router;
