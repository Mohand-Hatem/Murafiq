import ApiResponse from './response/ApiResponse.js';
import ApiError from './utils/ApiError.js';
import asyncHandler from 'express-async-handler';

// Make core response formatting, exception handling, and async wrapper available everywhere without repetitive imports
globalThis.ApiResponse = ApiResponse;
globalThis.ApiError = ApiError;
globalThis.asyncHandler = asyncHandler;

export { ApiResponse, ApiError, asyncHandler };
