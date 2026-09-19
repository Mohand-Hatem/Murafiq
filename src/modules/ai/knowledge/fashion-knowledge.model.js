import mongoose from 'mongoose';

const { Schema } = mongoose;

export const KNOWLEDGE_TOPICS = [
  'dress_codes',
  'egyptian_norms',
  'color_theory',
  'silhouette',
  'fabrics',
];

const fashionKnowledgeDocSchema = new Schema(
  {
    slug: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    topic: {
      type: String,
      enum: KNOWLEDGE_TOPICS,
      required: true,
      index: true,
    },
    locale: {
      type: String,
      default: 'en',
      trim: true,
    },
    body: {
      type: String,
      required: true,
    },
    chunkIndex: {
      type: Number,
      required: true,
    },
    promptVersion: {
      type: Number,
      default: 1,
    },
    vectorId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    collection: 'fashion_knowledge_docs',
  }
);

// Compound unique index guaranteeing idempotency on re-ingestion
fashionKnowledgeDocSchema.index({ slug: 1, chunkIndex: 1 }, { unique: true });

// Text index for resilient offline/fallback keyword search in MongoDB
fashionKnowledgeDocSchema.index({ title: 'text', body: 'text' });

const FashionKnowledgeDoc = mongoose.models.FashionKnowledgeDoc ||
  mongoose.model('FashionKnowledgeDoc', fashionKnowledgeDocSchema);

export default FashionKnowledgeDoc;
