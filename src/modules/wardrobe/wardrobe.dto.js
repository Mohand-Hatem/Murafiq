export const formatWardrobeItemDto = (item) => {
  if (!item) return null;
  const doc = item.toObject ? item.toObject() : item;

  return {
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    imageUrl: doc.imageUrl,
    sourceUploadRef: doc.sourceUploadRef || null,
    category: doc.category || null,
    subcategory: doc.subcategory || null,
    primaryColor: doc.primaryColor || null,
    secondaryColors: doc.secondaryColors || [],
    pattern: doc.pattern || null,
    formality: doc.formality || null,
    season: doc.season || [],
    material: doc.material || null,
    fit: doc.fit || null,
    colorFamily: doc.colorFamily || null,
    isNeutral: Boolean(doc.isNeutral),
    genderPresentation: doc.genderPresentation || 'unisex',
    printedText: doc.printedText || '',
    aiConfidence: typeof doc.aiConfidence === 'number' ? doc.aiConfidence : null,
    aiModel: doc.aiModel || null,
    aiPromptVersion: doc.aiPromptVersion || null,
    origin: doc.origin || 'upload',
    lastWornAt: doc.lastWornAt || null,
    wearCount: doc.wearCount || 0,
    isArchived: Boolean(doc.isArchived),
    styleTags: doc.styleTags || [],
    aiDescription: doc.aiDescription || null,
    embeddingId: doc.embeddingId || null,
    classificationStatus: doc.classificationStatus,
    classificationError: doc.classificationError || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

export const formatWardrobeListDto = ({ items, pagination }) => ({
  items: items.map(formatWardrobeItemDto),
  pagination,
});
