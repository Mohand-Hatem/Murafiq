import '../../src/common/globals.js';
import { updateProfileSchema } from '../../src/modules/users/user.validator.js';
import { createReviewSchema } from '../../src/modules/reviews/review.validator.js';

describe('Validator Strictness Enforcement', () => {
  it('rejects unexpected keys in updateProfileSchema with 400 validation failure', () => {
    const result = updateProfileSchema.body.safeParse({
      name: 'Valid Name',
      unexpectedField: 'intruder',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unexpected keys in createReviewSchema with 400 validation failure', () => {
    const result = createReviewSchema.body.safeParse({
      rating: 5,
      extraParam: true,
    });
    expect(result.success).toBe(false);
  });
});
