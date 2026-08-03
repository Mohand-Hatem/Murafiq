import { jest } from '@jest/globals';
import QueryBuilder from '../../src/common/query-builder/QueryBuilder.js';

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
