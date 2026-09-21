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

    // ratings after completion
    requesterRating: { type: Number, min: 1, max: 5, default: null },
    responderRating: { type: Number, min: 1, max: 5, default: null },

    // expiry to avoid forever-pending invites
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Exchange", ExchangeSchema);
