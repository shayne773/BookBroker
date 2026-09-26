import { expect } from "chai";
import { api, offerBook, outbox, signUp } from "./helpers.js";
import { OfferedBook } from "../Data.js";
import Exchange from "../Exchange.js";
import { notificationsSettled } from "../lib/notifications.js";
import {
  COMPLETION_TIMEOUT_MS,
  PROPOSAL_TIMEOUT_MS,
  resolveTradeDeadlines,
} from "../lib/tradeDeadlines.js";

const MINUTE = 60 * 1000;

// Trade emails to `user` about a completed trade, once every send has finished.
async function completedEmailsTo(user) {
  await notificationsSettled();
  return outbox.filter((m) => m.to === user.email && m.subject === "Your trade is complete");
}

async function tradeEmails() {
  await notificationsSettled();
  return outbox.filter((m) => m.text.includes("/exchanges/"));
}

const statusOf = async (id) => (await Exchange.findById(id).lean()).status;
const near = (date, expected) => expect(Math.abs(new Date(date) - expected)).to.be.below(MINUTE);

describe("trade deadlines", () => {
  let requester;
  let responder;
  let requesterBook;
  let responderBook;

  beforeEach(async () => {
    requester = await signUp();
    responder = await signUp();
    requesterBook = await offerBook(requester, { title: "Offered by requester" });
    responderBook = await offerBook(responder, { title: "Offered by responder" });
  });

  // Proposes a swap of the two readers' books, or of fresh ones when `fresh`.
  async function propose({ fresh = false } = {}) {
    const [mine, theirs] = fresh
      ? [await offerBook(requester), await offerBook(responder)]
      : [requesterBook, responderBook];
    const res = await api(requester.token)
      .post("/exchanges")
      .send({
        responderId: responder.id,
        requesterBooks: [mine.id],
        responderBooks: [theirs.id],
      });
    expect(res).to.have.status(201);
    return res.body._id;
  }

  async function accepted(options) {
    const id = await propose(options);
    expect(await api(responder.token).post(`/exchanges/${id}/accept`)).to.have.status(200);
    return id;
  }

  // An accepted trade the requester has confirmed and the responder has not;
  // returns its id and the moment it completes on its own.
  async function confirmedByRequester(options) {
    const id = await accepted(options);
    expect(await api(requester.token).post(`/exchanges/${id}/confirm-complete`)).to.have.status(200);
    const { autoCompletesAt } = await Exchange.findById(id).lean();
    return { id, deadline: autoCompletesAt };
  }

  // Moves a trade's deadline into the past, as if it had been set long ago.
  const overdue = (id, field) =>
    Exchange.updateOne({ _id: id }, { $set: { [field]: new Date(Date.now() - MINUTE) } });

  describe("an accepted trade one side has confirmed", () => {
    it("completes by itself 7 days after the first confirmation, which a second one does not move", async () => {
      const id = await accepted();
      const before = Date.now();
      await api(requester.token).post(`/exchanges/${id}/confirm-complete`);
      const { autoCompletesAt } = await Exchange.findById(id).lean();
      near(autoCompletesAt, before + COMPLETION_TIMEOUT_MS);

      await api(requester.token).post(`/exchanges/${id}/confirm-complete`);
      expect(String((await Exchange.findById(id).lean()).autoCompletesAt)).to.equal(String(autoCompletesAt));
    });

    it("is still open just before the deadline", async () => {
      const { id, deadline } = await confirmedByRequester();

      const result = await resolveTradeDeadlines({}, new Date(deadline.getTime() - 1));

      expect(result).to.deep.equal({ expired: 0, completed: 0 });
      expect(await statusOf(id)).to.equal("ACCEPTED");
      expect(await OfferedBook.countDocuments({ locked: true, lockedByExchange: id })).to.equal(2);
    });

    it("at the deadline completes as a two-sided confirmation does: books off the market, locks gone", async () => {
      const { id, deadline } = await confirmedByRequester();
      const bystander = await offerBook(requester, { title: "Not in the trade" });

      const result = await resolveTradeDeadlines({}, deadline);

      expect(result).to.deep.equal({ expired: 0, completed: 1 });
      const ex = await Exchange.findById(id).lean();
      expect(ex).to.include({ status: "COMPLETED", autoCompleted: true, responderConfirmedComplete: false });
      expect(await OfferedBook.countDocuments({ _id: { $in: [requesterBook.id, responderBook.id] } })).to.equal(0);
      expect(await OfferedBook.countDocuments({ lockedByExchange: id })).to.equal(0);
      expect(await OfferedBook.exists({ _id: bystander.id })).to.not.equal(null);
    });

    it("emails the completion to the side that did not confirm, and only to them", async () => {
      const { deadline } = await confirmedByRequester();

      await resolveTradeDeadlines({}, deadline);

      const emails = await completedEmailsTo(responder);
      expect(emails).to.have.lengthOf(1);
      expect(emails[0].text).to.include(requester.username);
      expect(await completedEmailsTo(requester)).to.have.lengthOf(0);
    });

    it("sends no email to a silent side who turned trade emails off", async () => {
      const { deadline } = await confirmedByRequester();
      await api(responder.token).post("/user/notifications").send({ trades: false });

      await resolveTradeDeadlines({}, deadline);

      expect(await statusOf((await Exchange.findOne().lean())._id)).to.equal("COMPLETED");
      expect(await completedEmailsTo(responder)).to.have.lengthOf(0);
    });

    it("lets both sides rate afterwards", async () => {
      const { id, deadline } = await confirmedByRequester();
      await resolveTradeDeadlines({}, deadline);

      for (const reader of [requester, responder]) {
        const res = await api(reader.token).post(`/exchanges/${id}/rate`).send({ rating: 4 });
        expect(res).to.have.status(200);
      }
    });

    it("is resolved when either side opens it or lists their trades, before the cron runs", async () => {
      const first = await confirmedByRequester();
      await overdue(first.id, "autoCompletesAt");

      const detail = await api(responder.token).get(`/exchanges/${first.id}`);
      expect(detail.body).to.include({ status: "COMPLETED", autoCompleted: true });

      const second = await confirmedByRequester({ fresh: true });
      await overdue(second.id, "autoCompletesAt");

      const list = await api(requester.token).get("/exchanges");
      expect(list.body.find((ex) => ex._id === second.id)).to.include({ status: "COMPLETED", autoCompleted: true });
    });

    it("can no longer be cancelled once past the deadline, even by the side that confirmed", async () => {
      const { id } = await confirmedByRequester();
      await overdue(id, "autoCompletesAt");

      const res = await api(requester.token).post(`/exchanges/${id}/cancel`);

      expect(res).to.have.status(400);
      expect(await statusOf(id)).to.equal("COMPLETED");
    });

    it("starts the clock, from now, on a trade confirmed before deadlines existed", async () => {
      const id = await accepted();
      await Exchange.updateOne({ _id: id }, { $set: { requesterConfirmedComplete: true } });

      const res = await api(responder.token).get(`/exchanges/${id}`);

      expect(res.body.status).to.equal("ACCEPTED");
      near(res.body.autoCompletesAt, Date.now() + COMPLETION_TIMEOUT_MS);
    });
  });

  describe("does not complete an accepted trade", () => {
    it("that neither side has confirmed, however old", async () => {
      const id = await accepted();
      await overdue(id, "autoCompletesAt");

      await resolveTradeDeadlines({}, new Date(Date.now() + 365 * COMPLETION_TIMEOUT_MS));

      expect(await statusOf(id)).to.equal("ACCEPTED");
      expect(await OfferedBook.countDocuments({ lockedByExchange: id })).to.equal(2);
    });

    it("that both sides confirmed: they completed it themselves", async () => {
      const { id } = await confirmedByRequester();
      await api(responder.token).post(`/exchanges/${id}/confirm-complete`);

      const result = await resolveTradeDeadlines({}, new Date(Date.now() + 2 * COMPLETION_TIMEOUT_MS));

      expect(result.completed).to.equal(0);
      expect(await Exchange.findById(id).lean()).to.include({ status: "COMPLETED", autoCompleted: false });
    });
  });

  describe("an offer nobody answers", () => {
    it("expires 14 days after it was proposed, and not a moment before", async () => {
      const before = Date.now();
      const id = await propose();
      const { expiresAt } = await Exchange.findById(id).lean();
      near(expiresAt, before + PROPOSAL_TIMEOUT_MS);

      await resolveTradeDeadlines({}, new Date(expiresAt.getTime() - 1));
      expect(await statusOf(id)).to.equal("PENDING");

      const result = await resolveTradeDeadlines({}, expiresAt);
      expect(result).to.deep.equal({ expired: 1, completed: 0 });
      expect(await statusOf(id)).to.equal("EXPIRED");
    });

    it("counts the 14 days from the latest counter", async () => {
      const id = await propose();
      const proposed = (await Exchange.findById(id).lean()).expiresAt;
      await Exchange.updateOne({ _id: id }, { $set: { expiresAt: new Date(Date.now() + MINUTE) } });

      const counter = await api(responder.token)
        .post(`/exchanges/${id}/counter`)
        .send({ requesterBooks: [requesterBook.id], responderBooks: [] });
      expect(counter).to.have.status(200);
      const { expiresAt } = await Exchange.findById(id).lean();
      expect(expiresAt.getTime()).to.be.at.least(proposed.getTime());

      await resolveTradeDeadlines({}, new Date(Date.now() + 2 * MINUTE));
      expect(await statusOf(id)).to.equal("COUNTERED");

      await resolveTradeDeadlines({}, expiresAt);
      expect(await statusOf(id)).to.equal("EXPIRED");
    });

    it("releases any book it locked, and leaves another trade's locks alone", async () => {
      const id = await propose();
      const other = await offerBook(responder, { title: "Locked elsewhere" });
      const elsewhere = await Exchange.create({ requester: requester.id, responder: responder.id, status: "ACCEPTED" });
      await OfferedBook.updateOne({ _id: requesterBook.id }, { $set: { locked: true, lockedByExchange: id } });
      await OfferedBook.updateOne({ _id: other.id }, { $set: { locked: true, lockedByExchange: elsewhere._id } });
      await overdue(id, "expiresAt");

      await resolveTradeDeadlines();

      expect(await OfferedBook.findById(requesterBook.id).lean()).to.include({ locked: false, lockedByExchange: null });
      expect(await OfferedBook.findById(other.id).lean()).to.include({ locked: true });
    });

    it("shows as EXPIRED in both readers' lists, cannot then be accepted, and emails nobody", async () => {
      const id = await propose();
      await overdue(id, "expiresAt");
      const sentBefore = (await tradeEmails()).length;

      for (const reader of [requester, responder]) {
        const list = await api(reader.token).get("/exchanges");
        expect(list.body.find((ex) => ex._id === id).status).to.equal("EXPIRED");
      }
      expect(await api(responder.token).post(`/exchanges/${id}/accept`)).to.have.status(400);
      expect((await tradeEmails()).length).to.equal(sentBefore);
    });
  });

  describe("GET /cron/trade-deadlines", () => {
    const SECRET = "test-cron-secret-0123456789";

    beforeEach(() => {
      process.env.CRON_SECRET = SECRET;
    });

    afterEach(() => {
      delete process.env.CRON_SECRET;
    });

    const cron = (authorization) => {
      const req = api().get("/cron/trade-deadlines");
      return authorization === undefined ? req : req.set("Authorization", authorization);
    };

    it("refuses a call without the secret, with the wrong one, or when none is configured", async () => {
      const id = await propose();
      await overdue(id, "expiresAt");

      expect(await cron()).to.have.status(401);
      expect(await cron(`Bearer ${SECRET}x`)).to.have.status(401);
      expect(await cron(SECRET)).to.have.status(401);
      delete process.env.CRON_SECRET;
      expect(await cron("Bearer undefined")).to.have.status(401);
      expect(await cron("Bearer ")).to.have.status(401);

      expect(await statusOf(id)).to.equal("PENDING");
    });

    it("resolves every reader's due trades, and a second run changes nothing", async () => {
      const offer = await propose();
      await overdue(offer, "expiresAt");
      const { id: trade } = await confirmedByRequester();
      await overdue(trade, "autoCompletesAt");
      const open = await propose({ fresh: true });

      const first = await cron(`Bearer ${SECRET}`);
      expect(first).to.have.status(200);
      expect(first.body).to.deep.equal({ expired: 1, completed: 1 });

      const second = await cron(`Bearer ${SECRET}`);
      expect(second.body).to.deep.equal({ expired: 0, completed: 0 });

      expect(await statusOf(offer)).to.equal("EXPIRED");
      expect(await statusOf(trade)).to.equal("COMPLETED");
      expect(await statusOf(open)).to.equal("PENDING");
      expect(await completedEmailsTo(responder)).to.have.lengthOf(1);
    });
  });

  describe("racing a reader", () => {
    it("the silent side confirming as the deadline passes completes the trade once", async () => {
      const { id, deadline } = await confirmedByRequester();
      await overdue(id, "autoCompletesAt");

      const [, confirm] = await Promise.all([
        resolveTradeDeadlines({}, deadline),
        api(responder.token).post(`/exchanges/${id}/confirm-complete`),
      ]);

      expect([200, 400, 409]).to.include(confirm.status);
      expect(await statusOf(id)).to.equal("COMPLETED");
      expect(await OfferedBook.countDocuments({ _id: { $in: [requesterBook.id, responderBook.id] } })).to.equal(0);
      const completed = [...(await completedEmailsTo(requester)), ...(await completedEmailsTo(responder))];
      expect(completed).to.have.lengthOf(1);
    });

    it("accepting as the offer expires leaves it either accepted with its books locked or expired with them free", async () => {
      const id = await propose();
      const { expiresAt } = await Exchange.findById(id).lean();

      const [, accept] = await Promise.all([
        resolveTradeDeadlines({}, expiresAt),
        api(responder.token).post(`/exchanges/${id}/accept`),
      ]);

      const status = await statusOf(id);
      const locked = await OfferedBook.countDocuments({ locked: true, lockedByExchange: id });
      if (status === "ACCEPTED") {
        expect(accept).to.have.status(200);
        expect(locked).to.equal(2);
      } else {
        expect(status).to.equal("EXPIRED");
        expect([400, 409]).to.include(accept.status);
        expect(locked).to.equal(0);
      }
    });

    it("countering as the offer expires either renews its deadline or loses to the expiry, never both", async () => {
      const id = await propose();
      const { expiresAt } = await Exchange.findById(id).lean();

      const [, counter] = await Promise.all([
        resolveTradeDeadlines({}, expiresAt),
        api(responder.token)
          .post(`/exchanges/${id}/counter`)
          .send({ requesterBooks: [requesterBook.id], responderBooks: [] }),
      ]);

      const ex = await Exchange.findById(id).lean();
      if (ex.status === "COUNTERED") {
        expect(counter).to.have.status(200);
        expect(ex.expiresAt.getTime()).to.be.above(expiresAt.getTime());
      } else {
        expect(ex.status).to.equal("EXPIRED");
        expect([400, 409]).to.include(counter.status);
      }
    });
  });
});
