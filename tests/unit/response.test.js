import '../../src/common/globals.js';

describe('ApiResponse Unit Tests', () => {
  let mockRes;

  beforeEach(() => {
    mockRes = {
      statusCode: 200,
      responseData: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.responseData = data;
        return this;
      },
    };
  });

  it('should return 200 with standardized success JSON structure', () => {
    const data = { id: 1, name: 'Test' };
    const meta = { page: 1, limit: 10 };

    ApiResponse.success(mockRes, { statusCode: 200, message: 'Fetched successfully', data, meta });

    expect(mockRes.statusCode).toBe(200);
    expect(mockRes.responseData).toEqual({
      success: true,
      message: 'Fetched successfully',
      data,
      meta,
    });
  });

  it('should default statusCode to 200 and data/meta to null', () => {
    ApiResponse.success(mockRes, { message: 'Default Success' });

    expect(mockRes.statusCode).toBe(200);
    expect(mockRes.responseData).toEqual({
      success: true,
      message: 'Default Success',
      data: null,
      meta: null,
    });
  });
});
