import mongoose from 'mongoose';

const { Schema } = mongoose;

const aiMessageSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'AiConversation',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['user', 'assistant'],
      required: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    structuredResult: {
      type: Schema.Types.Mixed,
      default: null,
    },
    traceId: {
      type: String,
      trim: true,
      default: null,
    },
    // ── Phase 15C: Image Input Fields ──────────────────────────────
    /** Cloudinary public_id (e.g. murafiq/ai-chat/<userId>/<uuid>) */
    imageRef: {
      type: String,
      default: null,
    },
    /** Cloudinary secure_url for display */
    imageUrl: {
      type: String,
      default: null,
    },
    /** Garment analysis reused from intent extraction (HARDENING_08 Step 5 schema) */
    imageAnalysis: {
      type: Schema.Types.Mixed,
      default: null,
    },
    /** 24h TTL for ephemeral cleanup sweep; null when saved to wardrobe */
    imageExpiresAt: {
      type: Date,
      default: null,
    },
    /** Soft match: existing wardrobe item that looks like the uploaded garment */
    matchedWardrobeItemId: {
      type: Schema.Types.ObjectId,
      ref: 'WardrobeItem',
      default: null,
    },
    /** Set when user explicitly saves this image to wardrobe (idempotency key) */
    savedWardrobeItemId: {
      type: Schema.Types.ObjectId,
      ref: 'WardrobeItem',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for chronological message retrieval within a conversation
aiMessageSchema.index({ conversationId: 1, createdAt: 1 });

// Sparse index for ephemeral ai-chat image cleanup sweep (Phase 15C Step 9)
aiMessageSchema.index(
  { imageExpiresAt: 1 },
  {
    partialFilterExpression: {
      imageExpiresAt: { $exists: true },
    },
  }
);

const AiMessage = mongoose.model('AiMessage', aiMessageSchema);

export default AiMessage;
