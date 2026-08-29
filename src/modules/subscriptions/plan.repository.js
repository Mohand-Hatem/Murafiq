import Plan from './plan.model.js';
import { CANONICAL_PLANS } from './plan.constants.js';

export const findByCode = async (code) => {
  return await Plan.findOne({ code, isActive: true });
};

export const findActiveByRole = async (role) => {
  return await Plan.find({ role, isActive: true });
};

export const findAllActive = async () => {
  return await Plan.find({ isActive: true });
};

export const upsertPlan = async (planData) => {
  return await Plan.findOneAndUpdate(
    { code: planData.code },
    { $set: planData },
    { upsert: true, returnDocument: 'after' }
  );
};

export const seedPlans = async () => {
  const operations = CANONICAL_PLANS.map((plan) =>
    Plan.findOneAndUpdate({ code: plan.code }, { $set: plan }, { upsert: true, returnDocument: 'after' })
  );
  return await Promise.all(operations);
};

export default {
  findByCode,
  findActiveByRole,
  findAllActive,
  upsertPlan,
  seedPlans,
};
