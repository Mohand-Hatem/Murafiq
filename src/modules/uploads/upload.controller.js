import uploadService from './upload.service.js';

export const uploadFile = asyncHandler(async (req, res) => {
  const result = await uploadService.uploadFile(req.user, req.params.folder, req.file);
  return ApiResponse.success(res, {
    message: 'File uploaded successfully',
    data: result,
  });
});

export default {
  uploadFile,
};
