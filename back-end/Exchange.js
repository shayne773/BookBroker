import mongoose from "mongoose";

const ExchangeSchema = new mongoose.Schema(
  {
    // participants
    requester: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    responder: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // what each side is trading (array allows 1-for-1 or bundle-for-bundle)
    requesterBooks: [{ type: mongoose.Schema.Types.ObjectId, ref: "OfferedBook", default: [] }],
    responderBooks: [{ type: mongoose.Schema.Types.ObjectId, ref: "OfferedBook", default: [] }],

    // status machine
    status: {
      type: String,
      enum: [
        "DRAFT",        // requester created but not sent
        "PENDING",      // invite sent
        "COUNTERED",    // responder modified and sent back
        "ACCEPTED",     // both agreed
        "DECLINED",
        "CANCELLED",
        "COMPLETED",
        "EXPIRED",
      ],
      default: "DRAFT",
    },

    // who made the offer currently on the table (the invite or the latest
    // counter); only the other side may accept it
    proposedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // optional details
    message: { type: String, default: "" },
    meetMethod: { type: String, enum: ["IN_PERSON", "MAIL", "OTHER"], default: "IN_PERSON" },
    meetLocation: { type: String, default: "" },
    proposedTime: { type: String, default: "" },

    // completion confirmations (like escrow)
    requesterConfirmedComplete: { type: Boolean, default: false },
    responderConfirmedComplete: { type: Boolean, default: false },

    // set when the first side confirms completion: if the other side has not
    // confirmed by then, the trade completes on its own (lib/tradeDeadlines.js)
    autoCompletesAt: { type: Date, default: null },
    // true for a trade completed that way rather than by both confirmations
    autoCompleted: { type: Boolean, default: false },
    // the days allowed by the deadline that closed the trade (expired or
    // completed that way); null for a trade a reader closed, or one that
    // expired before the deadlines of lib/tradeDeadlines.js
    deadlineDays: { type: Number, default: null },

    // ratings after completion
    requesterRating: { type: Number, min: 1, max: 5, default: null },
    responderRating: { type: Number, min: 1, max: 5, default: null },

    // when an unanswered offer expires: PROPOSAL_TIMEOUT_MS after the invite
    // or the latest counter (lib/tradeDeadlines.js)
    expiresAt: { type: Date, default: null },
  },
  // Every save is conditional on the version it was read at, and the deadline
  // sweep bumps the version, so a route acting on a trade the sweep has just
  // closed fails instead of overwriting it.
  { timestamps: true, optimisticConcurrency: true }
);

// The deadline sweep's queries (lib/tradeDeadlines.js).
ExchangeSchema.index({ status: 1, expiresAt: 1 });
ExchangeSchema.index({ status: 1, autoCompletesAt: 1 });

export default mongoose.model("Exchange", ExchangeSchema);
