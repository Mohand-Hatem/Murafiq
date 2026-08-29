import { EGYPT_GOVERNORATES } from '../../common/constants/locations.constant.js';
import { normalizeGovernorate } from '../../common/utils/geo.util.js';
import ApiError from '../../common/utils/ApiError.js';

export const getGovernorates = asyncHandler(async (req, res) => {
  const data = EGYPT_GOVERNORATES.map((gov) => ({
    code: gov.code,
    nameEn: gov.nameEn,
    nameAr: gov.nameAr,
    coordinates: gov.coordinates,
    cityCount: gov.cities.length,
    cities: gov.cities,
  }));

  return ApiResponse.success(res, {
    statusCode: 200,
    message: 'Egyptian governorates retrieved successfully',
    data,
  });
});

export const getCitiesByGovernorate = asyncHandler(async (req, res) => {
  const { governorate } = req.params;
  const match = normalizeGovernorate(governorate);

  if (!match) {
    throw new ApiError(404, `Governorate '${governorate}' not found in Egyptian administrative hierarchy`);
  }

  return ApiResponse.success(res, {
    statusCode: 200,
    message: `Cities for governorate '${match.nameEn}' retrieved successfully`,
    data: {
      governorate: {
        code: match.code,
        nameEn: match.nameEn,
        nameAr: match.nameAr,
        coordinates: match.coordinates,
      },
      cities: match.cities,
    },
  });
});

export default {
  getGovernorates,
  getCitiesByGovernorate,
};
