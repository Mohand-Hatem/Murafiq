import { jest } from '@jest/globals';
import request from 'supertest';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';

const mockStylistUser = {
  _id: '60f719b8f1a2c81234567890',
  role: 'stylist',
};

const mockClientUser = {
  _id: '60f719b8f1a2c81234567891',
  role: 'client',
};

const mockFeedItems = [
  {
    _id: '80f719b8f1a2c81234567890',
    title: 'New Cairo Styling Request',
    visibility: 'broadcast',
    status: 'OPEN',
    clientId: { _id: mockClientUser._id, name: 'Client 1' },
    meetingLocation: { city: 'New Cairo', governorate: 'Cairo' },
    toObject: function () {
      return this;
    },
  },
];

jest.unstable_mockModule('../../src/modules/requests/request-feed.service.js', () => ({
  default: {
    getBroadcastFeed: jest.fn().mockResolvedValue({
      items: mockFeedItems,
      meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
    }),
  },
}));

const { default: app } = await import('../../src/app.js');

describe('GET /api/v1/requests/feed', () => {
  const stylistToken = generateAccessToken({ sub: mockStylistUser._id, role: 'stylist' });
  const clientToken = generateAccessToken({ sub: mockClientUser._id, role: 'client' });

  it('should allow stylist to retrieve broadcast feed', async () => {
    const res = await request(app)
      .get('/api/v1/requests/feed?city=New%20Cairo')
      .set('Authorization', `Bearer ${stylistToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  it('should forbid client from accessing stylist feed (403)', async () => {
    const res = await request(app)
      .get('/api/v1/requests/feed')
      .set('Authorization', `Bearer ${clientToken}`);

    expect(res.status).toBe(403);
  });
});
