import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../src/app.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import { toPublicBookingDto } from '../../src/modules/bookings/booking.dto.js';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';

describe('Demo Foundation & Schema Integration Tests (Phase 1)', () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  describe('Routing Surface Isolation', () => {
    it('GET /api/demo/health returns 200 and healthy status', async () => {
      const res = await request(app).get('/api/demo/health');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Demo server is healthy');
      expect(res.body.data.status).toBe('healthy');
      expect(res.body.data.mongo).toBe('connected');
    });

    it('GET /api/v1/health continues to return 200 with zero regressions', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Server is healthy');
    });

    it('omits /payments from /api/demo (returns 404)', async () => {
      const res = await request(app).get('/api/demo/payments');
      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Route not found');
    });

    it('omits /payouts from /api/demo (returns 404)', async () => {
      const res = await request(app).get('/api/demo/payouts');
      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Route not found');
    });

    it('omits /coupons from /api/demo (returns 404)', async () => {
      const res = await request(app).get('/api/demo/coupons');
      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Route not found');
    });

    it('omits /admin from /api/demo (returns 404)', async () => {
      const res = await request(app).get('/api/demo/admin');
      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Route not found');
    });

    it('omits paid subscription commerce endpoints from /api/demo (returns 404)', async () => {
      const checkoutRes = await request(app).post('/api/demo/subscriptions/checkout').send({});
      expect(checkoutRes.statusCode).toBe(404);

      const subscribeRes = await request(app).post('/api/demo/subscriptions/subscribe').send({});
      expect(subscribeRes.statusCode).toBe(404);

      const cancelRes = await request(app).post('/api/demo/subscriptions/cancel').send({});
      expect(cancelRes.statusCode).toBe(404);

      const orderRes = await request(app).get('/api/demo/subscriptions/orders/order-123');
      expect(orderRes.statusCode).toBe(404);

      const webhookRes = await request(app).post('/api/demo/subscriptions/webhook').send({});
      expect(webhookRes.statusCode).toBe(404);
    });

    it('mounts read-only plans catalogue under /api/demo/subscriptions/plans', async () => {
      const res = await request(app).get('/api/demo/subscriptions/plans');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.plans)).toBe(true);
    });
  });

  describe('Booking Schema & bookingMode Behavior', () => {
    it('defaults bookingMode to "standard" when not provided', async () => {
      const booking = await Booking.create({
        requestId: new mongoose.Types.ObjectId(),
        offerId: new mongoose.Types.ObjectId(),
        clientId: new mongoose.Types.ObjectId(),
        stylistId: new mongoose.Types.ObjectId(),
        scheduledDate: new Date(),
        scheduledStartMinute: 600,
        scheduledEndMinute: 660,
        price: 350,
        duration: 60,
        status: 'confirmed',
      });

      expect(booking.bookingMode).toBe('standard');

      // Verify raw BSON stored in database also has 'standard'
      const raw = await mongoose.connection.collection('bookings').findOne({ _id: booking._id });
      expect(raw.bookingMode).toBe('standard');
    });

    it('accepts explicit bookingMode: "demo"', async () => {
      const booking = await Booking.create({
        requestId: new mongoose.Types.ObjectId(),
        offerId: new mongoose.Types.ObjectId(),
        clientId: new mongoose.Types.ObjectId(),
        stylistId: new mongoose.Types.ObjectId(),
        scheduledDate: new Date(),
        scheduledStartMinute: 720,
        scheduledEndMinute: 780,
        price: 400,
        duration: 60,
        status: 'confirmed',
        bookingMode: 'demo',
      });

      expect(booking.bookingMode).toBe('demo');

      const raw = await mongoose.connection.collection('bookings').findOne({ _id: booking._id });
      expect(raw.bookingMode).toBe('demo');
    });

    it('rejects invalid bookingMode values', async () => {
      await expect(
        Booking.create({
          requestId: new mongoose.Types.ObjectId(),
          offerId: new mongoose.Types.ObjectId(),
          clientId: new mongoose.Types.ObjectId(),
          stylistId: new mongoose.Types.ObjectId(),
          scheduledDate: new Date(),
          scheduledStartMinute: 600,
          scheduledEndMinute: 660,
          price: 350,
          duration: 60,
          status: 'confirmed',
          bookingMode: 'cod', // Invalid: cod is not an enum value
        })
      ).rejects.toThrow();
    });
  });

  describe('DTO Defensive Serialization', () => {
    it('maps missing bookingMode to "standard" defensively', () => {
      const mockHistoricalDoc = {
        _id: new mongoose.Types.ObjectId(),
        requestId: new mongoose.Types.ObjectId(),
        offerId: new mongoose.Types.ObjectId(),
        scheduledDate: new Date(),
        scheduledStartMinute: 600,
        scheduledEndMinute: 660,
        price: 500,
        duration: 60,
        status: 'confirmed',
        // Note: bookingMode is completely absent
      };

      const dto = toPublicBookingDto(mockHistoricalDoc);
      expect(dto.bookingMode).toBe('standard');
    });

    it('preserves bookingMode: "demo" in DTO output', () => {
      const mockDemoDoc = {
        _id: new mongoose.Types.ObjectId(),
        requestId: new mongoose.Types.ObjectId(),
        offerId: new mongoose.Types.ObjectId(),
        scheduledDate: new Date(),
        scheduledStartMinute: 600,
        scheduledEndMinute: 660,
        price: 500,
        duration: 60,
        status: 'confirmed',
        bookingMode: 'demo',
      };

      const dto = toPublicBookingDto(mockDemoDoc);
      expect(dto.bookingMode).toBe('demo');
    });
  });

  describe('Historical Backfill Migration', () => {
    it('physically backfills documents missing bookingMode on disk to "standard"', async () => {
      const id1 = new mongoose.Types.ObjectId();
      const id2 = new mongoose.Types.ObjectId();

      // Insert directly bypassing Mongoose validation to simulate historical pre-change documents
      await mongoose.connection.collection('bookings').insertMany([
        {
          _id: id1,
          requestId: new mongoose.Types.ObjectId(),
          offerId: new mongoose.Types.ObjectId(),
          clientId: new mongoose.Types.ObjectId(),
          stylistId: new mongoose.Types.ObjectId(),
          scheduledDate: new Date(),
          scheduledStartMinute: 600,
          scheduledEndMinute: 660,
          price: 250,
          duration: 60,
          status: 'completed',
          // No bookingMode field
        },
        {
          _id: id2,
          requestId: new mongoose.Types.ObjectId(),
          offerId: new mongoose.Types.ObjectId(),
          clientId: new mongoose.Types.ObjectId(),
          stylistId: new mongoose.Types.ObjectId(),
          scheduledDate: new Date(),
          scheduledStartMinute: 720,
          scheduledEndMinute: 780,
          price: 300,
          duration: 60,
          status: 'completed',
          bookingMode: 'demo', // already has bookingMode
        },
      ]);

      // Before backfill: raw query proves bookingMode does not exist on id1
      const preCheck = await mongoose.connection.collection('bookings').findOne({ _id: id1 });
      expect(preCheck.bookingMode).toBeUndefined();

      // Execute updateMany matching the backfill script logic
      const updateResult = await Booking.updateMany(
        { bookingMode: { $exists: false } },
        { $set: { bookingMode: 'standard' } }
      );

      expect(updateResult.modifiedCount).toBe(1);

      // Verify id1 now physically has 'standard' in BSON
      const postCheck1 = await mongoose.connection.collection('bookings').findOne({ _id: id1 });
      expect(postCheck1.bookingMode).toBe('standard');

      // Verify id2 was left untouched as 'demo'
      const postCheck2 = await mongoose.connection.collection('bookings').findOne({ _id: id2 });
      expect(postCheck2.bookingMode).toBe('demo');

      // Second run is idempotent (0 modified)
      const secondRun = await Booking.updateMany(
        { bookingMode: { $exists: false } },
        { $set: { bookingMode: 'standard' } }
      );
      expect(secondRun.modifiedCount).toBe(0);
    });
  });
});
