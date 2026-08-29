import '../../src/common/globals.js';
import { jest } from '@jest/globals';
import stylistSearchService from '../../src/modules/stylists/stylist-search.service.js';
import StylistProfile from '../../src/modules/stylists/stylist-profile.model.js';

describe('Stylist Search Hardening', () => {
  it('rejects invalid sort field with 400', async () => {
    await expect(stylistSearchService.searchStylists({ sort: 'unindexedSecretField:asc' })).rejects.toThrow(
      /Invalid sort field/i
    );
  });

  it('correctly parses $facet aggregate results', async () => {
    jest.spyOn(StylistProfile, 'aggregate').mockResolvedValue([
      {
        items: [
          {
            _id: 'p1',
            hourlyPrice: 200,
            user: { _id: 'u1', name: 'Test Stylist' },
          },
        ],
        totalCount: [{ total: 1 }],
      },
    ]);

    const res = await stylistSearchService.searchStylists({ specialty: 'stylist' });
    expect(res.items.length).toBe(1);
    expect(res.meta.total).toBe(1);
  });
});
