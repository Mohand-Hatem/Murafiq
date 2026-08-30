export const formatWardrobeItemDto = (item) => {
  if (!item) return null;
  const doc = item.toObject ? item.toObject() : item;

  return {
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    imageUrl: doc.imageUrl,
    category: doc.category || null,
    primaryColor: doc.primaryColor || null,
    secondaryColors: doc.secondaryColors || [],
    pattern: doc.pattern || null,
    formality: doc.formality || null,
    season: doc.season || [],
    material: doc.material || null,
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
