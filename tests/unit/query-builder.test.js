import { jest } from '@jest/globals';
import QueryBuilder, { escapeRegex } from '../../src/common/query-builder/QueryBuilder.js';

describe('QueryBuilder Unit Tests', () => {
  let mockMongooseQuery;

  beforeEach(() => {
    mockMongooseQuery = {
      find: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };
  });

  it('should filter query parameters and convert gte/gt/lte/lt prefixes', () => {
    const queryString = {
      price: { gte: '100', lte: '500' },
      page: '2',
      sort: '-price',
    };

    const qb = new QueryBuilder(mockMongooseQuery, queryString);
    qb.filter();

    expect(mockMongooseQuery.find).toHaveBeenCalledWith({
      price: { $gte: '100', $lte: '500' },
    });
  });

  it('should sort by specified fields or default to -createdAt', () => {
    const qbDefault = new QueryBuilder(mockMongooseQuery, {});
    qbDefault.sort();
    expect(mockMongooseQuery.sort).toHaveBeenCalledWith('-createdAt');

    const qbCustom = new QueryBuilder(mockMongooseQuery, { sort: 'name,-price' });
    qbCustom.sort();
    expect(mockMongooseQuery.sort).toHaveBeenCalledWith('name -price');
  });

  it('should select specified fields or default to excluding __v', () => {
    const qbDefault = new QueryBuilder(mockMongooseQuery, {});
    qbDefault.select();
    expect(mockMongooseQuery.select).toHaveBeenCalledWith('-__v');

    const qbCustom = new QueryBuilder(mockMongooseQuery, { fields: 'name,email' });
    qbCustom.select();
    expect(mockMongooseQuery.select).toHaveBeenCalledWith('name email');
  });

  // Regression test for docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md finding X23: this test's own
  // name says a client cannot force-select a select:false field, but its assertion used
  // to prove the opposite -- passwordHash was still passed straight through to
  // `.select()` after only the `+` character was stripped. Mongoose's `select: false` is
  // a DEFAULT projection, and naming the field explicitly overrides that default, so the
  // old behavior was a live latent leak, closed here by an actual denylist.
  it('strips a select:false field name outright, not just its "+" prefix', () => {
    const qb = new QueryBuilder(mockMongooseQuery, { fields: '+passwordHash,name' });
    qb.select();
    expect(mockMongooseQuery.select).toHaveBeenCalledWith('name');
  });

  it('falls back to the default exclusion when every requested field is sensitive', () => {
    const qb = new QueryBuilder(mockMongooseQuery, { fields: 'passwordHash,otpCode' });
    qb.select();
    expect(mockMongooseQuery.select).toHaveBeenCalledWith('-__v');
  });

  it('strips a select:false field name from a client-supplied sort too', () => {
    const qb = new QueryBuilder(mockMongooseQuery, { sort: 'otpAttempts,-createdAt' });
    qb.sort();
    expect(mockMongooseQuery.sort).toHaveBeenCalledWith('-createdAt');
  });

  it('should not treat an operator-like string value as a Mongo operator', () => {
    const qb = new QueryBuilder(mockMongooseQuery, { city: 'in', role: 'ne' });
    qb.filter();
    expect(mockMongooseQuery.find).toHaveBeenCalledWith({ city: 'in', role: 'ne' });
  });

  it('should build a $or regex search across the given fields when ?search= is present', () => {
    const qb = new QueryBuilder(mockMongooseQuery, { search: 'sara' });
    qb.search(['name', 'bio']);
    expect(mockMongooseQuery.find).toHaveBeenCalledWith({
      $or: [{ name: /sara/i }, { bio: /sara/i }],
    });
  });

  it('should do nothing when ?search= is absent', () => {
    const qb = new QueryBuilder(mockMongooseQuery, {});
    qb.search(['name']);
    expect(mockMongooseQuery.find).not.toHaveBeenCalled();
  });

  it('should compute skip and limit for pagination and generate meta', async () => {
    const mockModel = {
      countDocuments: jest.fn().mockResolvedValue(25),
    };

    const qb = new QueryBuilder(mockMongooseQuery, { page: '2', limit: '10' });
    await qb.paginate(mockModel);

    expect(mockMongooseQuery.skip).toHaveBeenCalledWith(10);
    expect(mockMongooseQuery.limit).toHaveBeenCalledWith(10);
    expect(qb.meta).toEqual({
      page: 2,
      limit: 10,
      total: 25,
      totalPages: 3,
    });
  });
});

describe('QueryBuilder Hardening', () => {
  it('escapes dangerous regex characters', () => {
    const malicious = '.*+?^${}()|[]\\';
    const escaped = escapeRegex(malicious);
    expect(escaped).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
  });

  it('caps pagination limit at 100 maximum', async () => {
    const mockMongooseQuery = {
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };
    const builder = new QueryBuilder(mockMongooseQuery, { limit: '999999' });
    await builder.paginate(null);
    expect(builder.meta.limit).toBe(100);
  });

  it('drops disallowed filter fields (e.g. otpCode, passwordHash)', () => {
    const queryObj = {
      otpCode: { ne: null },
      passwordHash: 'secret',
      role: 'stylist',
    };
    const mockMongooseQuery = {
      find: jest.fn().mockReturnThis(),
    };
    const builder = new QueryBuilder(mockMongooseQuery, queryObj);
    builder.filter(['role', 'accountStatus']);

    expect(mockMongooseQuery.find).toHaveBeenCalledWith({
      role: 'stylist',
    });
  });
});
