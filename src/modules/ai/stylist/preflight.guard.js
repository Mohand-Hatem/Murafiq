/**
 * Pre-Flight Wardrobe Capacity Guard.
 *
 * Deterministically checks candidate counts by slot before invoking the LLM composition step.
 * If required slots are completely absent (e.g. no shoes, or neither top/bottom nor dress),
 * execution bypasses the expensive composition model call entirely and branches immediately
 * to the insufficiency/shopping recommendation flow.
 */

/**
 * Evaluates whether retrieved candidate pool can satisfy the event's required category slots.
 *
 * @param {Object} [candidatesBySlot={}] - Map of slot name to array of candidate items
 * @param {string[]} [requiredSlots=['top', 'bottom', 'shoes']] - Required slots from resolved dress code
 * @returns {{
 *   canCompose: boolean,
 *   missingSlots: string[],
 *   totalCandidates: number,
 *   slotCounts: Record<string, number>,
 *   hasDress: boolean
 * }}
 */
export const evaluateWardrobeCapacity = (
  candidatesBySlot = {},
  requiredSlots = ['top', 'bottom', 'shoes']
) => {
  const slotCounts = {};
  let totalCandidates = 0;

  for (const [slot, items] of Object.entries(candidatesBySlot)) {
    const count = Array.isArray(items) ? items.length : 0;
    slotCounts[slot] = count;
    totalCandidates += count;
  }

  // A dress or one-piece garment satisfies the top + bottom requirement
  const hasDress = Boolean(slotCounts.dress && slotCounts.dress > 0);

  const missingSlots = [];
  for (const slot of requiredSlots) {
    const count = slotCounts[slot] || 0;
    if (count === 0) {
      if (hasDress && (slot === 'top' || slot === 'bottom')) {
        continue;
      }
      missingSlots.push(slot);
    }
  }

  const canCompose = missingSlots.length === 0 && totalCandidates > 0;

  return {
    canCompose,
    missingSlots,
    totalCandidates,
    slotCounts,
    hasDress,
  };
};

export default {
  evaluateWardrobeCapacity,
};
