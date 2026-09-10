import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import ledgerService, { postEntry } from '../../src/modules/ledger/ledger.service.js';

// Regression test for the audit finding: LedgerEntry has no `subjectId` field (the
// schema field is `accountId`), so the previous findBySubjectId query always matched
// zero documents -- getUserStatement (and the admin ledger-statement `subjectId`
// filter) silently returned an empty array for every user, no matter how much ledger
// activity existed for their account.
describe('Ledger — getUserStatement', () => {
  const accountId = new mongoose.Types.ObjectId();
  const otherAccountId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    await connectTestDB();
  }, 300000);

  afterAll(async () => {
    await closeTestDB();
  }, 30000);

  beforeEach(async () => {
    await clearTestDB();
  });

  it('returns ledger entries belonging to the requested account, and none belonging to another', async () => {
    await postEntry({
      idempotencyKey: 'stmt-test:1',
      entryType: 'PAYOUT_DISBURSEMENT',
      accountType: 'STYLIST',
      accountId,
      direction: 'CREDIT',
      amountMinor: 85000,
    });
    await postEntry({
      idempotencyKey: 'stmt-test:2',
      entryType: 'PAYOUT_DISBURSEMENT',
      accountType: 'STYLIST',
      accountId: otherAccountId,
      direction: 'CREDIT',
      amountMinor: 12000,
    });

    const statement = await ledgerService.getUserStatement(accountId);

    expect(statement.length).toBe(1);
    expect(statement[0].amountMinor).toBe(85000);
    expect(statement.some((e) => e.amountMinor === 12000)).toBe(false);
  });

  it('returns an empty array for an account with no ledger activity', async () => {
    const statement = await ledgerService.getUserStatement(new mongoose.Types.ObjectId());
    expect(statement).toEqual([]);
  });
});
